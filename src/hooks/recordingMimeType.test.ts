import { describe, expect, it } from "vitest";
import {
	getVideoExtensionForMimeType,
	isWebmMimeType,
	selectRecordingMimeType,
	selectWebcamRecordingMimeType,
} from "./recordingMimeType";

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
					"video/webm;codecs=vp9",
					"video/webm;codecs=vp8",
				].includes(type),
			canPlayType: (type) => (type === "video/webm;codecs=vp8" ? "probably" : ""),
		});

		expect(mimeType).toBe("video/webm;codecs=vp8");
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

	it("returns undefined when no preferred mime type is supported", () => {
		const mimeType = selectRecordingMimeType({
			isTypeSupported: () => false,
			canPlayType: () => "",
		});

		expect(mimeType).toBeUndefined();
	});

	it("prefers MP4/H.264 for webcam captures when supported", () => {
		const mimeType = selectWebcamRecordingMimeType({
			isTypeSupported: (type) =>
				["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9"].includes(
					type,
				),
			canPlayType: () => "probably",
		});

		expect(mimeType).toBe("video/mp4;codecs=avc1.42E01E");
	});

	it("falls back to WebM webcam capture when MP4 is unavailable", () => {
		const mimeType = selectWebcamRecordingMimeType({
			isTypeSupported: (type) =>
				["video/webm;codecs=vp9", "video/webm"].includes(type),
			canPlayType: () => "probably",
		});

		expect(mimeType).toBe("video/webm;codecs=vp9");
	});

	it("maps recording MIME types to the saved file extension", () => {
		expect(getVideoExtensionForMimeType("video/mp4;codecs=avc1")).toBe(".mp4");
		expect(getVideoExtensionForMimeType("video/webm;codecs=vp9")).toBe(".webm");
		expect(getVideoExtensionForMimeType(undefined)).toBe(".webm");
	});

	it("detects WebM MIME types for duration repair", () => {
		expect(isWebmMimeType("video/webm;codecs=vp9")).toBe(true);
		expect(isWebmMimeType("video/mp4;codecs=avc1")).toBe(false);
		expect(isWebmMimeType(undefined)).toBe(false);
	});
});
