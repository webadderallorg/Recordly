import { describe, expect, it } from "vitest";

import { resolveAutoCaptionSourcePath } from "./autoCaptionSource";

describe("resolveAutoCaptionSourcePath", () => {
	it("prefers the video loaded in the editor over stale session state", () => {
		expect(
			resolveAutoCaptionSourcePath({
				videoSourcePath: "/videos/current.mp4",
				recordingSessionVideoPath: "/videos/stale.mp4",
				currentVideoPath: "/videos/fallback.mp4",
			}),
		).toBe("/videos/current.mp4");
	});

	it("falls back to the loaded file URL when no normalized source path exists", () => {
		expect(
			resolveAutoCaptionSourcePath({
				videoPath: "file:///Users/test/Desktop/capture.mp4",
				recordingSessionVideoPath: "/videos/stale.mp4",
			}),
		).toBe("/Users/test/Desktop/capture.mp4");
	});

	it("extracts local paths from Recordly media-server URLs", () => {
		expect(
			resolveAutoCaptionSourcePath({
				videoPath:
					"http://127.0.0.1:43123/video?path=%2FUsers%2Ftest%2FDesktop%2Fcapture.mp4",
			}),
		).toBe("/Users/test/Desktop/capture.mp4");
	});

	it("rejects remote URLs that native captioning cannot read", () => {
		expect(
			resolveAutoCaptionSourcePath({ videoPath: "https://example.com/capture.mp4" }),
		).toBeNull();
	});

	it("uses session and current video fallbacks only when nothing is loaded", () => {
		expect(
			resolveAutoCaptionSourcePath({
				recordingSessionVideoPath: "/videos/session.mp4",
				currentVideoPath: "/videos/fallback.mp4",
			}),
		).toBe("/videos/session.mp4");

		expect(
			resolveAutoCaptionSourcePath({
				currentVideoPath: "/videos/fallback.mp4",
			}),
		).toBe("/videos/fallback.mp4");
	});
});
