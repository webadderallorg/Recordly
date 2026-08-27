import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp/recordly-test", isPackaged: false },
}));

import {
	buildConcatListContent,
	getNativeLinuxCaptureAvailability,
	isNativeLinuxCaptureSupportedSource,
	parseFfmpegProgressFrame,
	selectSegmentPathsForConcat,
	withProgressReporting,
} from "./linux";

describe("getNativeLinuxCaptureAvailability", () => {
	const x11 = { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" };

	it("is available on X11 with FFmpeg", () => {
		expect(
			getNativeLinuxCaptureAvailability({
				env: x11,
				platform: "linux",
				ffmpegPath: "/usr/bin/ffmpeg",
			}),
		).toEqual({ available: true });
	});

	it("is unavailable on Wayland", () => {
		expect(
			getNativeLinuxCaptureAvailability({
				env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				platform: "linux",
				ffmpegPath: "/usr/bin/ffmpeg",
			}).available,
		).toBe(false);
	});

	it("is unavailable without FFmpeg or off Linux", () => {
		expect(
			getNativeLinuxCaptureAvailability({ env: x11, platform: "linux", ffmpegPath: null })
				.available,
		).toBe(false);
		expect(
			getNativeLinuxCaptureAvailability({
				env: x11,
				platform: "darwin",
				ffmpegPath: "/usr/bin/ffmpeg",
			}).available,
		).toBe(false);
	});
});

describe("isNativeLinuxCaptureSupportedSource", () => {
	it("accepts live screen and window sources", () => {
		expect(isNativeLinuxCaptureSupportedSource({ id: "screen:408:0" })).toBe(true);
		expect(isNativeLinuxCaptureSupportedSource({ id: "window:123:0" })).toBe(true);
	});

	it("rejects the portal sentinel, fallback ids, and empty sources", () => {
		expect(isNativeLinuxCaptureSupportedSource({ id: "screen:linux-portal" })).toBe(false);
		expect(isNativeLinuxCaptureSupportedSource({ id: "screen:fallback:1" })).toBe(false);
		expect(isNativeLinuxCaptureSupportedSource({ id: "window:fallback:1" })).toBe(false);
		expect(isNativeLinuxCaptureSupportedSource(null)).toBe(false);
	});
});

describe("withProgressReporting", () => {
	it("keeps -y first and adds progress flags before the input", () => {
		expect(withProgressReporting(["-y", "-f", "x11grab", "-i", ":0"])).toEqual([
			"-y",
			"-progress",
			"pipe:1",
			"-stats_period",
			"0.05",
			"-nostats",
			"-f",
			"x11grab",
			"-i",
			":0",
		]);
	});
});

describe("parseFfmpegProgressFrame", () => {
	it("returns the latest frame count in a progress chunk", () => {
		expect(parseFfmpegProgressFrame("frame=0\nfps=0.0\nprogress=continue\nframe=12\n")).toBe(
			12,
		);
	});

	it("returns null without a frame line", () => {
		expect(parseFfmpegProgressFrame("bitrate=N/A\nprogress=continue\n")).toBeNull();
	});
});

describe("selectSegmentPathsForConcat", () => {
	it("drops segments that never produced a frame", () => {
		expect(
			selectSegmentPathsForConcat([
				{ path: "/tmp/a.mp4", firstFrameSeen: true },
				{ path: "/tmp/b.mp4", firstFrameSeen: false },
				{ path: "/tmp/c.mp4", firstFrameSeen: true },
			]),
		).toEqual(["/tmp/a.mp4", "/tmp/c.mp4"]);
	});

	it("keeps the last segment when none reported a frame", () => {
		expect(
			selectSegmentPathsForConcat([
				{ path: "/tmp/a.mp4", firstFrameSeen: false },
				{ path: "/tmp/b.mp4", firstFrameSeen: false },
			]),
		).toEqual(["/tmp/b.mp4"]);
	});
});

describe("buildConcatListContent", () => {
	it("quotes paths for the concat demuxer", () => {
		expect(buildConcatListContent(["/tmp/a.mp4", "/tmp/it's.mp4"])).toBe(
			"file '/tmp/a.mp4'\nfile '/tmp/it'\\''s.mp4'\n",
		);
	});
});
