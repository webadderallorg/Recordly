import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRecordedVideoStoragePath } from "./storagePath";

describe("resolveRecordedVideoStoragePath", () => {
	const recordingsDir = path.resolve("recordings-root");

	it.each([
		"recording-0.webm",
		"recording-1720588800000.mp4",
		"recording-1720588800000-webcam.webm",
		"recording-1720588800000-webcam.mp4",
	])("accepts an app-generated recording name: %s", (fileName) => {
		expect(resolveRecordedVideoStoragePath(recordingsDir, fileName)).toBe(
			path.resolve(recordingsDir, fileName),
		);
	});

	it.each([
		"",
		"../recording-1.webm",
		"..\\recording-1.webm",
		"nested/recording-1.webm",
		"nested\\recording-1.webm",
		"/tmp/recording-1.webm",
		"C:\\temp\\recording-1.webm",
		"\\\\server\\share\\recording-1.webm",
		"recording-1.webm:payload",
		"recording-1.webm\n",
		"recording-1.webm\0",
		"recording--1.webm",
		"recording-1.5.webm",
		"recording-1.mov",
		"other-1.webm",
		"recording-1-WEBCAM.webm",
	])("rejects an untrusted recording name: %s", (fileName) => {
		expect(() => resolveRecordedVideoStoragePath(recordingsDir, fileName)).toThrow(
			"Invalid recording file name",
		);
	});

	it.each([
		{ label: "undefined", value: undefined },
		{ label: "null", value: null },
		{ label: "number", value: 1 },
		{ label: "object", value: {} },
		{ label: "array", value: [] },
	])("rejects a non-string recording name: $label", ({ value }) => {
		expect(() => resolveRecordedVideoStoragePath(recordingsDir, value)).toThrow(
			"Invalid recording file name",
		);
	});
});
