import { describe, expect, it } from "vitest";
import { parseNativeWebcamOutput, withNativeWebcam } from "./nativeWebcam";

describe("parseNativeWebcamOutput", () => {
	it("reads a started capture and its finished file", () => {
		const output = [
			"WEBCAM_CAPTURE_STARTED FaceTime HD Camera",
			"Recording started",
			"WEBCAM_OUTPUT /Users/me/Recordly/recordings/recording-1-webcam.mp4 OFFSET_MS 41",
			"Recording stopped. Output path: /Users/me/Recordly/recordings/recording-1.mp4",
		].join("\n");

		expect(parseNativeWebcamOutput(output)).toEqual({
			started: true,
			unavailableReason: null,
			webcamPath: "/Users/me/Recordly/recordings/recording-1-webcam.mp4",
			timeOffsetMs: 41,
		});
	});

	it("keeps spaces in the path", () => {
		const output =
			"WEBCAM_OUTPUT /Users/me/Library/Application Support/Recordly/recordings/recording-1-webcam.mp4 OFFSET_MS 0\n";
		expect(parseNativeWebcamOutput(output).webcamPath).toBe(
			"/Users/me/Library/Application Support/Recordly/recordings/recording-1-webcam.mp4",
		);
	});

	it("reports an unavailable camera as not started, with the reason", () => {
		expect(
			parseNativeWebcamOutput(
				"WEBCAM_CAPTURE_UNAVAILABLE camera access denied\nRecording started\n",
			),
		).toEqual({
			started: false,
			unavailableReason: "camera access denied",
			webcamPath: null,
			timeOffsetMs: 0,
		});
	});

	it("has no webcam file when writing it failed", () => {
		const status = parseNativeWebcamOutput(
			"WEBCAM_CAPTURE_STARTED Cam\nWEBCAM_OUTPUT_FAILED\n",
		);
		expect(status.started).toBe(true);
		expect(status.webcamPath).toBeNull();
	});

	it("finds nothing in output without webcam lines", () => {
		expect(parseNativeWebcamOutput("Recording started\n")).toEqual({
			started: false,
			unavailableReason: null,
			webcamPath: null,
			timeOffsetMs: 0,
		});
	});
});

describe("withNativeWebcam", () => {
	const written =
		"WEBCAM_CAPTURE_STARTED FaceTime HD Camera\nWEBCAM_OUTPUT /rec/recording-1-webcam.mp4 OFFSET_MS 29\n";

	it("attaches the finished webcam file to a stop or recovery result", () => {
		expect(withNativeWebcam({ success: true, path: "/rec/recording-1.mp4" }, written)).toEqual({
			success: true,
			path: "/rec/recording-1.mp4",
			webcamPath: "/rec/recording-1-webcam.mp4",
			webcamTimeOffsetMs: 29,
		});
	});

	it("leaves the result alone when the helper wrote no webcam file", () => {
		const stored = { success: true, path: "/rec/recording-1.mp4" };
		expect(withNativeWebcam(stored, "WEBCAM_CAPTURE_STARTED FaceTime HD Camera\n")).toBe(
			stored,
		);
		expect(withNativeWebcam(stored, "")).toBe(stored);
	});
});
