export type DecodedWavAudio = {
	durationSeconds: number;
	sampleRate: number;
	channels: Float32Array[];
};

function readAscii(view: DataView, offset: number, length: number) {
	let value = "";
	for (let i = 0; i < length; i++) {
		value += String.fromCharCode(view.getUint8(offset + i));
	}
	return value;
}

function decodePcmSample(view: DataView, offset: number, bitsPerSample: number) {
	switch (bitsPerSample) {
		case 8:
			return (view.getUint8(offset) - 128) / 128;
		case 16:
			return view.getInt16(offset, true) / 32768;
		case 24: {
			const byte0 = view.getUint8(offset);
			const byte1 = view.getUint8(offset + 1);
			const byte2 = view.getUint8(offset + 2);
			let sample = byte0 | (byte1 << 8) | (byte2 << 16);
			if (sample & 0x800000) {
				sample |= ~0xffffff;
			}
			return sample / 8388608;
		}
		case 32:
			return view.getInt32(offset, true) / 2147483648;
		default:
			return 0;
	}
}

export function decodeWavAudioData(arrayBuffer: ArrayBuffer): DecodedWavAudio | null {
	const view = new DataView(arrayBuffer);
	if (view.byteLength < 44) {
		return null;
	}

	if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
		return null;
	}

	let audioFormat: number | null = null;
	let channelCount: number | null = null;
	let sampleRate: number | null = null;
	let bitsPerSample: number | null = null;
	let dataOffset = 0;
	let dataSize = 0;
	let offset = 12;

	while (offset + 8 <= view.byteLength) {
		const chunkId = readAscii(view, offset, 4);
		const chunkSize = view.getUint32(offset + 4, true);
		const chunkDataOffset = offset + 8;

		if (chunkId === "fmt " && chunkDataOffset + 16 <= view.byteLength) {
			audioFormat = view.getUint16(chunkDataOffset, true);
			channelCount = view.getUint16(chunkDataOffset + 2, true);
			sampleRate = view.getUint32(chunkDataOffset + 4, true);
			bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
		} else if (chunkId === "data") {
			dataOffset = chunkDataOffset;
			dataSize = Math.min(chunkSize, view.byteLength - chunkDataOffset);
			break;
		}

		offset = chunkDataOffset + chunkSize + (chunkSize % 2);
	}

	if (
		(audioFormat !== 1 && audioFormat !== 3) ||
		!channelCount ||
		!sampleRate ||
		!bitsPerSample ||
		dataSize <= 0
	) {
		return null;
	}

	if (audioFormat === 3 && bitsPerSample !== 32) {
		return null;
	}
	if (audioFormat === 1 && ![8, 16, 24, 32].includes(bitsPerSample)) {
		return null;
	}

	const bytesPerSample = bitsPerSample / 8;
	if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0) {
		return null;
	}

	const frameSize = channelCount * bytesPerSample;
	if (!Number.isFinite(frameSize) || frameSize <= 0) {
		return null;
	}

	const frameCount = Math.floor(dataSize / frameSize);
	if (frameCount <= 0) {
		return null;
	}

	const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));

	for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
		const frameOffset = dataOffset + frameIndex * frameSize;
		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			const sampleOffset = frameOffset + channelIndex * bytesPerSample;
			channels[channelIndex][frameIndex] =
				audioFormat === 3
					? view.getFloat32(sampleOffset, true)
					: decodePcmSample(view, sampleOffset, bitsPerSample);
		}
	}

	return {
		durationSeconds: frameCount / sampleRate,
		sampleRate,
		channels,
	};
}
