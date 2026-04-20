import type { AudioRegion } from "@/components/video-editor/types";
import {
	ENCODE_BACKPRESSURE_LIMIT,
	OFFLINE_ENCODE_CHUNK_FRAMES,
	sourceTimeToOutputTime,
	type TimelineSlice,
} from "./shared";

// ----- Scheduling helpers -----

export function scheduleRegionForChunk(
	ctx: OfflineAudioContext,
	buffer: AudioBuffer,
	region: AudioRegion,
	slices: TimelineSlice[],
	chunkOutputStartSec: number,
	chunkDurationSec: number,
): void {
	const outputStartMs = sourceTimeToOutputTime(region.startMs, slices);
	const outputEndMs = sourceTimeToOutputTime(region.endMs, slices);

	let localStartSec = outputStartMs / 1000 - chunkOutputStartSec;
	let localEndSec = outputEndMs / 1000 - chunkOutputStartSec;

	if (localEndSec <= 0 || localStartSec >= chunkDurationSec) return;

	let bufferOffsetSec = 0;
	if (localStartSec < 0) {
		bufferOffsetSec = -localStartSec;
		localStartSec = 0;
	}
	if (localEndSec > chunkDurationSec) {
		localEndSec = chunkDurationSec;
	}

	const duration = Math.min(
		localEndSec - localStartSec,
		buffer.duration - bufferOffsetSec,
	);
	if (duration <= 0.001) return;

	const gainNode = ctx.createGain();
	gainNode.gain.value = Math.max(0, Math.min(1, region.volume));
	gainNode.connect(ctx.destination);

	const source = ctx.createBufferSource();
	source.buffer = buffer;
	source.connect(gainNode);
	source.start(localStartSec, bufferOffsetSec, duration);
}

export function scheduleBufferThroughTimeline(
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

		const bufferOffsetSec = slice.sourceStartMs / 1000 - sourceStartDelaySec;

		if (
			bufferOffsetSec + sliceSourceDurationSec <= 0 ||
			bufferOffsetSec >= buffer.duration
		) {
			outputOffsetSec += sliceOutputDurationSec;
			continue;
		}

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

		let localOutputStartSec =
			outputOffsetSec + trimmedFromStartSec / slice.speed - chunkOutputStartSec;
		let localOutputEndSec =
			localOutputStartSec + effectiveSourceDurationSec / slice.speed;

		if (localOutputEndSec <= 0 || localOutputStartSec >= chunkDurationSec) {
			outputOffsetSec += sliceOutputDurationSec;
			continue;
		}

		if (localOutputStartSec < 0) {
			const skipOutputSec = -localOutputStartSec;
			const skipSourceSec = skipOutputSec * slice.speed;
			effectiveBufferStartSec += skipSourceSec;
			effectiveSourceDurationSec -= skipSourceSec;
			localOutputStartSec = 0;
		}

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

// ----- Encoder helpers -----

export async function feedBufferToEncoder(
	encoder: AudioEncoder,
	buffer: AudioBuffer,
	timestampOffsetSec: number,
	cancelled: { current: boolean },
): Promise<void> {
	const sampleRate = buffer.sampleRate;
	const numChannels = buffer.numberOfChannels;
	const totalFrames = buffer.length;

	for (
		let offset = 0;
		offset < totalFrames && !cancelled.current;
		offset += OFFLINE_ENCODE_CHUNK_FRAMES
	) {
		const frameCount = Math.min(OFFLINE_ENCODE_CHUNK_FRAMES, totalFrames - offset);

		const planarData = new Float32Array(frameCount * numChannels);
		for (let ch = 0; ch < numChannels; ch++) {
			const channelData = buffer.getChannelData(ch);
			planarData.set(
				channelData.subarray(offset, offset + frameCount),
				ch * frameCount,
			);
		}

		const audioData = new AudioData({
			format: "f32-planar",
			sampleRate,
			numberOfFrames: frameCount,
			numberOfChannels: numChannels,
			timestamp: Math.round(
				(offset / sampleRate + timestampOffsetSec) * 1_000_000,
			),
			data: planarData,
		});

		encoder.encode(audioData);
		audioData.close();

		while (
			encoder.encodeQueueSize >= ENCODE_BACKPRESSURE_LIMIT &&
			!cancelled.current
		) {
			await new Promise((r) => setTimeout(r, 1));
		}
	}
}

// ----- WAV helpers -----

export function createWavHeader(
	sampleRate: number,
	numChannels: number,
	totalFrames: number,
): ArrayBuffer {
	const bytesPerSample = 2;
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
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
	view.setUint16(32, numChannels * bytesPerSample, true);
	view.setUint16(34, bytesPerSample * 8, true);
	writeString(36, "data");
	view.setUint32(40, dataSize, true);

	return header;
}

export function audioBufferToPcmParts(buffer: AudioBuffer): ArrayBuffer[] {
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
				view.setInt16(
					byteOffset,
					sample < 0 ? sample * 0x8000 : sample * 0x7fff,
					true,
				);
				byteOffset += 2;
			}
		}

		parts.push(chunkBuffer);
	}

	return parts;
}
