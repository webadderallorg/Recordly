import { describe, expect, it, vi } from "vitest";

vi.mock("./export/native-video", () => ({ probeNativeVideoMetadata: vi.fn() }));
vi.mock("./ffmpeg/binary", () => ({ getFfmpegBinaryPath: vi.fn(() => "ffmpeg") }));
vi.mock("./recording/diagnostics", () => ({
	getCompanionAudioFallbackInfo: vi.fn(async () => ({
		paths: [],
		startDelayMsByPath: {},
	})),
}));
vi.mock("./utils", () => ({
	getRecordingsDir: vi.fn(async () => "/recordings"),
	getTelemetryPathForVideo: vi.fn((videoPath: string) => `${videoPath}.cursor.json`),
}));

import { buildTimelineClipImportArgs } from "./timelineClipImport";

const source = {
	width: 1919,
	height: 1079,
	duration: 10,
	frameRate: 60,
	hasAudio: true,
};
const clip = {
	width: 1280,
	height: 720,
	duration: 2.5,
	frameRate: 30,
	hasAudio: false,
};

describe("buildTimelineClipImportArgs", () => {
	it("normalizes both videos to the source format and supplies silence when needed", () => {
		const args = buildTimelineClipImportArgs({
			sourcePath: "/recordings/source.mp4",
			clipPath: "/home/user/clip.mov",
			outputPath: "/recordings/composite.partial.mp4",
			source,
			clip,
		});
		const filter = args[args.indexOf("-filter_complex") + 1];

		expect(filter).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
		expect(filter).toContain("fps=60.000");
		expect(filter).toContain("[0:a:0]");
		expect(filter).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=2.500000");
		expect(filter).toContain("concat=n=2:v=1:a=1[vout][aout]");
		expect(args.slice(args.indexOf("-fps_mode"), args.indexOf("-c:v"))).toEqual([
			"-fps_mode",
			"cfr",
			"-r",
			"60.000",
		]);
		expect(args.at(-1)).toBe("/recordings/composite.partial.mp4");
	});

	it("mixes delayed companion tracks and adds their input files", () => {
		const args = buildTimelineClipImportArgs({
			sourcePath: "/recordings/source.mp4",
			clipPath: "/home/user/clip.mov",
			outputPath: "/recordings/composite.partial.mp4",
			source,
			clip: { ...clip, hasAudio: true },
			additionalInputPaths: ["/recordings/source.mic.m4a"],
			sourceAudioInputs: [{ inputIndex: 0 }, { inputIndex: 2, startDelayMs: 125 }],
			clipAudioInputs: [{ inputIndex: 1 }],
		});
		const filter = args[args.indexOf("-filter_complex") + 1];

		expect(args).toContain("/recordings/source.mic.m4a");
		expect(filter).toContain("[2:a:0]");
		expect(filter).toContain("adelay=125|125");
		expect(filter).toContain("amix=inputs=2:duration=longest:normalize=0");
	});
});
