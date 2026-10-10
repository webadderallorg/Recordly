import { WebDemuxer } from "web-demuxer";
import {
	DECODE_BACKPRESSURE_LIMIT,
	isWavAudioPath,
	OFFLINE_AUDIO_SAMPLE_RATE,
} from "./audioProcessorShared";
import { AudioTimelineProcessor } from "./audioTimelineProcessor";
import { resolveMediaElementSource } from "./localMediaSource";

export class AudioMediaProcessor extends AudioTimelineProcessor {
	protected async decodeAudioFromUrl(url: string): Promise<AudioBuffer | null> {
		if (isWavAudioPath(url)) {
			return this.bulkDecodeFromUrl(url, OFFLINE_AUDIO_SAMPLE_RATE);
		}
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
	protected async streamDecodeFromUrl(url: string): Promise<AudioBuffer | null> {
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

			const codecCheck = await AudioDecoder.isConfigSupported(audioConfig);
			if (!codecCheck.supported) {
				return null;
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
					try {
						await decoder.flush();
					} catch (flushError) {
						console.warn(
							"[AudioMediaProcessor] Non-fatal audio decoder flush warning:",
							flushError,
						);
					}
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
	protected rawToFloat32(bytes: ArrayBuffer, format: string, sampleCount: number): Float32Array {
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
	protected async bulkDecodeFromUrl(
		url: string,
		sampleRate: number,
	): Promise<AudioBuffer | null> {
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
	protected async getMediaDurationSec(url: string): Promise<number> {
		if (typeof document === "undefined") {
			return 0;
		}
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
}
