import type { WebDemuxer } from "web-demuxer";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { withMediaDeadline } from "./mediaDeadline";
import { getDecodedFrameTimelineOffsetUs } from "./streamingDecoder";
import { getVideoDecoderConfig } from "./videoDecoderConfig";
import { loadVideoDemuxerMetadata } from "./videoDemuxerMetadata";
import { getVideoDemuxerSignal } from "./videoDemuxerSignal";

const DEFAULT_MAX_DECODE_QUEUE = 12;
const DEFAULT_MAX_PENDING_FRAMES = 32;
const FIRST_FRAME_WAIT_MS = 8_000;
const NEXT_FRAME_WAIT_MS = 30_000;

export interface ForwardFrameSourceMetadata {
	width: number;
	height: number;
	duration: number;
	mediaStartTime?: number;
	streamStartTime?: number;
	streamDuration?: number;
	codec: string;
}

/**
 * Forward-only decoded frame source for monotonic timestamp access.
 *
 * This avoids per-frame HTMLVideoElement seeking during export and returns
 * the nearest decoded frame for increasing target timestamps.
 */
export class ForwardFrameSource {
	private demuxer: WebDemuxer | null = null;
	private decoder: VideoDecoder | null = null;
	private readonly abortController = new AbortController();
	private readonly signal: AbortSignal;
	private metadata: ForwardFrameSourceMetadata | null = null;
	private pendingFrames: VideoFrame[] = [];
	private frameResolve: ((frame: VideoFrame | null) => void) | null = null;
	private decodeError: Error | null = null;
	private decodeDone = false;
	private reader: ReadableStreamDefaultReader<EncodedVideoChunk> | null = null;
	private heldFrame: VideoFrame | null = null;
	private heldFrameSec = 0;
	private lastTargetTimeSec = 0;
	private lastFrameIntervalSec = 0;
	private resolvedDecodedDurationSec: number | null = null;
	private firstFrameTimestampUs: number | null = null;
	private frameTimelineOffsetUs = 0;
	private decodeCapacityWaiters = new Set<() => void>();

	private get cancelled() {
		return this.signal.aborted;
	}

	constructor(signal?: AbortSignal) {
		this.signal = signal
			? AbortSignal.any([signal, this.abortController.signal])
			: this.abortController.signal;
	}

	async initialize(videoUrl: string): Promise<ForwardFrameSourceMetadata> {
		const { demuxer, mediaInfo } = await loadVideoDemuxerMetadata(videoUrl, this.signal);
		this.demuxer = demuxer;

		const videoStream = mediaInfo.streams.find(
			(stream) => stream.codec_type_string === "video",
		);
		const mediaStartTime =
			typeof mediaInfo.start_time === "number" && Number.isFinite(mediaInfo.start_time)
				? mediaInfo.start_time
				: 0;
		const streamStartTime =
			typeof videoStream?.start_time === "number" && Number.isFinite(videoStream.start_time)
				? videoStream.start_time
				: mediaStartTime;

		this.metadata = {
			width: videoStream?.width || 0,
			height: videoStream?.height || 0,
			duration: mediaInfo.duration,
			mediaStartTime,
			streamStartTime,
			streamDuration:
				typeof videoStream?.duration === "number" && Number.isFinite(videoStream.duration)
					? videoStream.duration
					: undefined,
			codec: videoStream?.codec_string || "unknown",
		};

		try {
			this.signal.throwIfAborted();
			await this.startDecoder();
		} catch (error) {
			this.destroy();
			throw error;
		}
		return this.metadata;
	}

	private async startDecoder(): Promise<void> {
		if (!this.demuxer || !this.metadata) {
			throw new Error("Must call initialize() before starting decoder");
		}

		const decoderConfig = await getVideoDecoderConfig(this.demuxer, this.signal);
		this.signal.throwIfAborted();
		const codec = this.metadata.codec.toLowerCase();
		const shouldPreferSoftwareDecode = codec.includes("av01") || codec.includes("av1");

		this.decoder = new VideoDecoder({
			output: (frame: VideoFrame) => {
				if (this.cancelled) {
					frame.close();
					return;
				}
				if (this.frameResolve) {
					const resolve = this.frameResolve;
					this.frameResolve = null;
					resolve(frame);
				} else {
					this.pendingFrames.push(frame);
				}
				this.notifyDecoderCapacityAvailable();
			},
			error: (error: DOMException) => {
				if (this.cancelled) return;
				this.decodeError = new Error(`VideoDecoder error: ${error.message}`);
				if (this.frameResolve) {
					const resolve = this.frameResolve;
					this.frameResolve = null;
					resolve(null);
				}
				this.notifyDecoderCapacityAvailable();
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
			this.decoder.configure(decoderConfig);
		}

		const readEndSec =
			Math.max(
				this.metadata.duration + (this.metadata.mediaStartTime ?? 0),
				(this.metadata.streamDuration ?? this.metadata.duration) +
					(this.metadata.streamStartTime ?? this.metadata.mediaStartTime ?? 0),
			) + 0.5;
		const reader = this.demuxer.read("video", 0, readEndSec).getReader();
		this.reader = reader;
		const decoder = this.decoder;

		void (async () => {
			try {
				while (!this.cancelled) {
					const { done, value: chunk } = await reader.read();
					if (done || !chunk) {
						break;
					}

					while (
						(decoder.decodeQueueSize > DEFAULT_MAX_DECODE_QUEUE ||
							this.pendingFrames.length > DEFAULT_MAX_PENDING_FRAMES) &&
						!this.cancelled
					) {
						await this.waitForDecoderCapacity();
					}

					if (this.cancelled) {
						break;
					}

					decoder.decode(chunk);
				}

				if (!this.cancelled && decoder.state === "configured") {
					await decoder.flush();
				}
			} catch (error) {
				if (!this.cancelled)
					this.decodeError = error instanceof Error ? error : new Error(String(error));
			} finally {
				this.decodeDone = true;
				this.notifyDecoderCapacityAvailable();
				if (this.frameResolve) {
					const resolve = this.frameResolve;
					this.frameResolve = null;
					resolve(null);
				}
			}
		})();
	}

	private async getNextFrame(): Promise<VideoFrame | null> {
		this.signal.throwIfAborted();
		if (this.decodeError) {
			throw this.decodeError;
		}

		if (this.pendingFrames.length > 0) {
			const frame = this.pendingFrames.shift()!;
			this.notifyDecoderCapacityAvailable();
			return frame;
		}

		if (this.decodeDone) {
			return null;
		}

		if (this.frameResolve) {
			throw new Error("Concurrent getFrameAtTime() calls are not supported");
		}

		const signal = this.demuxer
			? getVideoDemuxerSignal(this.demuxer, this.signal)
			: this.signal;
		const firstFrame = this.firstFrameTimestampUs === null;
		let pending: ((frame: VideoFrame | null) => void) | null = null;
		try {
			const frame = await withMediaDeadline(
				() =>
					new Promise<VideoFrame | null>((resolve) => {
						pending = resolve;
						this.frameResolve = resolve;
					}),
				{
					signal,
					timeoutMs: firstFrame ? FIRST_FRAME_WAIT_MS : NEXT_FRAME_WAIT_MS,
					message: firstFrame
						? "Timed out waiting for the first decoded frame"
						: "Timed out waiting for a decoded frame",
				},
			);
			if (!frame && this.decodeError) throw this.decodeError;
			return frame;
		} finally {
			if (this.frameResolve === pending) this.frameResolve = null;
		}
	}

	private waitForDecoderCapacity(): Promise<void> {
		return new Promise((resolve) => {
			this.decodeCapacityWaiters.add(resolve);
		});
	}

	private notifyDecoderCapacityAvailable(): void {
		if (this.decodeCapacityWaiters.size === 0) {
			return;
		}

		const waiters = [...this.decodeCapacityWaiters];
		this.decodeCapacityWaiters.clear();
		for (const resolve of waiters) {
			resolve();
		}
	}

	async getFrameAtTime(targetTimeSec: number): Promise<VideoFrame | null> {
		this.signal.throwIfAborted();
		if (!this.metadata) {
			throw new Error("Frame source not initialized");
		}

		const clampedTargetTime = Math.max(
			0,
			Math.min(
				targetTimeSec,
				getEffectiveVideoStreamDurationSeconds({
					duration: this.metadata.duration,
					streamDuration: this.metadata.streamDuration,
				}) || targetTimeSec,
			),
		);
		if (clampedTargetTime + 0.001 < this.lastTargetTimeSec) {
			throw new Error("ForwardFrameSource only supports increasing timestamps");
		}
		this.lastTargetTimeSec = clampedTargetTime;

		if (!this.heldFrame) {
			const firstFrame = await this.getNextFrame();
			if (!firstFrame) {
				return null;
			}
			this.firstFrameTimestampUs = firstFrame.timestamp;
			this.frameTimelineOffsetUs = getDecodedFrameTimelineOffsetUs(
				firstFrame.timestamp,
				this.metadata,
			);
			this.heldFrame = firstFrame;
			this.heldFrameSec = Math.max(0, this.frameTimelineOffsetUs / 1_000_000);
		}
		if (clampedTargetTime <= this.heldFrameSec) {
			return new VideoFrame(this.heldFrame, { timestamp: this.heldFrame.timestamp });
		}

		while (!this.cancelled) {
			const nextFrame = await this.getNextFrame();
			if (!nextFrame) {
				this.resolvedDecodedDurationSec = Math.max(
					this.heldFrameSec,
					this.heldFrameSec + Math.max(0, this.lastFrameIntervalSec),
				);
				return new VideoFrame(this.heldFrame, {
					timestamp: this.heldFrame.timestamp,
				});
			}

			const nextFrameSec = Math.max(
				this.heldFrameSec,
				Math.max(
					0,
					(nextFrame.timestamp -
						(this.firstFrameTimestampUs ?? nextFrame.timestamp) +
						this.frameTimelineOffsetUs) /
						1_000_000,
				),
			);
			const handoffBoundarySec = (this.heldFrameSec + nextFrameSec) / 2;
			if (clampedTargetTime <= handoffBoundarySec) {
				this.pendingFrames.unshift(nextFrame);
				return new VideoFrame(this.heldFrame, {
					timestamp: this.heldFrame.timestamp,
				});
			}

			this.lastFrameIntervalSec = Math.max(0, nextFrameSec - this.heldFrameSec);
			this.heldFrame.close();
			this.heldFrame = nextFrame;
			this.heldFrameSec = nextFrameSec;
		}

		return null;
	}

	getResolvedDurationSec(): number | null {
		return this.resolvedDecodedDurationSec;
	}

	hasReachedEndOfStream(): boolean {
		return this.decodeDone && this.pendingFrames.length === 0;
	}

	cancel(): void {
		if (this.abortController.signal.aborted) return;
		this.abortController.abort();
		this.notifyDecoderCapacityAvailable();
		if (this.frameResolve) {
			const resolve = this.frameResolve;
			this.frameResolve = null;
			resolve(null);
		}
		if (this.reader) {
			void this.reader.cancel().catch(() => {
				// Ignore cancellation errors during shutdown.
			});
		}
	}

	destroy(): void {
		this.cancel();
		// A stuck worker may never acknowledge reader cancellation. Terminate it without waiting.
		this.reader = null;

		if (this.heldFrame) {
			this.heldFrame.close();
			this.heldFrame = null;
		}

		for (const frame of this.pendingFrames) {
			frame.close();
		}
		this.pendingFrames = [];

		if (this.decoder) {
			try {
				if (this.decoder.state === "configured") {
					this.decoder.close();
				}
			} catch {
				// Ignore decoder shutdown errors.
			}
			this.decoder = null;
		}

		if (this.demuxer) {
			try {
				this.demuxer.destroy();
			} catch {
				// Ignore demuxer shutdown errors.
			}
			this.demuxer = null;
		}

		this.metadata = null;
		this.decodeDone = false;
		this.decodeError = null;
		this.lastTargetTimeSec = 0;
		this.lastFrameIntervalSec = 0;
		this.resolvedDecodedDurationSec = null;
		this.firstFrameTimestampUs = null;
		this.frameTimelineOffsetUs = 0;
		this.decodeCapacityWaiters.clear();
	}
}
