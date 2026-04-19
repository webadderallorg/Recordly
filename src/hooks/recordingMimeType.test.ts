import { describe, expect, it } from "vitest";
import { selectRecordingMimeType } from "./recordingMimeType";

describe("selectRecordingMimeType", () => {
	it("prefers codecs the editor can play back", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: () => true,
			canPlayType: (type) => {
				if (type === "video/webm;codecs=vp9") {
					return "probably";
				}

				if (type === "video/webm") {
					return "maybe";
				}

				return "";
			},
		});

		expect(mimeType).toBe("video/webm;codecs=vp9");
	});

	it("skips recorder-only codecs when playback support is missing", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: (type) =>
				[
					"video/webm;codecs=av1",
					"video/webm;codecs=h264",
					"video/webm;codecs=vp9",
				].includes(type),
			canPlayType: (type) => (type === "video/webm;codecs=vp9" ? "probably" : ""),
		});

		expect(mimeType).toBe("video/webm;codecs=vp9");
	});

	it("falls back to the first supported codec when playback probing is unavailable", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: (type) =>
				[
					"video/webm;codecs=av1",
					"video/webm;codecs=h264",
				].includes(type),
			canPlayType: () => "",
		});

		expect(mimeType).toBe("video/webm;codecs=av1");
	});

	it("uses generic webm as the final fallback", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: () => false,
			canPlayType: () => "",
		});

		expect(mimeType).toBe("video/webm");
	});
});
