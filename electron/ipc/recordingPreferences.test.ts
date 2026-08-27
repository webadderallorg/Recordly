import { describe, expect, it } from "vitest";
import { normalizeRecordingPreferences } from "./recordingPreferences";

describe("normalizeRecordingPreferences", () => {
	it("defaults legacy files to webcam blur off", () => {
		expect(normalizeRecordingPreferences({ microphoneEnabled: true })).toEqual({
			microphoneEnabled: true,
			microphoneDeviceId: undefined,
			systemAudioEnabled: false,
			webcamBackgroundBlur: { enabled: false, amount: 12 },
		});
	});

	it("normalizes webcam blur without losing audio preferences", () => {
		expect(
			normalizeRecordingPreferences({
				microphoneDeviceId: "mic-1",
				systemAudioEnabled: true,
				webcamBackgroundBlur: { enabled: true, amount: 1_000 },
			}),
		).toEqual({
			microphoneEnabled: false,
			microphoneDeviceId: "mic-1",
			systemAudioEnabled: true,
			webcamBackgroundBlur: { enabled: true, amount: 20 },
		});
	});
});
