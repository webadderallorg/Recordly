import { describe, expect, it, vi } from "vitest";
import {
	createNoiseSuppressorWithFallback,
	DEFAULT_NOISE_SUPPRESSION_MODE,
	normalizeNoiseSuppressionMode,
	type NoiseSuppressor,
} from "./noiseSuppression";

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
