import { expect, it } from "vitest";
import { parseNativeCaptureInterruption } from "./interruption";
it("retains OS errors and never treats partial output as normal completion", () => {
	expect(
		parseNativeCaptureInterruption(
			"Recording started\nCAPTURE_INTERRUPTED: Screen permission revoked\nRecording interrupted. Output path: /take.mp4",
		),
	).toBe("Screen permission revoked");
	expect(parseNativeCaptureInterruption("Recording stopped. Output path: /take.mp4")).toBeNull();
});
