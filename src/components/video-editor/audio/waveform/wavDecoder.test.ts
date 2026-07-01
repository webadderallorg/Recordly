import { describe, expect, it } from "vitest";
import { decodeWavAudioData } from "./wavDecoder";

function writeAscii(view: DataView, offset: number, value: string) {
	for (let i = 0; i < value.length; i++) {
		view.setUint8(offset + i, value.charCodeAt(i));
	}
}

function encodeSample(value: number) {
	return Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
}

function createPcm16Wav({ sampleRate, channels }: { sampleRate: number; channels: number[][] }) {
	const channelCount = channels.length;
	const frameCount = channels[0]?.length ?? 0;
	const dataSize = frameCount * channelCount * 2;
	const junkSize = 3;
	const junkPaddedSize = junkSize + 1;
	const totalSize = 12 + 8 + junkPaddedSize + 8 + 16 + 8 + dataSize;
	const buffer = new ArrayBuffer(totalSize);
	const view = new DataView(buffer);

	writeAscii(view, 0, "RIFF");
	view.setUint32(4, totalSize - 8, true);
	writeAscii(view, 8, "WAVE");

	let offset = 12;
	writeAscii(view, offset, "JUNK");
	view.setUint32(offset + 4, junkSize, true);
	offset += 8 + junkPaddedSize;

	writeAscii(view, offset, "fmt ");
	view.setUint32(offset + 4, 16, true);
	view.setUint16(offset + 8, 1, true);
	view.setUint16(offset + 10, channelCount, true);
	view.setUint32(offset + 12, sampleRate, true);
	view.setUint32(offset + 16, sampleRate * channelCount * 2, true);
	view.setUint16(offset + 20, channelCount * 2, true);
	view.setUint16(offset + 22, 16, true);
	offset += 24;

	writeAscii(view, offset, "data");
	view.setUint32(offset + 4, dataSize, true);
	offset += 8;

	for (let frame = 0; frame < frameCount; frame++) {
		for (let channel = 0; channel < channelCount; channel++) {
			view.setInt16(offset, encodeSample(channels[channel][frame] ?? 0), true);
			offset += 2;
		}
	}

	return buffer;
}

function createSingleFrameWav({
	audioFormat,
	bitsPerSample,
}: {
	audioFormat: number;
	bitsPerSample: number;
}) {
	const channelCount = 1;
	const sampleRate = 48_000;
	const bytesPerSample = bitsPerSample / 8;
	const dataSize = channelCount * bytesPerSample;
	const totalSize = 44 + dataSize;
	const buffer = new ArrayBuffer(totalSize);
	const view = new DataView(buffer);

	writeAscii(view, 0, "RIFF");
	view.setUint32(4, totalSize - 8, true);
	writeAscii(view, 8, "WAVE");
	writeAscii(view, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, audioFormat, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * dataSize, true);
	view.setUint16(32, dataSize, true);
	view.setUint16(34, bitsPerSample, true);
	writeAscii(view, 36, "data");
	view.setUint32(40, dataSize, true);

	return buffer;
}

describe("decodeWavAudioData", () => {
	it("decodes PCM wav channels, sample rate, and duration without using media elements", () => {
		const wav = createPcm16Wav({
			sampleRate: 4,
			channels: [
				[0, 0.5, -0.5, 1],
				[1, -1, 0.25, -0.25],
			],
		});

		const decoded = decodeWavAudioData(wav);

		expect(decoded?.sampleRate).toBe(4);
		expect(decoded?.durationSeconds).toBe(1);
		expect(decoded?.channels).toHaveLength(2);
		expect(Array.from(decoded?.channels[0] ?? [])).toEqual([
			0,
			expect.closeTo(0.5, 4),
			expect.closeTo(-0.5, 4),
			expect.closeTo(1, 4),
		]);
		expect(Array.from(decoded?.channels[1] ?? [])).toEqual([
			expect.closeTo(1, 4),
			expect.closeTo(-1, 4),
			expect.closeTo(0.25, 4),
			expect.closeTo(-0.25, 4),
		]);
	});

	it("rejects unsupported 64-bit float WAV data instead of decoding silence", () => {
		expect(
			decodeWavAudioData(createSingleFrameWav({ audioFormat: 3, bitsPerSample: 64 })),
		).toBe(null);
	});

	it("rejects unsupported 64-bit PCM WAV data instead of decoding silence", () => {
		expect(
			decodeWavAudioData(createSingleFrameWav({ audioFormat: 1, bitsPerSample: 64 })),
		).toBe(null);
	});
});
