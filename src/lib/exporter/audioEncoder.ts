import { WebDemuxer } from "web-demuxer";
import type {
	AudioRegion,
	ClipRegion,
	SpeedRegion,
	TrimRegion,
} from "@/components/video-editor/types";
import { estimateCompanionAudioStartDelaySeconds } from "@/lib/mediaTiming";
import { resolveMediaElementSource } from "./localMediaSource";
import type { VideoMuxer } from "./muxer";
import { resolveSourceAudioFallbackPaths } from "./sourceAudioFallback";

const AUDIO_BITRATE = 128_000;
const DECODE_BACKPRESSURE_LIMIT = 20;
const ENCODE_BACKPRESSURE_LIMIT = 20;
const MIN_SPEED_REGION_DELTA_MS = 0.0001;
const MP4_AUDIO_CODEC = "mp4a.40.2";
const OFFLINE_AUDIO_SAMPLE_RATE = 48_000;
const OFFLINE_ENCODE_CHUNK_FRAMES = 1024;
const OFFLINE_CHUNK_DURATION_SEC = 30;

interface TimelineSlice {
	sourceStartMs: number;
	sourceEndMs: number;
	speed: number;
}

interface PreparedOfflineRender {
	mainBuffer: AudioBuffer | null;
	companionEntries: Array<{ buffer: AudioBuffer; startDelaySec: number }>;
	regionEntries: Array<{ buffer: AudioBuffer; region: AudioRegion }>;
	slices: TimelineSlice[];
	outputDurationMs: number;
	numChannels: number;
}

export async function isAacAudioEncodingSupported(
	sampleRate = 48_000,
	numberOfChannels = 2,
): Promise<boolean> {
	try {
		const support = await AudioEncoder.isConfigSupported({
			codec: MP4_AUDIO_CODEC,
			sampleRate,
			numberOfChannels,
			bitrate: AUDIO_BITRATE,
		});
		return support.supported === true;
	} catch {
		return false;
	}
}

type TrimLikeRegion = TrimRegion | ClipRegion;

export class AudioProcessor {
	private cancelled = false;
	private onProgress?: (progress: number) => void;

	private isPassthroughAudioCodec(codec: string | undefined): boolean {
		if (!codec) {
			return false;
		}

		const normalizedCodec = codec.toLowerCase();
		return (
			normalizedCodec === MP4_AUDIO_CODEC ||
			normalizedCodec === "aac" ||
			normalizedCodec.startsWith("mp4a.40.2")
		);
	}

	private async passthroughAudioStream(
		audioStream: ReadableStream<EncodedAudioChunk>,
		audioConfig: AudioDecoderConfig,
		muxer: VideoMuxer,
	): Promise<boolean> {
		if (!this.isPassthroughAudioCodec(audioConfig.codec)) {
			return false;
		}

		let reader: ReadableStreamDefaultReader<EncodedAudioChunk> | null = null;
		let wroteAudio = false;
		let passthroughTimestampOffsetUs: number | null = null;

		try {
			reader = audioStream.getReader();
			while (!this.cancelled) {
				const { done, value: chunk } = await reader.read();
				if (done || !chunk) break;

				if (passthroughTimestampOffsetUs === null) {
					passthroughTimestampOffsetUs = chunk.timestamp;
				}

				const normalizedTimestamp = Math.max(
					0,
					chunk.timestamp - passthroughTimestampOffsetUs,
				);
				const outputChunk =
					passthroughTimestampOffsetUs === 0
						? chunk
						: this.cloneEncodedAudioChunkWithTimestamp(chunk, normalizedTimestamp);

				await muxer.addAudioChunk(
					outputChunk,
					wroteAudio
						? undefined
						: {
								decoderConfig: audioConfig,
							},
				);
				wroteAudio = true;
			}
		} finally {
			if (reader) {
				try {
					await reader.cancel();
				} catch {
					// reader already closed
				}
			}
		}

		return wroteAudio;
	}

	/**
	 * Audio export has two modes:
	 * 1) no speed regions -> fast WebCodecs trim-only pipeline
	 * 2) speed regions present -> pitch-preserving rendered timeline pipeline
	 */
	setOnProgress(callback: (progress: number) => void) {
		this.onProgress = callback;
	}

	async process(
		demuxer: WebDemuxer | null,
		muxer: VideoMuxer,
		videoUrl: string,
		trimRegions?: TrimLikeRegion[],
		speedRegions?: SpeedRegion[],
		readEndSec?: number,
		audioRegions?: AudioRegion[],
		sourceAudioFallbackPaths?: string[],
		sourceAudioFallbackStartDelayMsByPath?: Record<string, number>,
	): Promise<void> {
		const sortedTrims = trimRegions
			? [...trimRegions].sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedSpeedRegions = speedRegions
			? [...speedRegions]
					.filter((region) => region.endMs - region.startMs > MIN_SPEED_REGION_DELTA_MS)
					.sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedAudioRegions = audioRegions
			? [...audioRegions].sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedSourceAudioFallbackPaths = sourceAudioFallbackPaths
			? sourceAudioFallbackPaths.filter(
					(audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0,
				)
			: [];
		const { hasEmbeddedSourceAudio, externalAudioPaths } = resolveSourceAudioFallbackPaths(
			videoUrl,
			sortedSourceAudioFallbackPaths,
		);
		const hasTimedCompanionAudio = externalAudioPaths.some(
			(audioPath) => (sourceAudioFallbackStartDelayMsByPath?.[audioPath] ?? 0) > 0,
		);
		const needsSourceAudioMixing =
			externalAudioPaths.length > 1 ||
			(hasEmbeddedSourceAudio && externalAudioPaths.length > 0) ||
			hasTimedCompanionAudio;

		// When speed edits, audio regions, or multiple audio sources need mixing, use offline AudioContext pipeline.
		if (
			sortedSpeedRegions.length > 0 ||
			sortedAudioRegions.length > 0 ||
			needsSourceAudioMixing
		) {
			await this.renderAndMuxOfflineAudio(
				videoUrl,
				sortedTrims,
				sortedSpeedRegions,
				sortedAudioRegions,
				sortedSourceAudioFallbackPaths,
				sourceAudioFallbackStartDelayMsByPath,
				muxer,
			);
			return;
		}

		// Single sidecar audio with no speed/audio edits: demux directly (skips slow real-time rendering).
		if (!hasEmbeddedSourceAudio && externalAudioPaths.length === 1) {
			const sidecarDemuxer = await this.loadAudioFileDemuxer(externalAudioPaths[0]);
			if (sidecarDemuxer) {
				try {
					await this.processTrimOnlyAudio(sidecarDemuxer, muxer, sortedTrims);
				} finally {
					try {
						sidecarDemuxer.destroy();
					} catch {
						/* cleanup */
					}
				}
				return;
			}
			// Fallback to offline rendering if demuxer creation failed
			console.warn(
				"[AudioProcessor] Fast sidecar demux failed, falling back to offline rendering",
			);
			await this.renderAndMuxOfflineAudio(
				videoUrl,
				sortedTrims,
				[],
				[],
				externalAudioPaths,
				sourceAudioFallbackStartDelayMsByPath,
				muxer,
			);
			return;
		}

		// No speed edits or audio regions: keep the original demux/decode/encode path with trim timestamp remap.
		if (!demuxer) {
			console.warn("[AudioProcessor] No demuxer available, skipping audio");
			return;
		}

		if (sortedTrims.length === 0) {
			let audioConfig: AudioDecoderConfig;
			try {
				audioConfig = (await demuxer.getDecoderConfig("audio")) as AudioDecoderConfig;
			} catch {
				console.warn("[AudioProcessor] No audio track found, skipping");
				return;
			}

			const audioStream =
				typeof readEndSec === "number"
					? demuxer.read("audio", 0, readEndSec)
					: demuxer.read("audio");

			const copiedSourceAudio = await this.passthroughAudioStream(
				audioStream as ReadableStream<EncodedAudioChunk>,
				audioConfig,
				muxer,
			);

			if (copiedSourceAudio) {
				return;
			}
		}

		await this.processTrimOnlyAudio(demuxer, muxer, sortedTrims, readEndSec);
	}

	async renderEditedAudioTrack(
		videoUrl: string,
		trimRegions?: TrimLikeRegion[],
		speedRegions?: SpeedRegion[],
		audioRegions?: AudioRegion[],
		sourceAudioFallbackPaths?: string[],
		sourceAudioFallbackStartDelayMsByPath?: Record<string, number>,
	): Promise<Blob> {
		const sortedTrims = trimRegions
			? [...trimRegions].sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedSpeedRegions = speedRegions
			? [...speedRegions]
					.filter((region) => region.endMs - region.startMs > MIN_SPEED_REGION_DELTA_MS)
					.sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedAudioRegions = audioRegions
			? [...audioRegions].sort((a, b) => a.startMs - b.startMs)
			: [];
		const sortedSourceAudioFallbackPaths = sourceAudioFallbackPaths
			? sourceAudioFallbackPaths.filter(
					(audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0,
				)
			: [];

		const prepared = await this.prepareOfflineRender(
			videoUrl,
			sortedTrims,
			sortedSpeedRegions,
			sortedAudioRegions,
			sortedSourceAudioFallbackPaths,
			sourceAudioFallbackStartDelayMsByPath,
		);
		return this.renderToWavBlobChunked(prepared);
	}

	// Legacy trim-only path used when no speed regions are configured.
	private async processTrimOnlyAudio(
		demuxer: WebDemuxer,
		muxer: VideoMuxer,
		sortedTrims: TrimLikeRegion[],
		readEndSec?: number,
	): Promise<void> {
		let audioConfig: AudioDecoderConfig;
		try {
			audioConfig = (await demuxer.getDecoderConfig("audio")) as AudioDecoderConfig;
		} catch {
			console.warn("[AudioProcessor] No audio track found, skipping");
			return;
		}

		const codecCheck = await AudioDecoder.isConfigSupported(audioConfig);
		if (!codecCheck.supported) {
			console.warn("[AudioProcessor] Audio codec not supported:", audioConfig.codec);
			return;
		}

		const audioStream =
			typeof readEndSec === "number"
				? demuxer.read("audio", 0, readEndSec)
				: demuxer.read("audio");

		let sourceTimestampOffsetUs: number | null = null;

		await this.transcodeAudioStream(
			audioStream as ReadableStream<EncodedAudioChunk>,
			audioConfig,
			muxer,
			{
				observeChunkTimestampUs: (timestampUs) => {
					if (sourceTimestampOffsetUs === null) {
						sourceTimestampOffsetUs = timestampUs;
					}
				},
				shouldSkipChunk: (timestampMs) => this.isInTrimRegion(timestampMs, sortedTrims),
				transformAudioData: (data) => {
					const timestampMs = data.timestamp / 1000;
					const trimOffsetMs = this.computeTrimOffset(timestampMs, sortedTrims);
					const adjustedTimestampUs =
						data.timestamp - (sourceTimestampOffsetUs ?? 0) - trimOffsetMs * 1000;
					return this.cloneWithTimestamp(data, Math.max(0, adjustedTimestampUs));
				},
			},
		);
	}

	private async transcodeAudioStream(
		audioStream: ReadableStream<EncodedAudioChunk>,
		audioConfig: AudioDecoderConfig,
		muxer: VideoMuxer,
		options: {
			observeChunkTimestampUs?: (timestampUs: number) => void;
			shouldSkipChunk?: (timestampMs: number) => boolean;
			transformAudioData?: (data: AudioData) => AudioData | null;
		} = {},
	): Promise<void> {
		const pendingFrames: AudioData[] = [];
		let decodeError: Error | null = null;
		let encodeError: Error | null = null;
		let muxError: Error | null = null;
		let pendingMuxing = Promise.resolve();
		const capacityWaiters = new Set<() => void>();

		const notifyCapacityAvailable = () => {
			if (capacityWaiters.size === 0) {
				return;
			}

			const waiters = [...capacityWaiters];
			capacityWaiters.clear();
			for (const resolve of waiters) {
				resolve();
			}
		};

		const waitForCapacity = () =>
			new Promise<void>((resolve) => {
				capacityWaiters.add(resolve);
			});

		const failIfNeeded = () => {
			if (decodeError) throw decodeError;
			if (encodeError) throw encodeError;
			if (muxError) throw muxError;
		};

		const pumpEncodedFrames = () => {
			while (!this.cancelled && pendingFrames.length > 0) {
				if (encodeError || muxError) {
					break;
				}
				if (encoder.encodeQueueSize >= ENCODE_BACKPRESSURE_LIMIT) {
					break;
				}

				const frame = pendingFrames.shift();
				if (!frame) {
					break;
				}

				encoder.encode(frame);
				frame.close();
				notifyCapacityAvailable();
			}
		};

		const cleanupPendingFrames = () => {
			for (const frame of pendingFrames) {
				frame.close();
			}
			pendingFrames.length = 0;
		};

		const sampleRate = audioConfig.sampleRate || 48_000;
		const channels = audioConfig.numberOfChannels || 2;
		const encodeConfig: AudioEncoderConfig = {
			codec: MP4_AUDIO_CODEC,
			sampleRate,
			numberOfChannels: channels,
			bitrate: AUDIO_BITRATE,
		};

		const encodeSupport = await AudioEncoder.isConfigSupported(encodeConfig);
		if (!encodeSupport.supported) {
			console.warn("[AudioProcessor] AAC encoding not supported, skipping audio");
			return;
		}

		const encoder = new AudioEncoder({
			output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
				pendingMuxing = pendingMuxing
					.then(async () => {
						if (this.cancelled) {
							return;
						}
						await muxer.addAudioChunk(chunk, meta);
					})
					.catch((error) => {
						muxError = error instanceof Error ? error : new Error(String(error));
						notifyCapacityAvailable();
					});
				notifyCapacityAvailable();
			},
			error: (error: DOMException) => {
				encodeError = new Error(`[AudioProcessor] Encode error: ${error.message}`);
				notifyCapacityAvailable();
			},
		});

		encoder.configure(encodeConfig);

		const decoder = new AudioDecoder({
			output: (data: AudioData) => {
				if (this.cancelled || encodeError || muxError) {
					data.close();
					return;
				}

				const transformed = options.transformAudioData
					? options.transformAudioData(data)
					: data;

				if (transformed !== data) {
					data.close();
				}

				if (!transformed) {
					return;
				}

				pendingFrames.push(transformed);
				notifyCapacityAvailable();
			},
			error: (error: DOMException) => {
				decodeError = new Error(`[AudioProcessor] Decode error: ${error.message}`);
				notifyCapacityAvailable();
			},
		});
		decoder.configure(audioConfig);

		let reader: ReadableStreamDefaultReader<EncodedAudioChunk> | null = null;

		try {
			reader = audioStream.getReader();
			while (!this.cancelled) {
				failIfNeeded();

				const { done, value: chunk } = await reader.read();
				if (done || !chunk) break;

				options.observeChunkTimestampUs?.(chunk.timestamp);
				const timestampMs = chunk.timestamp / 1000;
				if (options.shouldSkipChunk?.(timestampMs)) continue;

				decoder.decode(chunk);
				pumpEncodedFrames();

				while (
					!this.cancelled &&
					(decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT ||
						pendingFrames.length > DECODE_BACKPRESSURE_LIMIT ||
						encoder.encodeQueueSize >= ENCODE_BACKPRESSURE_LIMIT)
				) {
					failIfNeeded();
					pumpEncodedFrames();
					await waitForCapacity();
				}
			}

			if (decoder.state === "configured") {
				await decoder.flush();
			}

			while (!this.cancelled && (pendingFrames.length > 0 || encoder.encodeQueueSize > 0)) {
				failIfNeeded();
				pumpEncodedFrames();
				if (pendingFrames.length > 0 || encoder.encodeQueueSize > 0) {
					await waitForCapacity();
				}
			}

			failIfNeeded();

			if (encoder.state === "configured") {
				await encoder.flush();
			}

			await pendingMuxing;
			failIfNeeded();
		} finally {
			notifyCapacityAvailable();
			if (reader) {
				try {
					await reader.cancel();
				} catch {
					// reader already closed
				}
			}

			cleanupPendingFrames();

			if (decoder.state === "configured") {
				decoder.close();
			}

			if (encoder.state === "configured") {
				encoder.close();
			}
		}

		if (this.cancelled) {
			return;
		}
	}

	// ---------- Offline audio rendering pipeline ----------
	// Replaces the old real-time MediaElement+MediaRecorder approach with
	// OfflineAudioContext, which renders as fast as the CPU allows instead of
	// waiting for 1× real-time playback.

	private async renderAndMuxOfflineAudio(
		videoUrl: string,
		trimRegions: TrimLikeRegion[],
		speedRegions: SpeedRegion[],
		audioRegions: AudioRegion[],
		sourceAudioFallbackPaths: string[],
		sourceAudioFallbackStartDelayMsByPath: Record<string, number> | undefined,
		muxer: VideoMuxer,
	): Promise<void> {
		const prepared = await this.prepareOfflineRender(
			videoUrl,
			trimRegions,
			speedRegions,
			audioRegions,
			sourceAudioFallbackPaths,
			sourceAudioFallbackStartDelayMsByPath,
		);
		if (this.cancelled) return;
		await this.renderAndEncodeChunked(prepared, muxer);
	}

	private async prepareOfflineRender(
		videoUrl: string,
		trimRegions: TrimLikeRegion[],
		speedRegions: SpeedRegion[],
		audioRegions: AudioRegion[],
		sourceAudioFallbackPaths: string[],
		sourceAudioFallbackStartDelayMsByPath?: Record<string, number>,
	): Promise<PreparedOfflineRender> {
		if (this.cancelled) throw new Error("Export cancelled");
		this.onProgress?.(0);

		const { externalAudioPaths } = resolveSourceAudioFallbackPaths(
			videoUrl,
			sourceAudioFallbackPaths,
		);

		// Decode embedded source audio separately from companion sidecars.
		const mainBuffer = await this.decodeAudioFromUrl(videoUrl);
		if (this.cancelled) throw new Error("Export cancelled");

		// Decode companion / sidecar audio files
		const companionEntries: Array<{ buffer: AudioBuffer; startDelaySec: number }> = [];
		const refDuration =
			mainBuffer?.duration ??
			(externalAudioPaths.length > 0 ? await this.getMediaDurationSec(videoUrl) : 0);
		for (const audioPath of externalAudioPaths) {
			if (this.cancelled) throw new Error("Export cancelled");
			const buffer = await this.decodeAudioFromUrl(audioPath);
			if (!buffer) continue;

			companionEntries.push({
				buffer,
				startDelaySec: estimateCompanionAudioStartDelaySeconds(
					refDuration,
					buffer.duration,
					sourceAudioFallbackStartDelayMsByPath?.[audioPath],
				),
			});
		}
		if (this.cancelled) throw new Error("Export cancelled");

		// Decode audio region overlay files
		const regionEntries: Array<{ buffer: AudioBuffer; region: AudioRegion }> = [];
		for (const region of audioRegions) {
			if (this.cancelled) throw new Error("Export cancelled");
			const buffer = await this.decodeAudioFromUrl(region.audioPath);
			if (buffer) regionEntries.push({ buffer, region });
		}

		this.onProgress?.(0.2);

		// Determine source duration for timeline calculation
		const primaryBuffer = mainBuffer ?? companionEntries[0]?.buffer ?? null;
		if (!primaryBuffer && regionEntries.length === 0) {
			throw new Error("No decodable audio sources found");
		}

		let sourceDurationSec: number;
		if (mainBuffer) {
			sourceDurationSec = mainBuffer.duration;
		} else if (externalAudioPaths.length > 0 || regionEntries.length > 0) {
			sourceDurationSec = await this.getMediaDurationSec(videoUrl);
		} else {
			sourceDurationSec = primaryBuffer?.duration ?? 0;
		}
		const sourceDurationMs = sourceDurationSec * 1000;

		// Build timeline slices (non-trimmed segments with speed info)
		const slices = this.buildTimelineSlices(sourceDurationMs, trimRegions, speedRegions);

		let outputDurationMs = 0;
		for (const slice of slices) {
			outputDurationMs += (slice.sourceEndMs - slice.sourceStartMs) / slice.speed;
		}

		// Extend for audio regions that might exceed the video timeline
		for (const { region } of regionEntries) {
			const regionEndOutput = this.sourceTimeToOutputTime(region.endMs, slices);
			outputDurationMs = Math.max(outputDurationMs, regionEndOutput);
		}

		const numChannels = Math.min(primaryBuffer?.numberOfChannels ?? 2, 2);

		return {
			mainBuffer,
			companionEntries,
			regionEntries,
			slices,
			outputDurationMs,
			numChannels,
		};
	}

	// Render timeline in chunks and encode each chunk to the muxer immediately.
	// Memory is bounded to ~OFFLINE_CHUNK_DURATION_SEC of PCM per chunk
	// instead of holding the entire output buffer in memory.
	private async renderAndEncodeChunked(
		prepared: PreparedOfflineRender,
		muxer: VideoMuxer,
	): Promise<void> {
		const { numChannels } = prepared;
		const totalOutputSec = Math.max(prepared.outputDurationMs / 1000, 0.01);

		let encodeError: Error | null = null;
		let muxError: Error | null = null;
		let pendingMuxing = Promise.resolve();
		let wroteFirstChunk = false;

		const encodeConfig: AudioEncoderConfig = {
			codec: MP4_AUDIO_CODEC,
			sampleRate: OFFLINE_AUDIO_SAMPLE_RATE,
			numberOfChannels: numChannels,
			bitrate: AUDIO_BITRATE,
		};

		const supported = await AudioEncoder.isConfigSupported(encodeConfig);
		if (!supported.supported) {
			console.warn("[AudioProcessor] AAC encoding not supported for offline audio");
			return;
		}

		const encoder = new AudioEncoder({
			output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
				pendingMuxing = pendingMuxing
					.then(async () => {
						if (this.cancelled) return;
						await muxer.addAudioChunk(chunk, !wroteFirstChunk ? meta : undefined);
						wroteFirstChunk = true;
					})
					.catch((error) => {
						muxError = error instanceof Error ? error : new Error(String(error));
					});
			},
			error: (error: DOMException) => {
				encodeError = new Error(`Audio encode error: ${error.message}`);
			},
		});
		encoder.configure(encodeConfig);

		try {
			await this.renderChunked(
				prepared,
				totalOutputSec,
				async (rendered, outputOffsetSec) => {
					if (encodeError) throw encodeError;
					if (muxError) throw muxError;
					await this.feedBufferToEncoder(encoder, rendered, outputOffsetSec);
				},
			);

			if (encodeError) throw encodeError;
			if (muxError) throw muxError;

			if (encoder.state === "configured") {
				await encoder.flush();
			}

			await pendingMuxing;

			if (encodeError) throw encodeError;
			if (muxError) throw muxError;
		} finally {
			if (encoder.state === "configured") {
				encoder.close();
			}
		}
	}

	// Render timeline to a WAV blob for the native/FFmpeg export path.
	// Processes in chunks to avoid holding the entire output in memory.
	private async renderToWavBlobChunked(prepared: PreparedOfflineRender): Promise<Blob> {
		const totalOutputSec = Math.max(prepared.outputDurationMs / 1000, 0.01);
		const totalFrames = Math.ceil(totalOutputSec * OFFLINE_AUDIO_SAMPLE_RATE);
		const numChannels = prepared.numChannels;

		const header = this.createWavHeader(OFFLINE_AUDIO_SAMPLE_RATE, numChannels, totalFrames);
		const pcmParts: ArrayBuffer[] = [header];

		await this.renderChunked(prepared, totalOutputSec, async (rendered) => {
			pcmParts.push(...this.audioBufferToPcmParts(rendered));
		});

		return new Blob(pcmParts, { type: "audio/wav" });
	}

	// Shared chunked rendering loop. Processes the timeline in
	// OFFLINE_CHUNK_DURATION_SEC segments, calling onChunk for each rendered buffer.
	private async renderChunked(
		prepared: PreparedOfflineRender,
		totalOutputSec: number,
		onChunk: (
			rendered: AudioBuffer,
			outputOffsetSec: number,
			chunkIndex: number,
		) => Promise<void>,
	): Promise<void> {
		const { slices, numChannels } = prepared;
		let outputOffsetSec = 0;
		const chunkCount = Math.ceil(totalOutputSec / OFFLINE_CHUNK_DURATION_SEC);

		for (let i = 0; i < chunkCount && !this.cancelled; i++) {
			const chunkSec = Math.min(OFFLINE_CHUNK_DURATION_SEC, totalOutputSec - outputOffsetSec);
			const chunkFrames = Math.ceil(chunkSec * OFFLINE_AUDIO_SAMPLE_RATE);

			const offlineCtx = new OfflineAudioContext(
				numChannels,
				chunkFrames,
				OFFLINE_AUDIO_SAMPLE_RATE,
			);

			// Schedule main audio
			if (prepared.mainBuffer) {
				this.scheduleBufferThroughTimeline(
					offlineCtx,
					prepared.mainBuffer,
					slices,
					0,
					outputOffsetSec,
					chunkSec,
				);
			}

			// Schedule companion/sidecar audio
			for (const entry of prepared.companionEntries) {
				this.scheduleBufferThroughTimeline(
					offlineCtx,
					entry.buffer,
					slices,
					entry.startDelaySec,
					outputOffsetSec,
					chunkSec,
				);
			}

			// Schedule audio region overlays
			for (const { buffer, region } of prepared.regionEntries) {
				this.scheduleRegionForChunk(
					offlineCtx,
					buffer,
					region,
					slices,
					outputOffsetSec,
					chunkSec,
				);
			}

			const rendered = await offlineCtx.startRendering();
			if (this.cancelled) break;

			await onChunk(rendered, outputOffsetSec, i);

			outputOffsetSec += chunkSec;
			this.onProgress?.(0.3 + (outputOffsetSec / totalOutputSec) * 0.7);
		}
	}

	// Schedule an audio region overlay clipped to a specific chunk window.
	private scheduleRegionForChunk(
		ctx: OfflineAudioContext,
		buffer: AudioBuffer,
		region: AudioRegion,
		slices: TimelineSlice[],
		chunkOutputStartSec: number,
		chunkDurationSec: number,
	): void {
		const outputStartMs = this.sourceTimeToOutputTime(region.startMs, slices);
		const outputEndMs = this.sourceTimeToOutputTime(region.endMs, slices);

		let localStartSec = outputStartMs / 1000 - chunkOutputStartSec;
		let localEndSec = outputEndMs / 1000 - chunkOutputStartSec;

		// Skip if region doesn't overlap with this chunk
		if (localEndSec <= 0 || localStartSec >= chunkDurationSec) return;

		// Clip to chunk bounds
		let bufferOffsetSec = 0;
		if (localStartSec < 0) {
			bufferOffsetSec = -localStartSec;
			localStartSec = 0;
		}
		if (localEndSec > chunkDurationSec) {
			localEndSec = chunkDurationSec;
		}

		const duration = Math.min(localEndSec - localStartSec, buffer.duration - bufferOffsetSec);
		if (duration <= 0.001) return;

		const gainNode = ctx.createGain();
		gainNode.gain.value = Math.max(0, Math.min(1, region.volume));
		gainNode.connect(ctx.destination);

		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(gainNode);
		source.start(localStartSec, bufferOffsetSec, duration);
	}

	// Feed a rendered AudioBuffer chunk to an AudioEncoder with a timestamp offset.
	private async feedBufferToEncoder(
		encoder: AudioEncoder,
		buffer: AudioBuffer,
		timestampOffsetSec: number,
	): Promise<void> {
		const sampleRate = buffer.sampleRate;
		const numChannels = buffer.numberOfChannels;
		const totalFrames = buffer.length;

		for (
			let offset = 0;
			offset < totalFrames && !this.cancelled;
			offset += OFFLINE_ENCODE_CHUNK_FRAMES
		) {
			const frameCount = Math.min(OFFLINE_ENCODE_CHUNK_FRAMES, totalFrames - offset);

			const planarData = new Float32Array(frameCount * numChannels);
			for (let ch = 0; ch < numChannels; ch++) {
				const channelData = buffer.getChannelData(ch);
				planarData.set(channelData.subarray(offset, offset + frameCount), ch * frameCount);
			}

			const audioData = new AudioData({
				format: "f32-planar",
				sampleRate,
				numberOfFrames: frameCount,
				numberOfChannels: numChannels,
				timestamp: Math.round((offset / sampleRate + timestampOffsetSec) * 1_000_000),
				data: planarData,
			});

			encoder.encode(audioData);
			audioData.close();

			while (encoder.encodeQueueSize >= ENCODE_BACKPRESSURE_LIMIT && !this.cancelled) {
				await new Promise((r) => setTimeout(r, 1));
			}
		}
	}

	// Decode audio from a URL using streaming WebCodecs decode with bulk fallback.
	// Streaming decode avoids holding the full compressed file in memory alongside
	// the decoded AudioBuffer, reducing peak memory for large recordings.
	private async decodeAudioFromUrl(url: string): Promise<AudioBuffer | null> {
		try {
			const buffer = await this.streamDecodeFromUrl(url);
			if (buffer) return buffer;
		} catch (error) {
			console.warn(
				"[AudioProcessor] Streaming decode failed, falling back to bulk decode:",
				url,
				error,
			);
		}
		return this.bulkDecodeFromUrl(url, OFFLINE_AUDIO_SAMPLE_RATE);
	}

	// Streaming decode via WebDemuxer + AudioDecoder. Decodes audio chunk-by-chunk
	// without loading the entire compressed file into a contiguous ArrayBuffer.
	private async streamDecodeFromUrl(url: string): Promise<AudioBuffer | null> {
		const source = await resolveMediaElementSource(url);
		let demuxer: WebDemuxer | null = null;

		try {
			const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
			demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
			await demuxer.load(source.src);

			let audioConfig: AudioDecoderConfig;
			try {
				audioConfig = (await demuxer.getDecoderConfig("audio")) as AudioDecoderConfig;
			} catch {
				return null; // No audio track
			}

			const sampleRate = audioConfig.sampleRate || 48_000;
			const numChannels = Math.min(audioConfig.numberOfChannels || 2, 2);

			// Accumulate decoded PCM per channel
			const channelChunks: Float32Array[][] = Array.from({ length: numChannels }, () => []);
			let totalFrames = 0;
			let decodeError: Error | null = null;
			const decodeCapacityWaiters = new Set<() => void>();

			const notifyDecodeCapacityAvailable = () => {
				if (decodeCapacityWaiters.size === 0) {
					return;
				}

				const waiters = [...decodeCapacityWaiters];
				decodeCapacityWaiters.clear();
				for (const resolve of waiters) {
					resolve();
				}
			};

			const waitForDecodeCapacity = () =>
				new Promise<void>((resolve) => {
					decodeCapacityWaiters.add(resolve);
				});

			const decoder = new AudioDecoder({
				output: (data: AudioData) => {
					try {
						const frames = data.numberOfFrames;
						const dataChannels = Math.min(data.numberOfChannels, numChannels);
						const format = data.format;

						if (format?.includes("planar")) {
							for (let ch = 0; ch < dataChannels; ch++) {
								const size = data.allocationSize({
									planeIndex: ch,
								});
								const bytes = new ArrayBuffer(size);
								data.copyTo(bytes, { planeIndex: ch });
								channelChunks[ch].push(this.rawToFloat32(bytes, format, frames));
							}
						} else if (format) {
							// Interleaved format — deinterleave into per-channel arrays.
							// Use data.numberOfChannels as stride (not capped dataChannels)
							// since the raw buffer contains all source channels.
							const srcChannels = data.numberOfChannels;
							const size = data.allocationSize({ planeIndex: 0 });
							const bytes = new ArrayBuffer(size);
							data.copyTo(bytes, { planeIndex: 0 });
							const interleaved = this.rawToFloat32(
								bytes,
								format,
								frames * srcChannels,
							);
							for (let ch = 0; ch < dataChannels; ch++) {
								const chData = new Float32Array(frames);
								for (let i = 0; i < frames; i++) {
									chData[i] = interleaved[i * srcChannels + ch];
								}
								channelChunks[ch].push(chData);
							}
						}

						// Fill missing channels with silence
						for (let ch = dataChannels; ch < numChannels; ch++) {
							channelChunks[ch].push(new Float32Array(frames));
						}

						totalFrames += frames;
					} finally {
						data.close();
						notifyDecodeCapacityAvailable();
					}
				},
				error: (err: DOMException) => {
					decodeError = new Error(`Streaming audio decode error: ${err.message}`);
					notifyDecodeCapacityAvailable();
				},
			});

			decoder.configure(audioConfig);

			const audioStream = demuxer.read("audio");
			const reader = (audioStream as ReadableStream<EncodedAudioChunk>).getReader();

			try {
				while (!this.cancelled) {
					if (decodeError) throw decodeError;
					const { done, value: chunk } = await reader.read();
					if (done || !chunk) break;

					decoder.decode(chunk);

					while (decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT && !this.cancelled) {
						if (decodeError) throw decodeError;
						await waitForDecodeCapacity();
					}
				}

				if (decoder.state === "configured") {
					await decoder.flush();
				}
				if (decodeError) throw decodeError;
			} finally {
				notifyDecodeCapacityAvailable();
				try {
					await reader.cancel();
				} catch {
					/* reader already closed */
				}
				if (decoder.state === "configured") {
					decoder.close();
				}
			}

			if (totalFrames === 0) return null;

			// Build AudioBuffer from accumulated chunks
			const audioBuffer = new AudioBuffer({
				length: totalFrames,
				numberOfChannels: numChannels,
				sampleRate,
			});
			for (let ch = 0; ch < numChannels; ch++) {
				const channelData = audioBuffer.getChannelData(ch);
				let writeOffset = 0;
				for (const chunk of channelChunks[ch]) {
					channelData.set(chunk, writeOffset);
					writeOffset += chunk.length;
				}
			}

			return audioBuffer;
		} finally {
			source.revoke();
			try {
				demuxer?.destroy();
			} catch {
				/* cleanup */
			}
		}
	}

	// Convert raw bytes from AudioData to Float32Array based on the sample format.
	private rawToFloat32(bytes: ArrayBuffer, format: string, sampleCount: number): Float32Array {
		if (format.startsWith("f32")) {
			return new Float32Array(bytes);
		}
		if (format.startsWith("s16")) {
			const int16 = new Int16Array(bytes);
			const f32 = new Float32Array(sampleCount);
			for (let i = 0; i < sampleCount; i++) {
				f32[i] = int16[i] / 0x8000;
			}
			return f32;
		}
		if (format.startsWith("s32")) {
			const int32 = new Int32Array(bytes);
			const f32 = new Float32Array(sampleCount);
			for (let i = 0; i < sampleCount; i++) {
				f32[i] = int32[i] / 0x80000000;
			}
			return f32;
		}
		if (format.startsWith("u8")) {
			const uint8 = new Uint8Array(bytes);
			const f32 = new Float32Array(sampleCount);
			for (let i = 0; i < sampleCount; i++) {
				f32[i] = (uint8[i] - 128) / 128;
			}
			return f32;
		}
		// Unknown format — attempt float32 interpretation
		return new Float32Array(bytes);
	}

	// Bulk decode fallback: loads entire file into memory and uses decodeAudioData.
	private async bulkDecodeFromUrl(url: string, sampleRate: number): Promise<AudioBuffer | null> {
		try {
			const source = await resolveMediaElementSource(url);
			try {
				const response = await fetch(source.src);
				const arrayBuffer = await response.arrayBuffer();
				const tempCtx = new OfflineAudioContext(2, 1, sampleRate);
				return await tempCtx.decodeAudioData(arrayBuffer);
			} finally {
				source.revoke();
			}
		} catch (error) {
			console.warn("[AudioProcessor] Failed to decode audio from URL:", url, error);
			return null;
		}
	}

	// Get the duration of a media file by loading only its metadata.
	private async getMediaDurationSec(url: string): Promise<number> {
		const source = await resolveMediaElementSource(url);
		try {
			const media = document.createElement("video");
			media.preload = "metadata";
			media.src = source.src;

			return await new Promise<number>((resolve, reject) => {
				const timeout = setTimeout(() => {
					cleanup();
					media.src = "";
					media.load();
					reject(new Error("Timed out getting media duration (30s)"));
				}, 30_000);

				const onLoaded = () => {
					cleanup();
					const duration = media.duration;
					media.src = "";
					media.load();
					resolve(Number.isFinite(duration) ? duration : 0);
				};
				const onError = () => {
					cleanup();
					media.src = "";
					media.load();
					reject(new Error("Failed to get media duration"));
				};
				const cleanup = () => {
					clearTimeout(timeout);
					media.removeEventListener("loadedmetadata", onLoaded);
					media.removeEventListener("error", onError);
				};

				media.addEventListener("loadedmetadata", onLoaded);
				media.addEventListener("error", onError, { once: true });
			});
		} finally {
			source.revoke();
		}
	}

	// Build non-overlapping timeline slices from the source timeline, excluding
	// trimmed regions and tagging each slice with its playback speed.
	private buildTimelineSlices(
		sourceDurationMs: number,
		trimRegions: TrimLikeRegion[],
		speedRegions: SpeedRegion[],
	): TimelineSlice[] {
		const boundaries = new Set<number>();
		boundaries.add(0);
		boundaries.add(sourceDurationMs);

		for (const trim of trimRegions) {
			if (trim.startMs >= 0 && trim.startMs <= sourceDurationMs) boundaries.add(trim.startMs);
			if (trim.endMs >= 0 && trim.endMs <= sourceDurationMs) boundaries.add(trim.endMs);
		}
		for (const speed of speedRegions) {
			if (speed.startMs >= 0 && speed.startMs <= sourceDurationMs)
				boundaries.add(speed.startMs);
			if (speed.endMs >= 0 && speed.endMs <= sourceDurationMs) boundaries.add(speed.endMs);
		}

		const sorted = [...boundaries].sort((a, b) => a - b);
		const slices: TimelineSlice[] = [];

		for (let i = 0; i < sorted.length - 1; i++) {
			const start = sorted[i];
			const end = sorted[i + 1];
			if (end - start < 0.001) continue;

			// Skip segments entirely inside a trim region
			const midpoint = (start + end) / 2;
			if (this.isInTrimRegion(midpoint, trimRegions)) continue;

			const speedRegion = speedRegions.find(
				(s) => midpoint >= s.startMs && midpoint < s.endMs,
			);

			slices.push({
				sourceStartMs: start,
				sourceEndMs: end,
				speed: speedRegion?.speed ?? 1,
			});
		}

		return slices;
	}

	// Map a source-timeline timestamp to the corresponding output-timeline timestamp.
	private sourceTimeToOutputTime(sourceMs: number, slices: TimelineSlice[]): number {
		let outputMs = 0;

		for (const slice of slices) {
			if (sourceMs <= slice.sourceStartMs) {
				return outputMs;
			}
			const sliceDurationMs = slice.sourceEndMs - slice.sourceStartMs;
			if (sourceMs >= slice.sourceEndMs) {
				outputMs += sliceDurationMs / slice.speed;
				continue;
			}
			// Source time falls within this slice
			outputMs += (sourceMs - slice.sourceStartMs) / slice.speed;
			return outputMs;
		}

		return outputMs;
	}

	// Schedule an AudioBuffer through the timeline slices in an OfflineAudioContext.
	// Each non-trimmed segment creates an AudioBufferSourceNode with the appropriate
	// playbackRate for speed regions. When chunkOutputStartSec/chunkDurationSec are
	// provided, only sources overlapping the chunk window are scheduled.
	private scheduleBufferThroughTimeline(
		ctx: OfflineAudioContext,
		buffer: AudioBuffer,
		slices: TimelineSlice[],
		sourceStartDelaySec: number,
		chunkOutputStartSec = 0,
		chunkDurationSec = Number.POSITIVE_INFINITY,
	): void {
		let outputOffsetSec = 0;

		for (const slice of slices) {
			const sliceSourceDurationSec = (slice.sourceEndMs - slice.sourceStartMs) / 1000;
			const sliceOutputDurationSec = sliceSourceDurationSec / slice.speed;

			// Where in the buffer does this slice read from?
			const bufferOffsetSec = slice.sourceStartMs / 1000 - sourceStartDelaySec;

			// Skip if slice doesn't overlap with the buffer at all
			if (
				bufferOffsetSec + sliceSourceDurationSec <= 0 ||
				bufferOffsetSec >= buffer.duration
			) {
				outputOffsetSec += sliceOutputDurationSec;
				continue;
			}

			// Clamp to buffer bounds
			let effectiveBufferStartSec = Math.max(0, bufferOffsetSec);
			const trimmedFromStartSec = effectiveBufferStartSec - bufferOffsetSec;
			let effectiveSourceDurationSec = Math.min(
				sliceSourceDurationSec - trimmedFromStartSec,
				buffer.duration - effectiveBufferStartSec,
			);

			if (effectiveSourceDurationSec <= 0.001) {
				outputOffsetSec += sliceOutputDurationSec;
				continue;
			}

			// Calculate output position (global then chunk-local)
			let localOutputStartSec =
				outputOffsetSec + trimmedFromStartSec / slice.speed - chunkOutputStartSec;
			let localOutputEndSec = localOutputStartSec + effectiveSourceDurationSec / slice.speed;

			// Skip if entirely outside chunk window
			if (localOutputEndSec <= 0 || localOutputStartSec >= chunkDurationSec) {
				outputOffsetSec += sliceOutputDurationSec;
				continue;
			}

			// Clip to chunk start
			if (localOutputStartSec < 0) {
				const skipOutputSec = -localOutputStartSec;
				const skipSourceSec = skipOutputSec * slice.speed;
				effectiveBufferStartSec += skipSourceSec;
				effectiveSourceDurationSec -= skipSourceSec;
				localOutputStartSec = 0;
			}

			// Clip to chunk end
			if (localOutputEndSec > chunkDurationSec) {
				const excessOutputSec = localOutputEndSec - chunkDurationSec;
				effectiveSourceDurationSec -= excessOutputSec * slice.speed;
			}

			if (effectiveSourceDurationSec <= 0.001) {
				outputOffsetSec += sliceOutputDurationSec;
				continue;
			}

			const source = ctx.createBufferSource();
			source.buffer = buffer;
			source.playbackRate.value = slice.speed;
			source.connect(ctx.destination);

			source.start(localOutputStartSec, effectiveBufferStartSec, effectiveSourceDurationSec);

			outputOffsetSec += sliceOutputDurationSec;
		}
	}

	// Create a WAV file header for the given audio parameters.
	private createWavHeader(
		sampleRate: number,
		numChannels: number,
		totalFrames: number,
	): ArrayBuffer {
		const bytesPerSample = 2; // 16-bit PCM
		const dataSize = totalFrames * numChannels * bytesPerSample;
		const headerSize = 44;
		const header = new ArrayBuffer(headerSize);
		const view = new DataView(header);

		const writeString = (offset: number, str: string) => {
			for (let i = 0; i < str.length; i++) {
				view.setUint8(offset + i, str.charCodeAt(i));
			}
		};

		writeString(0, "RIFF");
		view.setUint32(4, headerSize - 8 + dataSize, true);
		writeString(8, "WAVE");
		writeString(12, "fmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true); // PCM format
		view.setUint16(22, numChannels, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
		view.setUint16(32, numChannels * bytesPerSample, true);
		view.setUint16(34, bytesPerSample * 8, true);
		writeString(36, "data");
		view.setUint32(40, dataSize, true);

		return header;
	}

	// Convert an AudioBuffer to chunked 16-bit PCM ArrayBuffers.
	// Returns small (~256KB) pieces instead of one massive allocation.
	private audioBufferToPcmParts(buffer: AudioBuffer): ArrayBuffer[] {
		const PCM_CHUNK_FRAMES = 65536;
		const numChannels = buffer.numberOfChannels;
		const numFrames = buffer.length;
		const bytesPerSample = 2;
		const parts: ArrayBuffer[] = [];

		const channels: Float32Array[] = [];
		for (let ch = 0; ch < numChannels; ch++) {
			channels.push(buffer.getChannelData(ch));
		}

		for (let frameOffset = 0; frameOffset < numFrames; frameOffset += PCM_CHUNK_FRAMES) {
			const chunkFrames = Math.min(PCM_CHUNK_FRAMES, numFrames - frameOffset);
			const chunkBuffer = new ArrayBuffer(chunkFrames * numChannels * bytesPerSample);
			const view = new DataView(chunkBuffer);

			let byteOffset = 0;
			for (let i = 0; i < chunkFrames; i++) {
				for (let ch = 0; ch < numChannels; ch++) {
					const sample = Math.max(-1, Math.min(1, channels[ch][frameOffset + i]));
					view.setInt16(byteOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
					byteOffset += 2;
				}
			}

			parts.push(chunkBuffer);
		}

		return parts;
	}

	// Loads a sidecar audio file into a WebDemuxer for direct transcoding (avoiding real-time rendering).
	private async loadAudioFileDemuxer(audioPath: string): Promise<WebDemuxer | null> {
		try {
			const source = await resolveMediaElementSource(audioPath);
			try {
				const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
				const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
				await demuxer.load(source.src);
				return demuxer;
			} finally {
				source.revoke();
			}
		} catch (error) {
			console.warn("[AudioProcessor] Failed to create demuxer for sidecar audio:", error);
			return null;
		}
	}

	private cloneWithTimestamp(src: AudioData, newTimestamp: number): AudioData {
		const isPlanar = src.format?.includes("planar") ?? false;
		const numPlanes = isPlanar ? src.numberOfChannels : 1;

		let totalSize = 0;
		for (let planeIndex = 0; planeIndex < numPlanes; planeIndex++) {
			totalSize += src.allocationSize({ planeIndex });
		}

		const buffer = new ArrayBuffer(totalSize);
		let offset = 0;

		for (let planeIndex = 0; planeIndex < numPlanes; planeIndex++) {
			const planeSize = src.allocationSize({ planeIndex });
			src.copyTo(new Uint8Array(buffer, offset, planeSize), { planeIndex });
			offset += planeSize;
		}

		return new AudioData({
			format: src.format!,
			sampleRate: src.sampleRate,
			numberOfFrames: src.numberOfFrames,
			numberOfChannels: src.numberOfChannels,
			timestamp: newTimestamp,
			data: buffer,
		});
	}

	private cloneEncodedAudioChunkWithTimestamp(
		src: EncodedAudioChunk,
		newTimestamp: number,
	): EncodedAudioChunk {
		const data = new Uint8Array(src.byteLength);
		src.copyTo(data);

		return new EncodedAudioChunk({
			type: src.type,
			timestamp: newTimestamp,
			duration: src.duration ?? undefined,
			data,
		});
	}

	private isInTrimRegion(timestampMs: number, trims: TrimLikeRegion[]) {
		return trims.some((trim) => timestampMs >= trim.startMs && timestampMs < trim.endMs);
	}

	private computeTrimOffset(timestampMs: number, trims: TrimLikeRegion[]) {
		let offset = 0;
		for (const trim of trims) {
			if (trim.endMs <= timestampMs) {
				offset += trim.endMs - trim.startMs;
			}
		}
		return offset;
	}

	cancel() {
		this.cancelled = true;
	}
}
