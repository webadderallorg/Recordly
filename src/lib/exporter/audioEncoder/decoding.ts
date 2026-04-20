import { WebDemuxer } from "web-demuxer";
import { resolveMediaElementSource } from "../localMediaSource";
import {
	DECODE_BACKPRESSURE_LIMIT,
	OFFLINE_AUDIO_SAMPLE_RATE,
} from "./shared";

/**
 * Streaming decode via WebDemuxer + AudioDecoder. Decodes audio chunk-by-chunk
 * without loading the entire compressed file into a contiguous ArrayBuffer.
 */
export async function streamDecodeFromUrl(
	url: string,
	cancelled: { current: boolean },
): Promise<AudioBuffer | null> {
	const source = await resolveMediaElementSource(url);
	let demuxer: WebDemuxer | null = null;

	try {
		const response = await fetch(source.src);
		const blob = await response.blob();
		const filename = url.split("/").pop() || "audio";
		const file = new File([blob], filename, {
			type: blob.type || "video/mp4",
		});

		const wasmUrl = new URL(
			"./wasm/web-demuxer.wasm",
			window.location.href,
		).href;
		demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
		await demuxer.load(file);

		let audioConfig: AudioDecoderConfig;
		try {
			audioConfig = (await demuxer.getDecoderConfig("audio")) as AudioDecoderConfig;
		} catch {
			return null; // No audio track
		}

		const sampleRate = audioConfig.sampleRate || 48_000;
		const numChannels = Math.min(audioConfig.numberOfChannels || 2, 2);

		const channelChunks: Float32Array[][] = Array.from(
			{ length: numChannels },
			() => [],
		);
		let totalFrames = 0;
		let decodeError: Error | null = null;

		const decoder = new AudioDecoder({
			output: (data: AudioData) => {
				try {
					const frames = data.numberOfFrames;
					const dataChannels = Math.min(data.numberOfChannels, numChannels);
					const format = data.format;

					if (format?.includes("planar")) {
						for (let ch = 0; ch < dataChannels; ch++) {
							const size = data.allocationSize({ planeIndex: ch });
							const bytes = new ArrayBuffer(size);
							data.copyTo(bytes, { planeIndex: ch });
							channelChunks[ch].push(rawToFloat32(bytes, format, frames));
						}
					} else if (format) {
						const srcChannels = data.numberOfChannels;
						const size = data.allocationSize({ planeIndex: 0 });
						const bytes = new ArrayBuffer(size);
						data.copyTo(bytes, { planeIndex: 0 });
						const interleaved = rawToFloat32(bytes, format, frames * srcChannels);
						for (let ch = 0; ch < dataChannels; ch++) {
							const chData = new Float32Array(frames);
							for (let i = 0; i < frames; i++) {
								chData[i] = interleaved[i * srcChannels + ch];
							}
							channelChunks[ch].push(chData);
						}
					}

					for (let ch = dataChannels; ch < numChannels; ch++) {
						channelChunks[ch].push(new Float32Array(frames));
					}

					totalFrames += frames;
				} finally {
					data.close();
				}
			},
			error: (err: DOMException) => {
				decodeError = new Error(`Streaming audio decode error: ${err.message}`);
			},
		});

		decoder.configure(audioConfig);

		const audioStream = demuxer.read("audio");
		const reader = (audioStream as ReadableStream<EncodedAudioChunk>).getReader();

		try {
			while (!cancelled.current) {
				if (decodeError) throw decodeError;
				const { done, value: chunk } = await reader.read();
				if (done || !chunk) break;

				decoder.decode(chunk);

				while (
					decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT &&
					!cancelled.current
				) {
					if (decodeError) throw decodeError;
					await new Promise((r) => setTimeout(r, 1));
				}
			}

			if (decoder.state === "configured") {
				await decoder.flush();
			}
			if (decodeError) throw decodeError;
		} finally {
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

/** Convert raw bytes from AudioData to Float32Array based on the sample format. */
export function rawToFloat32(
	bytes: ArrayBuffer,
	format: string,
	sampleCount: number,
): Float32Array {
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
	return new Float32Array(bytes);
}

/** Bulk decode fallback: loads entire file into memory and uses decodeAudioData. */
export async function bulkDecodeFromUrl(
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

/** Decode audio from a URL using streaming WebCodecs decode with bulk fallback. */
export async function decodeAudioFromUrl(
	url: string,
	cancelled: { current: boolean },
): Promise<AudioBuffer | null> {
	try {
		const buffer = await streamDecodeFromUrl(url, cancelled);
		if (buffer) return buffer;
	} catch (error) {
		console.warn(
			"[AudioProcessor] Streaming decode failed, falling back to bulk decode:",
			url,
			error,
		);
	}
	return bulkDecodeFromUrl(url, OFFLINE_AUDIO_SAMPLE_RATE);
}

/** Get the duration of a media file by loading only its metadata. */
export async function getMediaDurationSec(url: string): Promise<number> {
	const source = await resolveMediaElementSource(url);
	try {
		const media = document.createElement("video");
		media.preload = "metadata";
		media.src = source.src;

		return await new Promise<number>((resolve, reject) => {
			const timeout = setTimeout(() => {
				cleanup();
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

/** Loads a sidecar audio file into a WebDemuxer for direct transcoding. */
export async function loadAudioFileDemuxer(audioPath: string): Promise<WebDemuxer | null> {
	try {
		const source = await resolveMediaElementSource(audioPath);
		try {
			const response = await fetch(source.src);
			const blob = await response.blob();
			const filename = audioPath.split("/").pop() || "sidecar-audio";
			const file = new File([blob], filename, { type: blob.type || "audio/webm" });
			const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
			const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
			await demuxer.load(file);
			return demuxer;
		} finally {
			source.revoke();
		}
	} catch (error) {
		console.warn("[AudioProcessor] Failed to create demuxer for sidecar audio:", error);
		return null;
	}
}
