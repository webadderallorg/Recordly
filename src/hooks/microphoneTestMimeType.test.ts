import { describe, expect, it } from "vitest";
import { selectMicrophoneTestMimeType } from "./microphoneTestMimeType";

describe("selectMicrophoneTestMimeType", () => {
	it("prefers codecs the audio element can play back", () => {
		const mimeType = selectMicrophoneTestMimeType({
			isTypeSupported: () => true,
			canPlayType: (type) => (type === "audio/webm;codecs=opus" ? "probably" : ""),
		});

		expect(mimeType).toBe("audio/webm;codecs=opus");
	});

	it("falls back to a more basic audio mime type when needed", () => {
		const mimeType = selectMicrophoneTestMimeType({
			isTypeSupported: () => true,
			canPlayType: (type) => (type === "audio/webm" ? "maybe" : ""),
		});

		expect(mimeType).toBe("audio/webm");
	});

	it("returns the first supported mime type when playback probing is unavailable", () => {
		const mimeType = selectMicrophoneTestMimeType({
			isTypeSupported: () => true,
			canPlayType: () => "",
		});

		expect(mimeType).toBe("audio/webm;codecs=opus");
	});

	it("returns undefined when no preferred mime type is supported", () => {
		const mimeType = selectMicrophoneTestMimeType({
			isTypeSupported: () => false,
			canPlayType: () => "",
		});

		expect(mimeType).toBeUndefined();
	});
});
