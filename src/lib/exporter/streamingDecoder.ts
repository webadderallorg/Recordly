import { WebDemuxer } from "web-demuxer";
import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import {
	buildDecodeSegments,
	destroyStreamingDecoderResources,
	getEffectiveDecodedDuration,
	loadStreamingVideoMetadata,
} from "./streamingDecoderHelpers";

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

	async loadMetadata(videoUrl: string): Promise<DecodedVideoInfo> {
		destroyStreamingDecoderResources({
			decoder: this.decoder,
			demuxer: this.demuxer,
			pendingFrames: this.pendingFrames,
		});
		this.decoder = null;
		this.demuxer = null;

		const loaded = await loadStreamingVideoMetadata(videoUrl);
		this.demuxer = loaded.demuxer;
		this.metadata = loaded.metadata;

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
		const segments = buildDecodeSegments(this.metadata, trimRegions, speedRegions);
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

	getEffectiveDuration(trimRegions?: TrimRegion[], speedRegions?: SpeedRegion[]): number {
		if (!this.metadata) throw new Error("Must call loadMetadata() first");
		return getEffectiveDecodedDuration(this.metadata, trimRegions, speedRegions);
	}

	cancel(): void {
		this.cancelled = true;
	}

	getDemuxer() {
		return this.demuxer;
	}

	destroy(): void {
		this.cancelled = true;
		destroyStreamingDecoderResources({
			decoder: this.decoder,
			demuxer: this.demuxer,
			pendingFrames: this.pendingFrames,
		});
		this.decoder = null;
		this.demuxer = null;
	}
}
