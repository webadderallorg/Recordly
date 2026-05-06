import { describe, expect, it } from "vitest";

import {
	shouldStartWindowsBrowserMicrophoneFallback,
	shouldUseWindowsBrowserMicrophoneFallback,
	WINDOWS_MIC_CAPTURE_MODE_ENV,
} from "./windowsFallbacks";

describe("shouldUseWindowsBrowserMicrophoneFallback", () => {
	it("can be forced before native capture starts", () => {
		expect(
			shouldStartWindowsBrowserMicrophoneFallback(
				{ capturesMicrophone: true },
				{ [WINDOWS_MIC_CAPTURE_MODE_ENV]: "browser" },
			),
		).toBe(true);
	});

	it("does not force fallback when microphone capture was not requested", () => {
		expect(
			shouldStartWindowsBrowserMicrophoneFallback(
				{ capturesMicrophone: false },
				{ [WINDOWS_MIC_CAPTURE_MODE_ENV]: "browser" },
			),
		).toBe(false);
	});

	it("returns true when native Windows mic initialization fails", () => {
		expect(
			shouldUseWindowsBrowserMicrophoneFallback(
				"WARNING: Failed to initialize WASAPI mic capture\nRecording started",
				{ capturesMicrophone: true },
			),
		).toBe(true);
	});

	it("returns false when microphone capture was not requested", () => {
		expect(
			shouldUseWindowsBrowserMicrophoneFallback(
				"WARNING: Failed to initialize WASAPI mic capture\nRecording started",
				{ capturesMicrophone: false },
			),
		).toBe(false);
	});

	it("returns true when browser fallback is forced", () => {
		expect(
			shouldUseWindowsBrowserMicrophoneFallback(
				"Recording started",
				{ capturesMicrophone: true },
				{ [WINDOWS_MIC_CAPTURE_MODE_ENV]: "fallback" },
			),
		).toBe(true);
	});
});
