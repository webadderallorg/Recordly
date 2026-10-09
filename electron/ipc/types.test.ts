import { describe, expect, it } from "vitest";
import { describeCaptureStartFailure, WINDOW_OFF_SCREEN_MESSAGE } from "./types";

describe("describeCaptureStartFailure", () => {
	it("turns the capture helper's Window not found into the clear message", () => {
		expect(
			describeCaptureStartFailure(new Error("Error starting capture: Window not found")),
		).toEqual({ message: WINDOW_OFF_SCREEN_MESSAGE, error: WINDOW_OFF_SCREEN_MESSAGE });
	});

	it("keeps other errors as they are", () => {
		expect(describeCaptureStartFailure(new Error("boom"))).toEqual({
			message: "Failed to start native ScreenCaptureKit recording",
			error: "Error: boom",
		});
	});
});
