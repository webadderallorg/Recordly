import { describe, expect, it } from "vitest";
import { buildWhisperArgAttempts, getWhisperDtwPreset } from "./whisperDtw";

describe("getWhisperDtwPreset", () => {
	it("maps the bundled small model to the small DTW preset", () => {
		expect(getWhisperDtwPreset("/home/user/.config/Recordly/whisper/ggml-small.bin")).toBe(
			"small",
		);
	});

	it("maps English-only, large and quantized model file names", () => {
		expect(getWhisperDtwPreset("ggml-base.en.bin")).toBe("base.en");
		expect(getWhisperDtwPreset("C:\\models\\ggml-large-v3-turbo-q5_0.bin")).toBe(
			"large.v3.turbo",
		);
		expect(getWhisperDtwPreset("ggml-medium-q8_0.bin")).toBe("medium");
	});

	it("returns null for model files whose alignment heads are unknown", () => {
		expect(getWhisperDtwPreset("/models/custom-finetune.bin")).toBeNull();
	});
});

describe("buildWhisperArgAttempts", () => {
	const baseArgs = ["-m", "ggml-small.bin", "-f", "audio.wav"];

	it("tries DTW word timings first, then JSON without DTW, then SRT only", () => {
		expect(buildWhisperArgAttempts(baseArgs, "ggml-small.bin")).toEqual([
			{ args: [...baseArgs, "-ojf", "-dtw", "small", "-nfa"], jsonEnabled: true },
			{ args: [...baseArgs, "-ojf"], jsonEnabled: true },
			{ args: baseArgs, jsonEnabled: false },
		]);
	});

	it("skips the DTW attempt when the model has no known preset", () => {
		expect(buildWhisperArgAttempts(baseArgs, "custom.bin")).toEqual([
			{ args: [...baseArgs, "-ojf"], jsonEnabled: true },
			{ args: baseArgs, jsonEnabled: false },
		]);
	});
});
