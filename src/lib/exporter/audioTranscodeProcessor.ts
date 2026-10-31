import type { WebDemuxer } from "web-demuxer";
import { OfflineAudioProcessor } from "./offlineAudioProcessor";
import {
	AUDIO_BITRATE,
	DECODE_BACKPRESSURE_LIMIT,
	ENCODE_BACKPRESSURE_LIMIT,
	MP4_AUDIO_CODEC,
	type TrimLikeRegion,
} from "./audioProcessorShared";
import type { VideoMuxer } from "./muxer";

export class AudioTranscodeProcessor extends OfflineAudioProcessor {
	protected async processTrimOnlyAudio(
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

	protected async transcodeAudioStream(
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
}
