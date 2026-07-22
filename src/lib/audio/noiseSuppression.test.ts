import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createNoiseSuppressorWithFallback,
	DEFAULT_NOISE_SUPPRESSION_MODE,
	type NoiseSuppressor,
	normalizeNoiseSuppressionMode,
	RnnoiseNoiseSuppressor,
} from "./noiseSuppression";

const rnnoiseLoad = vi.hoisted(() => vi.fn());

vi.mock("@shiguredo/rnnoise-wasm", () => ({
	Rnnoise: {
		load: rnnoiseLoad,
	},
}));

function createMockSuppressor({
	initialize = vi.fn().mockResolvedValue(undefined),
	processAudioFrame = vi.fn((frame: Float32Array) => frame),
	destroy = vi.fn(),
}: Partial<NoiseSuppressor> = {}): NoiseSuppressor {
	return {
		initialize,
		processAudioFrame,
		destroy,
	};
}

beforeEach(() => {
	rnnoiseLoad.mockReset();
});

describe("normalizeNoiseSuppressionMode", () => {
	it("defaults new and invalid values to RNNoise", () => {
		expect(normalizeNoiseSuppressionMode()).toBe(DEFAULT_NOISE_SUPPRESSION_MODE);
		expect(normalizeNoiseSuppressionMode("unknown")).toBe(DEFAULT_NOISE_SUPPRESSION_MODE);
	});

	it("normalizes supported persisted modes", () => {
		expect(normalizeNoiseSuppressionMode(" RNNOISE ")).toBe("rnnoise");
		expect(normalizeNoiseSuppressionMode("speex")).toBe("speex");
		expect(normalizeNoiseSuppressionMode("disabled")).toBe("disabled");
	});
});

describe("RnnoiseNoiseSuppressor", () => {
	it("buffers incomplete RNNoise frames across calls without returning raw remainder samples", async () => {
		const processFrame = vi.fn((frame: Float32Array) => {
			for (let index = 0; index < frame.length; index += 1) {
				frame[index] += 100;
			}
		});
		const destroy = vi.fn();
		rnnoiseLoad.mockResolvedValue({
			frameSize: 4,
			createDenoiseState: () => ({
				processFrame,
				destroy,
			}),
		});

		const suppressor = new RnnoiseNoiseSuppressor();
		await suppressor.initialize();

		const firstOutput = suppressor.processAudioFrame(new Float32Array([1, 2, 3, 4, 5, 6]));
		expect(Array.from(firstOutput)).toEqual([101, 102, 103, 104, 0, 0]);
		expect(processFrame).toHaveBeenCalledTimes(1);

		const secondOutput = suppressor.processAudioFrame(new Float32Array([7, 8, 9, 10, 11, 12]));
		expect(Array.from(secondOutput)).toEqual([105, 106, 107, 108, 109, 110]);
		expect(processFrame).toHaveBeenCalledTimes(3);

		const thirdOutput = suppressor.processAudioFrame(new Float32Array([13, 14]));
		expect(Array.from(thirdOutput)).toEqual([111, 112]);
		expect(processFrame).toHaveBeenCalledTimes(3);

		const fourthOutput = suppressor.processAudioFrame(new Float32Array([15, 16]));
		expect(Array.from(fourthOutput)).toEqual([113, 114]);
		expect(processFrame).toHaveBeenCalledTimes(4);

		suppressor.destroy();
		expect(destroy).toHaveBeenCalledTimes(1);
	});
});

describe("createNoiseSuppressorWithFallback", () => {
	it("initializes RNNoise when requested", async () => {
		const rnnoise = createMockSuppressor();
		const selection = await createNoiseSuppressorWithFallback({
			mode: "rnnoise",
			frameSize: 1024,
			sampleRate: 48000,
			deps: {
				createRnnoise: () => rnnoise,
			},
		});

		expect(selection.activeMode).toBe("rnnoise");
		expect(rnnoise.initialize).toHaveBeenCalledTimes(1);
	});

	it("initializes Speex when requested", async () => {
		const speex = createMockSuppressor();
		const selection = await createNoiseSuppressorWithFallback({
			mode: "speex",
			frameSize: 1024,
			sampleRate: 48000,
			deps: {
				createSpeex: () => speex,
			},
		});

		expect(selection.activeMode).toBe("speex");
		expect(speex.initialize).toHaveBeenCalledTimes(1);
	});

	it("falls back from RNNoise to Speex", async () => {
		const rnnoise = createMockSuppressor({
			initialize: vi.fn().mockRejectedValue(new Error("wasm unavailable")),
		});
		const speex = createMockSuppressor();

		const selection = await createNoiseSuppressorWithFallback({
			mode: "rnnoise",
			frameSize: 1024,
			sampleRate: 48000,
			deps: {
				createRnnoise: () => rnnoise,
				createSpeex: () => speex,
			},
		});

		expect(selection.activeMode).toBe("speex");
		expect(selection.warnings).toHaveLength(1);
		expect(rnnoise.destroy).toHaveBeenCalledTimes(1);
		expect(speex.initialize).toHaveBeenCalledTimes(1);
	});

	it("falls back to disabled when both algorithms fail", async () => {
		const disabled = createMockSuppressor();

		const selection = await createNoiseSuppressorWithFallback({
			mode: "rnnoise",
			frameSize: 1024,
			sampleRate: 48000,
			deps: {
				createRnnoise: () =>
					createMockSuppressor({
						initialize: vi.fn().mockRejectedValue(new Error("rnnoise failed")),
					}),
				createSpeex: () =>
					createMockSuppressor({
						initialize: vi.fn().mockRejectedValue(new Error("speex failed")),
					}),
				createDisabled: () => disabled,
			},
		});

		expect(selection.activeMode).toBe("disabled");
		expect(selection.warnings).toHaveLength(2);
		expect(disabled.initialize).toHaveBeenCalledTimes(1);
	});

	it("processes frames through the active suppressor and cleans up", async () => {
		const frame = new Float32Array([0.1, -0.1]);
		const processed = new Float32Array([0.05, -0.05]);
		const speex = createMockSuppressor({
			processAudioFrame: vi.fn(() => processed),
		});

		const selection = await createNoiseSuppressorWithFallback({
			mode: "speex",
			frameSize: 2,
			sampleRate: 48000,
			deps: {
				createSpeex: () => speex,
			},
		});

		expect(selection.suppressor.processAudioFrame(frame)).toBe(processed);
		selection.suppressor.destroy();
		expect(speex.destroy).toHaveBeenCalledTimes(1);
	});
});
