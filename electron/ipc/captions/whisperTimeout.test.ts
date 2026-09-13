import { describe, expect, it } from "vitest";
import { getWavDurationSec, getWhisperTimeoutMs, isProcessTimeoutError } from "./whisperTimeout";

describe("getWhisperTimeoutMs", () => {
	it("keeps the 30 minute floor for short recordings", () => {
		expect(getWhisperTimeoutMs(60)).toBe(30 * 60 * 1000);
	});

	it("scales with audio length so a 40 minute recording gets 2 hours", () => {
		expect(getWhisperTimeoutMs(40 * 60)).toBe(120 * 60 * 1000);
	});

	it("falls back to the floor when the duration is unknown", () => {
		expect(getWhisperTimeoutMs(Number.NaN)).toBe(30 * 60 * 1000);
	});
});

describe("getWavDurationSec", () => {
	it("derives duration from a 16 kHz mono 16-bit PCM WAV size", () => {
		expect(getWavDurationSec(44 + 32_000 * 2400)).toBe(2400);
	});
});

describe("isProcessTimeoutError", () => {
	it("recognizes child processes killed by the execFile timeout", () => {
		expect(isProcessTimeoutError({ killed: true, signal: "SIGTERM" })).toBe(true);
	});

	it("does not treat ordinary non-zero exits as timeouts", () => {
		expect(isProcessTimeoutError({ killed: false, code: 1 })).toBe(false);
		expect(isProcessTimeoutError(new Error("unknown argument: -dtw"))).toBe(false);
	});
});
