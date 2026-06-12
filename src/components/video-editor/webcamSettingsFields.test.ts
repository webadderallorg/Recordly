import { describe, expect, it } from "vitest";
import { DEFAULT_WEBCAM_OVERLAY, type WebcamOverlaySettings } from "./types";
import { pickWebcamLayoutFields, stripWebcamPerRecordingFields } from "./webcamSettingsFields";

const sample: WebcamOverlaySettings = {
	...DEFAULT_WEBCAM_OVERLAY,
	enabled: true,
	sourcePath: "/tmp/recording.webcam.webm",
	timeOffsetMs: 250,
	mirror: false,
	cropRegion: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
	positionPreset: "custom",
	positionX: 0.95,
	positionY: 1,
	size: 32,
	cornerRadius: 90,
	shadow: 0.27,
	margin: 24,
};

describe("pickWebcamLayoutFields", () => {
	it("returns only layout fields", () => {
		const layout = pickWebcamLayoutFields(sample);
		expect(layout).toEqual({
			mirror: false,
			cropRegion: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
			corner: sample.corner,
			positionPreset: "custom",
			positionX: 0.95,
			positionY: 1,
			size: 32,
			reactToZoom: sample.reactToZoom,
			cornerRadius: 90,
			shadow: 0.27,
			margin: 24,
		});
		expect("sourcePath" in layout).toBe(false);
		expect("timeOffsetMs" in layout).toBe(false);
		expect("enabled" in layout).toBe(false);
	});
});

describe("stripWebcamPerRecordingFields", () => {
	it("resets per-recording fields and keeps layout", () => {
		const stripped = stripWebcamPerRecordingFields(sample);
		expect(stripped.sourcePath).toBeNull();
		expect(stripped.timeOffsetMs).toBe(DEFAULT_WEBCAM_OVERLAY.timeOffsetMs);
		expect(stripped.enabled).toBe(false);
		expect(stripped.positionX).toBe(0.95);
		expect(stripped.size).toBe(32);
		expect(stripped.cropRegion).toEqual(sample.cropRegion);
	});
});
