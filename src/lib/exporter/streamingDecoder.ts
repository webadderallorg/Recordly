import { WebDemuxer } from "web-demuxer";
import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { getLocalFilePath } from "./localMediaSource";

const DEFAULT_MAX_DECODE_QUEUE = 12;
const DEFAULT_MAX_PENDING_FRAMES = 32;

export interface DecodedVideoInfo {
	width: number;
	height: number;
	duration: number; // seconds
	mediaStartTime?: number; // seconds
	streamStartTime?: number; // seconds
	streamDuration?: number; // seconds
	frameRate: number;
	codec: string;
	hasAudio: boolean;
	audioCodec?: string;
	audioSampleRate?: number;
}

/** Caller must close the VideoFrame after use. */
type OnFrameCallback = (
	frame: VideoFrame,
	exportTimestampUs: number,
	sourceTimestampMs: number,
	cursorTimestampMs: number,
) => Promise<void>;

export function getDecodedFrameStartupOffsetUs(
	firstDecodedFrameTimestampUs: number,
	metadata: Pick<DecodedVideoInfo, "mediaStartTime" | "streamStartTime">,
): number {
	const streamStartTimeUs = Math.round(
		(metadata.streamStartTime ?? metadata.mediaStartTime ?? 0) * 1_000_000,
	);

	return Math.max(0, firstDecodedFrameTimestampUs - streamStartTimeUs);
}

export function getDecodedFrameTimelineOffsetUs(
	firstDecodedFrameTimestampUs: number,
	metadata: Pick<DecodedVideoInfo, "mediaStartTime" | "streamStartTime">,
): number {
	const mediaStartTimeUs = Math.round((metadata.mediaStartTime ?? 0) * 1_000_000);
	const streamStartTimeUs = Math.round(
		(metadata.streamStartTime ?? metadata.mediaStartTime ?? 0) * 1_000_000,
	);

	return (
		Math.max(0, streamStartTimeUs - mediaStartTimeUs) +
		getDecodedFrameStartupOffsetUs(firstDecodedFrameTimestampUs, metadata)
	);
}

/**
 * Decodes video frames via web-demuxer + VideoDecoder in a single forward pass.
 * Way faster than seeking an HTMLVideoElement per frame.
 *
 * Frames in trimmed regions are decoded (needed for P/B-frame state) but discarded.
 * Kept frames are resampled to the target frame rate in a streaming pass.
 */
export class StreamingVideoDecoder {
	private demuxer: WebDemuxer | null = null;
	private decoder: VideoDecoder | null = null;
	private cancelled = false;
	private metadata: DecodedVideoInfo | null = null;
	private pendingFrames: VideoFrame[] = [];
	private readonly maxDecodeQueue: number;
	private readonly maxPendingFrames: number;

	constructor(options?: { maxDecodeQueue?: number; maxPendingFrames?: number }) {
		this.maxDecodeQueue = Math.max(
			1,
			Math.floor(options?.maxDecodeQueue ?? DEFAULT_MAX_DECODE_QUEUE),
		);
		this.maxPendingFrames = Math.max(
			1,
			Math.floor(options?.maxPendingFrames ?? DEFAULT_MAX_PENDING_FRAMES),
		);
	}

	private inferMimeType(fileName: string): string {
		const extension = fileName.split(".").pop()?.toLowerCase();
		switch (extension) {
			case "mov":
				return "video/quicktime";
			case "webm":
				return "video/webm";
			case "mkv":
				return "video/x-matroska";
			case "avi":
				return "video/x-msvideo";
			case "mp4":
			default:
				return "video/mp4";
		}
	}

	private async loadVideoFile(resourceUrl: string): Promise<File> {
		const localFilePath = getLocalFilePath(resourceUrl);
		const filename =
			(localFilePath ?? resourceUrl).split(/[\\/]/).pop()?.split("?")[0] || "video";

		if (localFilePath) {
			const result = await window.electronAPI.readLocalFile(localFilePath);
			if (!result.success || !result.data) {
				throw new Error(result.error || "Failed to read local video file");
			}

			const bytes =
				result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
			const arrayBuffer = bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer;
			return new File([arrayBuffer], filename, { type: this.inferMimeType(filename) });
		}

		const response = await fetch(resourceUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to load video resource: ${response.status} ${response.statusText}`,
			);
		}

		const blob = await response.blob();
		return new File([blob], filename, { type: blob.type || this.inferMimeType(filename) });
	}

	private resolveVideoResourceUrl(videoUrl: string): string {
		if (/^(blob:|data:|https?:|file:)/i.test(videoUrl)) {
			return videoUrl;
		}

		if (videoUrl.startsWith("/")) {
			return `file://${encodeURI(videoUrl)}`;
		}

		return videoUrl;
	}

	async loadMetadata(videoUrl: string): Promise<DecodedVideoInfo> {
		if (this.decoder) {
			try {
				if (this.decoder.state === "configured") {
					this.decoder.close();
				}
			} catch {
				// Ignore cleanup errors while reloading metadata.
			}
			this.decoder = null;
		}

		if (this.demuxer) {
			try {
				this.demuxer.destroy();
			} catch {
				// Ignore cleanup errors while reloading metadata.
			}
			this.demuxer = null;
		}

		const resourceUrl = this.resolveVideoResourceUrl(videoUrl);

		// Relative URL so it resolves correctly in both dev (http) and packaged (file://) builds
		const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
		this.demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
		const file = await this.loadVideoFile(resourceUrl);
		await this.demuxer.load(file);

		const mediaInfo = await this.demuxer.getMediaInfo();
		const videoStream = mediaInfo.streams.find((s) => s.codec_type_string === "video");
		const audioStream = mediaInfo.streams.find((s) => s.codec_type_string === "audio");
		const mediaStartTime =
			typeof mediaInfo.start_time === "number" && Number.isFinite(mediaInfo.start_time)
				? mediaInfo.start_time
				: 0;
		const streamStartTime =
			typeof videoStream?.start_time === "number" && Number.isFinite(videoStream.start_time)
				? videoStream.start_time
				: mediaStartTime;

		let frameRate = 60;
		if (videoStream?.avg_frame_rate) {
			const parts = videoStream.avg_frame_rate.split("/");
			if (parts.length === 2) {
				const num = parseInt(parts[0], 10);
				const den = parseInt(parts[1], 10);
				if (den > 0 && num > 0) frameRate = num / den;
			}
		}

		this.metadata = {
			width: videoStream?.width || 1920,
			height: videoStream?.height || 1080,
			duration: mediaInfo.duration,
			mediaStartTime,
			streamStartTime,
			streamDuration:
				typeof videoStream?.duration === "number" && Number.isFinite(videoStream.duration)
					? videoStream.duration
					: undefined,
			frameRate,
			codec: videoStream?.codec_string || "unknown",
			hasAudio: !!audioStream,
			audioCodec: audioStream?.codec_string,
			audioSampleRate:
				typeof audioStream?.sample_rate === "string"
					? Number.parseInt(audioStream.sample_rate, 10)
					: undefined,
		};

		return this.metadata;
	}

	async decodeAll(
		targetFrameRate: number,
		trimRegions: TrimRegion[] | undefined,
		speedRegions: SpeedRegion[] | undefined,
		onFrame: OnFrameCallback,
	): Promise<void> {
		if (!this.demuxer || !this.metadata) {
			throw new Error("Must call loadMetadata() before decodeAll()");
		}

		const decoderConfig = await this.demuxer.getDecoderConfig("video");
		const codec = this.metadata.codec.toLowerCase();
		const shouldPreferSoftwareDecode = codec.includes("av01") || codec.includes("av1");
		const effectiveVideoDuration = getEffectiveVideoStreamDurationSeconds({
			duration: this.metadata.duration,
			streamDuration: this.metadata.streamDuration,
		});
		const segments = this.splitBySpeed(
			this.computeSegments(effectiveVideoDuration, trimRegions),
			speedRegions,
		);
		const segmentOutputFrameCounts = segments.map((segment) =>
			Math.ceil(((segment.endSec - segment.startSec) / segment.speed) * targetFrameRate),
		);
		const expectedOutputFrames = segmentOutputFrameCounts.reduce(
			(sum, count) => sum + count,
			0,
		);
		const frameDurationUs = 1_000_000 / targetFrameRate;
		const epsilonSec = 0.001;
		const startupStabilizationSeconds = 3;
		const startupFrameBudget = Math.max(
			1,
			Math.round(targetFrameRate * startupStabilizationSeconds),
		);
		let exportFrameIndex = 0;
		let loggedSteadyStateBackpressure = false;

		console.log(
			`[StreamingVideoDecoder] Startup-safe decode backpressure active for first ${startupStabilizationSeconds}s (${startupFrameBudget} frames)`,
		);

		// Async frame queue — decoder pushes, consumer pulls
		this.pendingFrames.length = 0;
		const pendingFrames = this.pendingFrames;
		let frameResolve: ((frame: VideoFrame | null) => void) | null = null;
		let decodeError: Error | null = null;
		let decodeDone = false;
		let firstDecodedFrameTimestampUs: number | null = null;
		let decodedFrameTimelineOffsetUs = 0;

		this.decoder = new VideoDecoder({
			output: (frame: VideoFrame) => {
				if (frameResolve) {
					const resolve = frameResolve;
					frameResolve = null;
					resolve(frame);
				} else {
					pendingFrames.push(frame);
				}
			},
			error: (e: DOMException) => {
				decodeError = new Error(`VideoDecoder error: ${e.message}`);
				if (frameResolve) {
					const resolve = frameResolve;
					frameResolve = null;
					resolve(null);
				}
			},
		});
		const preferredDecoderConfig = shouldPreferSoftwareDecode
			? {
					...decoderConfig,
					hardwareAcceleration: "prefer-software" as const,
				}
			: decoderConfig;

		try {
			this.decoder.configure(preferredDecoderConfig);
		} catch (error) {
			if (!shouldPreferSoftwareDecode) {
				throw error;
			}
			// Fall back to default decoder config if software preference is unsupported.
			this.decoder.configure(decoderConfig);
		}

		const getNextFrame = (): Promise<VideoFrame | null> => {
			if (decodeError) throw decodeError;
			if (pendingFrames.length > 0) return Promise.resolve(pendingFrames.shift()!);
			if (decodeDone) return Promise.resolve(null);
			return new Promise((resolve) => {
				frameResolve = resolve;
			});
		};

		// One forward stream through the whole file.
		// Pass explicit range because some containers are truncated when no end is provided.
		const readEndSec =
			Math.max(
				this.metadata.duration + (this.metadata.mediaStartTime ?? 0),
				(this.metadata.streamDuration ?? this.metadata.duration) +
					(this.metadata.streamStartTime ?? this.metadata.mediaStartTime ?? 0),
			) + 0.5;
		const reader = this.demuxer.read("video", 0, readEndSec).getReader();

		// Feed chunks to decoder in background with backpressure
		const feedPromise = (async () => {
			try {
				while (!this.cancelled) {
					const { done, value: chunk } = await reader.read();
					if (done || !chunk) break;

					if (!loggedSteadyStateBackpressure && exportFrameIndex >= startupFrameBudget) {
						loggedSteadyStateBackpressure = true;
						console.log(
							"[StreamingVideoDecoder] Switched to steady-state decode backpressure",
						);
					}

					const decodeQueueLimit =
						exportFrameIndex < startupFrameBudget
							? Math.min(this.maxDecodeQueue, 10)
							: this.maxDecodeQueue;
					const pendingFrameLimit =
						exportFrameIndex < startupFrameBudget
							? Math.min(this.maxPendingFrames, 24)
							: this.maxPendingFrames;

					// Backpressure on both decode queue and decoded frame backlog.
					while (
						(this.decoder!.decodeQueueSize > decodeQueueLimit ||
							pendingFrames.length > pendingFrameLimit) &&
						!this.cancelled
					) {
						await new Promise((resolve) => setTimeout(resolve, 1));
					}
					if (this.cancelled) break;

					this.decoder!.decode(chunk);
				}

				if (!this.cancelled && this.decoder!.state === "configured") {
					await this.decoder!.flush();
				}
			} catch (e) {
				decodeError = e instanceof Error ? e : new Error(String(e));
			} finally {
				decodeDone = true;
				if (frameResolve) {
					const resolve = frameResolve;
					frameResolve = null;
					resolve(null);
				}
			}
		})();

		// Route decoded frames into segments by timestamp, then deliver with VFR→CFR resampling
		let segmentIdx = 0;
		let segmentFrameIndex = 0;
		let lastDecodedFrameSec: number | null = null;
		let heldFrame: VideoFrame | null = null;
		let heldFrameSec = 0;

		const emitHeldFrameForTarget = async (segment: {
			startSec: number;
			endSec: number;
			speed: number;
		}) => {
			if (!heldFrame) return false;
			const segmentFrameCount = segmentOutputFrameCounts[segmentIdx];
			if (segmentFrameIndex >= segmentFrameCount) return false;

			const segmentDurationSec = segment.endSec - segment.startSec;
			const sourceTimeSec =
				segment.startSec + (segmentFrameIndex / segmentFrameCount) * segmentDurationSec;
			if (sourceTimeSec >= segment.endSec - epsilonSec) return false;

			const clone = new VideoFrame(heldFrame, { timestamp: heldFrame.timestamp });
			const sourceTimestampMs = sourceTimeSec * 1000;
			await onFrame(
				clone,
				exportFrameIndex * frameDurationUs,
				sourceTimestampMs,
				sourceTimestampMs,
			);
			segmentFrameIndex++;
			exportFrameIndex++;
			return true;
		};

		while (!this.cancelled && segmentIdx < segments.length) {
			const frame = await getNextFrame();
			if (!frame) break;

			if (firstDecodedFrameTimestampUs === null) {
				firstDecodedFrameTimestampUs = frame.timestamp;
				decodedFrameTimelineOffsetUs = getDecodedFrameTimelineOffsetUs(
					firstDecodedFrameTimestampUs,
					this.metadata,
				);
			}

			const normalizedFrameTimeSec = Math.max(
				0,
				(frame.timestamp - firstDecodedFrameTimestampUs + decodedFrameTimelineOffsetUs) /
					1_000_000,
			);
			const frameTimeSec: number =
				lastDecodedFrameSec === null
					? normalizedFrameTimeSec
					: Math.max(lastDecodedFrameSec, normalizedFrameTimeSec);
			lastDecodedFrameSec = frameTimeSec;

			// Finalize completed segments before handling this frame.
			while (
				segmentIdx < segments.length &&
				frameTimeSec >= segments[segmentIdx].endSec - epsilonSec
			) {
				const segment = segments[segmentIdx];
				while (!this.cancelled && (await emitHeldFrameForTarget(segment))) {
					// Keep emitting remaining output frames for this segment from the last known frame.
				}

				segmentIdx++;
				segmentFrameIndex = 0;
				if (
					heldFrame &&
					segmentIdx < segments.length &&
					heldFrameSec < segments[segmentIdx].startSec - epsilonSec
				) {
					heldFrame.close();
					heldFrame = null;
				}
			}

			if (segmentIdx >= segments.length) {
				frame.close();
				continue;
			}

			const currentSegment = segments[segmentIdx];

			// Before current segment (trimmed region or pre-roll).
			if (frameTimeSec < currentSegment.startSec - epsilonSec) {
				frame.close();
				continue;
			}

			if (!heldFrame) {
				heldFrame = frame;
				heldFrameSec = frameTimeSec;
				continue;
			}

			// Any target timestamp before this midpoint is closer to heldFrame than current frame.
			const handoffBoundarySec = (heldFrameSec + frameTimeSec) / 2;
			while (!this.cancelled) {
				const segmentFrameCount = segmentOutputFrameCounts[segmentIdx];
				if (segmentFrameIndex >= segmentFrameCount) {
					break;
				}

				const segmentDurationSec = currentSegment.endSec - currentSegment.startSec;
				const sourceTimeSec =
					currentSegment.startSec +
					(segmentFrameIndex / segmentFrameCount) * segmentDurationSec;
				if (sourceTimeSec >= currentSegment.endSec - epsilonSec) {
					break;
				}
				if (sourceTimeSec > handoffBoundarySec) {
					break;
				}

				const clone = new VideoFrame(heldFrame, { timestamp: heldFrame.timestamp });
				const sourceTimestampMs = sourceTimeSec * 1000;
				await onFrame(
					clone,
					exportFrameIndex * frameDurationUs,
					sourceTimestampMs,
					sourceTimestampMs,
				);
				segmentFrameIndex++;
				exportFrameIndex++;
			}

			heldFrame.close();
			heldFrame = frame;
			heldFrameSec = frameTimeSec;
		}

		// Flush remaining output frames for the last decoded frame.
		if (heldFrame && segmentIdx < segments.length) {
			while (!this.cancelled && segmentIdx < segments.length) {
				const segment = segments[segmentIdx];
				if (heldFrameSec < segment.startSec - epsilonSec) {
					break;
				}

				while (!this.cancelled && (await emitHeldFrameForTarget(segment))) {
					// Keep emitting output frames for the active segment.
				}

				segmentIdx++;
				segmentFrameIndex = 0;
				if (
					segmentIdx < segments.length &&
					heldFrameSec < segments[segmentIdx].startSec - epsilonSec
				) {
					break;
				}
			}
			heldFrame.close();
			heldFrame = null;
		} else if (heldFrame) {
			heldFrame.close();
			heldFrame = null;
		}

		// Drain leftover decoded frames
		while (!decodeDone) {
			const frame = await getNextFrame();
			if (!frame) break;
			frame.close();
		}

		try {
			reader.cancel();
		} catch {
			/* already closed */
		}
		await feedPromise;
		for (const f of pendingFrames) f.close();
		pendingFrames.length = 0;

		if (this.decoder?.state === "configured") {
			this.decoder.close();
		}
		this.decoder = null;

		const requiredEndSec = segments.length > 0 ? segments[segments.length - 1].endSec : 0;
		if (
			!this.cancelled &&
			lastDecodedFrameSec !== null &&
			requiredEndSec - lastDecodedFrameSec > 1 &&
			exportFrameIndex < expectedOutputFrames
		) {
			throw new Error(
				`Video decode ended early at ${lastDecodedFrameSec.toFixed(3)}s (needed ${requiredEndSec.toFixed(3)}s; rendered ${exportFrameIndex}/${expectedOutputFrames} frames).`,
			);
		}
	}

	private computeSegments(
		totalDuration: number,
		trimRegions?: TrimRegion[],
	): Array<{ startSec: number; endSec: number }> {
		if (!trimRegions || trimRegions.length === 0) {
			return [{ startSec: 0, endSec: totalDuration }];
		}

		const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
		const segments: Array<{ startSec: number; endSec: number }> = [];
		let cursor = 0;

		for (const trim of sorted) {
			const trimStart = trim.startMs / 1000;
			const trimEnd = trim.endMs / 1000;
			if (cursor < trimStart) {
				segments.push({ startSec: cursor, endSec: trimStart });
			}
			cursor = Math.max(cursor, trimEnd);
		}

		if (cursor < totalDuration) {
			segments.push({ startSec: cursor, endSec: totalDuration });
		}

		return segments;
	}

	getEffectiveDuration(trimRegions?: TrimRegion[], speedRegions?: SpeedRegion[]): number {
		if (!this.metadata) throw new Error("Must call loadMetadata() first");
		const trimSegments = this.computeSegments(
			getEffectiveVideoStreamDurationSeconds({
				duration: this.metadata.duration,
				streamDuration: this.metadata.streamDuration,
			}),
			trimRegions,
		);
		const speedSegments = this.splitBySpeed(trimSegments, speedRegions);
		return speedSegments.reduce((sum, seg) => sum + (seg.endSec - seg.startSec) / seg.speed, 0);
	}

	private splitBySpeed(
		segments: Array<{ startSec: number; endSec: number }>,
		speedRegions?: SpeedRegion[],
	): Array<{ startSec: number; endSec: number; speed: number }> {
		if (!speedRegions || speedRegions.length === 0)
			return segments.map((s) => ({ ...s, speed: 1 }));

		const result: Array<{ startSec: number; endSec: number; speed: number }> = [];
		for (const segment of segments) {
			const overlapping = speedRegions
				.filter(
					(sr) =>
						sr.startMs / 1000 < segment.endSec && sr.endMs / 1000 > segment.startSec,
				)
				.sort((a, b) => a.startMs - b.startMs);

			if (overlapping.length === 0) {
				result.push({ ...segment, speed: 1 });
				continue;
			}

			let cursor = segment.startSec;
			for (const sr of overlapping) {
				const srStart = Math.max(sr.startMs / 1000, segment.startSec);
				const srEnd = Math.min(sr.endMs / 1000, segment.endSec);
				if (cursor < srStart) {
					result.push({ startSec: cursor, endSec: srStart, speed: 1 });
				}
				const effectiveStart = Math.max(cursor, srStart);
				if (srEnd > effectiveStart) {
					result.push({ startSec: effectiveStart, endSec: srEnd, speed: sr.speed });
				}
				cursor = Math.max(cursor, srEnd);
			}
			if (cursor < segment.endSec)
				result.push({ startSec: cursor, endSec: segment.endSec, speed: 1 });
		}
		return result.filter((s) => s.endSec - s.startSec > 0.0001);
	}

	cancel(): void {
		this.cancelled = true;
	}

	getDemuxer() {
		return this.demuxer;
	}

	destroy(): void {
		this.cancelled = true;

		if (this.decoder) {
			try {
				if (this.decoder.state === "configured") this.decoder.close();
			} catch {
				/* ignore */
			}
			this.decoder = null;
		}

		if (this.demuxer) {
			try {
				this.demuxer.destroy();
			} catch {
				/* ignore */
			}
			this.demuxer = null;
		}

		for (const frame of this.pendingFrames) {
			try {
				frame.close();
			} catch {
				/* ignore */
			}
		}
		this.pendingFrames.length = 0;
	}
}
