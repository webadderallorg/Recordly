import { WebDemuxer } from "web-demuxer";
import { resolveMediaElementSource } from "./localMediaSource";
import type { TrimLikeRegion } from "./audioProcessorShared";

export class AudioProcessorBase {
	protected cancelled = false;
	protected onProgress?: (progress: number) => void;
	protected createWavHeader(
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
	protected audioBufferToPcmParts(buffer: AudioBuffer): ArrayBuffer[] {
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
	protected async loadAudioFileDemuxer(audioPath: string): Promise<WebDemuxer | null> {
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

	protected cloneWithTimestamp(src: AudioData, newTimestamp: number): AudioData {
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

	protected cloneEncodedAudioChunkWithTimestamp(
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

	protected isInTrimRegion(timestampMs: number, trims: TrimLikeRegion[]) {
		return trims.some((trim) => timestampMs >= trim.startMs && timestampMs < trim.endMs);
	}

	protected computeTrimOffset(timestampMs: number, trims: TrimLikeRegion[]) {
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
