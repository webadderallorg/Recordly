import { describe, expect, it } from "vitest";

import { getLocalFilePathFromResource, getResourceFileName } from "./mediaResource";

describe("getLocalFilePathFromResource", () => {
	it("extracts the path from file URLs", () => {
		expect(getLocalFilePathFromResource("file:///tmp/example%20video.mp4")).toBe(
			"/tmp/example video.mp4",
		);
	});

	it("extracts the approved file path from loopback media server URLs", () => {
		expect(
			getLocalFilePathFromResource(
				"http://127.0.0.1:4321/video?path=%2Ftmp%2Fexample%20video.mp4",
			),
		).toBe("/tmp/example video.mp4");
	});

	it("does not treat arbitrary remote URLs as local files", () => {
		expect(getLocalFilePathFromResource("https://example.com/video.mp4")).toBeNull();
	});
});

describe("getResourceFileName", () => {
	it("uses the source file name for loopback media server URLs", () => {
		expect(
			getResourceFileName(
				"http://127.0.0.1:4321/video?path=%2Ftmp%2Fexample%20video.mp4",
				"fallback.mp4",
			),
		).toBe("example video.mp4");
	});
});
