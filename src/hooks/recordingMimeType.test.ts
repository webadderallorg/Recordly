import { describe, expect, it } from "vitest";
import {
	getRecordingMimeTypes,
	getVideoExtensionForMimeType,
	isWebmMimeType,
	selectWebcamRecordingMimeType,
} from "./recordingMimeType";

describe("getRecordingMimeTypes", () => {
	it("keeps browser screen captures in WebM/H.264 when supported", () => {
		const mimeTypes = getRecordingMimeTypes({
			isTypeSupported: () => true,
			canPlayType: (type) => {
				if (type === "video/webm;codecs=h264") {
					return "probably";
				}

				if (type === "video/webm;codecs=vp9") {
					return "maybe";
				}

				return "";
			},
		});

		expect(mimeTypes).toEqual([
			"video/webm;codecs=h264",
			"video/webm;codecs=vp9",
			"video/webm",
			"video/webm;codecs=vp8",
			"video/webm;codecs=av1",
		]);
	});

	it("tries playable codecs before recorder-only codecs", () => {
		const mimeTypes = getRecordingMimeTypes({
			isTypeSupported: (type) =>
				["video/webm;codecs=vp9", "video/webm;codecs=vp8"].includes(type),
			canPlayType: (type) => (type === "video/webm;codecs=vp8" ? "probably" : ""),
		});

		expect(mimeTypes).toEqual(["video/webm;codecs=vp8", "video/webm;codecs=vp9"]);
	});

	it("falls back to the first supported codec when playback probing is unavailable", () => {
		const mimeTypes = getRecordingMimeTypes({
			isTypeSupported: (type) =>
				["video/webm;codecs=av1", "video/webm;codecs=h264"].includes(type),
			canPlayType: () => "",
		});

		expect(mimeTypes).toEqual(["video/webm;codecs=h264", "video/webm;codecs=av1"]);
	});

	it("returns an empty list when no preferred mime type is supported", () => {
		const mimeTypes = getRecordingMimeTypes({
			isTypeSupported: () => false,
			canPlayType: () => "",
		});

		expect(mimeTypes).toEqual([]);
	});

	it("avoids MP4 for webcam captures even when supported", () => {
		const mimeType = selectWebcamRecordingMimeType({
			isTypeSupported: (type) =>
				["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9"].includes(type),
			canPlayType: () => "probably",
		});

		expect(mimeType).toBe("video/webm;codecs=vp9");
	});

	it("falls back to WebM webcam capture when MP4 is unavailable", () => {
		const mimeType = selectWebcamRecordingMimeType({
			isTypeSupported: (type) => ["video/webm;codecs=vp9", "video/webm"].includes(type),
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

it("uses recordable H264 WebM even when Chromium reports playback unsupported", () => {
	expect(
		selectWebcamRecordingMimeType({
			isTypeSupported: () => true,
			canPlayType: (type) => (type.includes("mp4") ? "probably" : ""),
		}),
	).toBe("video/webm;codecs=h264");
});
it("refuses MP4-only webcam runtimes", () => {
	expect(
		selectWebcamRecordingMimeType({
			isTypeSupported: (type) => type.startsWith("video/mp4"),
			canPlayType: () => "probably",
		}),
	).toBeUndefined();
});
