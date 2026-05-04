import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getAppPath: vi.fn(() => process.cwd()),
		getPath: vi.fn(() => process.env.TEMP ?? process.cwd()),
		isPackaged: false,
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: vi.fn(() => "ffmpeg"),
}));

vi.mock("../state", () => ({
	cachedNativeVideoEncoder: null,
	setCachedNativeVideoEncoder: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
	access: vi.fn(async () => {
		throw new Error("missing");
	}),
	writeFile: vi.fn(async () => undefined),
	readFile: vi.fn(),
	stat: vi.fn(async () => ({ size: 5_000_000_000 })),
	unlink: vi.fn(async () => undefined),
}));

vi.mock("node:fs/promises", () => ({
	default: fsMocks,
	...fsMocks,
}));

const execFileMock = vi.hoisted(() =>
	vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
		cb(null);
		return { stdout: "", stderr: "" } as unknown;
	}),
);

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
	spawn: vi.fn(),
}));

import {
	buildNativeVideoAudioMuxArgs,
	getNvidiaCudaAudioExportSkipReason,
	muxExportedVideoAudioBuffer,
	normalizeNativeStaticLayoutBackground,
	parseFfmpegDurationSeconds,
	parseFfmpegFrameRate,
	parseNativeVideoMetadataProbeOutput,
	parseNvidiaCudaExportSummary,
	parseWindowsGpuExportProgressLine,
	parseWindowsGpuExportSummary,
	validateNvidiaCudaExportSummary,
} from "./native-video";

function withNvidiaCudaAudioOverride<T>(value: string | undefined, callback: () => T) {
	const envName = "RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT";
	const originalValue = process.env[envName];
	if (value === undefined) {
		delete process.env[envName];
	} else {
		process.env[envName] = value;
	}

	try {
		return callback();
	} finally {
		if (originalValue === undefined) {
			delete process.env[envName];
		} else {
			process.env[envName] = originalValue;
		}
	}
}

describe("normalizeNativeStaticLayoutBackground", () => {
	it("falls back to a solid background when the configured image file is missing", async () => {
		const normalized = await normalizeNativeStaticLayoutBackground({
			inputPath: "input.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			encodingMode: "quality",
			durationSec: 10,
			contentWidth: 1600,
			contentHeight: 900,
			offsetX: 160,
			offsetY: 90,
			backgroundColor: "#101010",
			backgroundImagePath: "Z:\\recordly-missing-wallpaper\\midnight-8.jpg",
		});

		expect(normalized.backgroundImagePath).toBeNull();
		expect(normalized.backgroundColor).toBe("#ffffff");
	});
});

describe("getNvidiaCudaAudioExportSkipReason", () => {
	it("allows video-only CUDA exports by default", () => {
		withNvidiaCudaAudioOverride(undefined, () => {
			expect(getNvidiaCudaAudioExportSkipReason(undefined)).toBeNull();
			expect(getNvidiaCudaAudioExportSkipReason("none")).toBeNull();
		});
	});

	it("guards CUDA for audio exports unless explicitly overridden", () => {
		withNvidiaCudaAudioOverride(undefined, () => {
			expect(getNvidiaCudaAudioExportSkipReason("copy-source")).toBe(
				"audio-mode:copy-source",
			);
			expect(getNvidiaCudaAudioExportSkipReason("trim-source")).toBe(
				"audio-mode:trim-source",
			);
			expect(getNvidiaCudaAudioExportSkipReason("edited-track")).toBe(
				"audio-mode:edited-track",
			);
		});
	});

	it("allows CUDA audio exports only for explicit lab overrides", () => {
		withNvidiaCudaAudioOverride("1", () => {
			expect(getNvidiaCudaAudioExportSkipReason("copy-source")).toBeNull();
		});
	});
});

describe("muxExportedVideoAudioBuffer", () => {
	it("returns the muxed output path without reading the muxed file into memory", async () => {
		const videoData = new ArrayBuffer(64);
		const result = await muxExportedVideoAudioBuffer(videoData, { audioMode: "none" });

		expect(typeof result.outputPath).toBe("string");
		expect(result.outputPath.length).toBeGreaterThan(0);
		// The >2 GiB fix relies on stat-only metric collection; readFile must stay unused.
		expect(fsMocks.readFile).not.toHaveBeenCalled();
		expect(result.metrics.muxedVideoBytes).toBe(5_000_000_000);
	});

	it("preserves the input temp path when audioMode='none' (no re-mux)", async () => {
		const videoData = new ArrayBuffer(32);
		const result = await muxExportedVideoAudioBuffer(videoData, { audioMode: "none" });

		expect(result.outputPath).toMatch(/recordly-export-video-/);
	});
});

describe("buildNativeVideoAudioMuxArgs", () => {
	it("stream-copies source audio and preserves the requested video duration", () => {
		const args = buildNativeVideoAudioMuxArgs("video.mp4", "source.mp4", "out.mp4", {
			audioMode: "copy-source",
			outputDurationSec: 60,
		});

		expect(args).toEqual(
			expect.arrayContaining([
				"-map",
				"0:v:0",
				"-map",
				"1:a:0",
				"-c:v",
				"copy",
				"-c:a",
				"copy",
				"-t",
				"60.000",
			]),
		);
		expect(args).not.toContain("-shortest");
	});

	it("does not shorten copy-source muxes when no explicit duration is available", () => {
		const args = buildNativeVideoAudioMuxArgs("video.mp4", "source.mp4", "out.mp4", {
			audioMode: "copy-source",
		});

		expect(args).toEqual(expect.arrayContaining(["-c:a", "copy"]));
		expect(args).not.toContain("-shortest");
	});

	it("keeps filtered audio on the AAC encode path", () => {
		const args = buildNativeVideoAudioMuxArgs("video.mp4", "source.mp4", "out.mp4", {
			audioMode: "trim-source",
			trimSegments: [{ startMs: 0, endMs: 1_000 }],
			outputDurationSec: 1,
		});

		expect(args).toEqual(expect.arrayContaining(["-filter_complex"]));
		expect(args).toEqual(expect.arrayContaining(["-c:a", "aac", "-b:a", "192k"]));
	});
});

describe("parseWindowsGpuExportSummary", () => {
	it("returns the last JSON summary from helper stdout", () => {
		const summary = parseWindowsGpuExportSummary(
			[
				"initializing",
				'{"success":true,"frames":30,"totalMs":1000,"realtimeMultiplier":2}',
				"cleanup",
				'{"success":true,"frames":60,"surfacePoolSize":12,"readMs":12.5,"videoProcessMs":30,"writeSampleMs":40,"finalizeMs":5,"realtimeMultiplier":4}',
			].join("\n"),
		);

		expect(summary).toEqual({
			success: true,
			frames: 60,
			surfacePoolSize: 12,
			readMs: 12.5,
			videoProcessMs: 30,
			writeSampleMs: 40,
			finalizeMs: 5,
			realtimeMultiplier: 4,
		});
	});

	it("returns null when helper stdout has no valid JSON summary", () => {
		expect(parseWindowsGpuExportSummary("initializing\nnot-json")).toBeNull();
		expect(parseWindowsGpuExportSummary("")).toBeNull();
	});
});

describe("parseNvidiaCudaExportSummary", () => {
	it("parses the pretty JSON summary emitted by the CUDA wrapper", () => {
		const summary = parseNvidiaCudaExportSummary(
			[
				"preflight",
				JSON.stringify(
					{
						success: true,
						fps: 30,
						durationSec: 10,
						targetFrames: 300,
						timingsMs: { nativeEncode: 920, mux: 45, endToEnd: 1400 },
						nativeSummary: { success: true, frames: 300, fps: 326.1 },
					},
					null,
					2,
				),
			].join("\n"),
		);

		expect(summary?.success).toBe(true);
		expect(summary?.targetFrames).toBe(300);
		expect(summary?.timingsMs?.nativeEncode).toBe(920);
		expect(summary?.nativeSummary?.fps).toBe(326.1);
	});

	it("returns null when the wrapper output has no JSON object", () => {
		expect(parseNvidiaCudaExportSummary("native helper failed before summary")).toBeNull();
	});
});

describe("validateNvidiaCudaExportSummary", () => {
	it("accepts CUDA output when frames and stream durations match the export target", () => {
		const issues = validateNvidiaCudaExportSummary(
			{
				success: true,
				targetFrames: 300,
				durationSec: 10,
				nativeSummary: { success: true, frames: 300 },
				outputVideo: { duration: "9.999900", nb_frames: "300" },
				outputAudio: { duration: "10.005000" },
			},
			{ durationSec: 10, targetFrames: 300 },
		);

		expect(issues).toEqual([]);
	});

	it("rejects CUDA output that reports too few frames or a short video stream", () => {
		const issues = validateNvidiaCudaExportSummary(
			{
				success: true,
				targetFrames: 300,
				durationSec: 10,
				nativeSummary: { success: true, frames: 144 },
				outputVideo: { duration: "4.799952", nb_frames: "144" },
				outputAudio: { duration: "10.005000" },
			},
			{ durationSec: 10, targetFrames: 300 },
		);

		expect(issues).toEqual([
			"native frames 144 below expected minimum 285",
			"output video frames 144 below expected minimum 285",
			"output video duration 4.800s differs from expected 10.000s",
		]);
	});

	it("rejects audio CUDA output unless the helper reports timestamp-aligned frame selection", () => {
		const issues = validateNvidiaCudaExportSummary(
			{
				success: true,
				targetFrames: 300,
				durationSec: 10,
				nativeSummary: {
					success: true,
					frames: 300,
					selectionStage: "decoder-policy-mapped-callback",
				},
				outputVideo: { duration: "9.999900", nb_frames: "300" },
				outputAudio: { duration: "10.005000" },
			},
			{ durationSec: 10, targetFrames: 300, requiresTimelineSync: true },
		);

		expect(issues).toEqual([
			"CUDA timeline mode is not timestamp-aligned for audio export",
		]);
	});

	it("accepts audio CUDA output when the helper reports PTS-aligned selection", () => {
		const issues = validateNvidiaCudaExportSummary(
			{
				success: true,
				targetFrames: 300,
				durationSec: 10,
				nativeSummary: {
					success: true,
					frames: 300,
					sourceTimestampMode: "pts",
					selectionStage: "timestamp-mapped-callback",
				},
				outputVideo: { duration: "9.999900", nb_frames: "300" },
				outputAudio: { duration: "10.005000" },
			},
			{ durationSec: 10, targetFrames: 300, requiresTimelineSync: true },
		);

		expect(issues).toEqual([]);
	});
});

describe("parseWindowsGpuExportProgressLine", () => {
	it("parses bounded helper progress lines", () => {
		expect(
			parseWindowsGpuExportProgressLine(
				'PROGRESS {"currentFrame":30,"totalFrames":60,"percentage":50,"averageFps":240.5,"instantFps":180.25,"intervalMs":166.4,"intervalFrames":30,"intervalEncodeMs":120.2,"intervalPipelineWaitMs":46.2,"intervalMonolithicCompositeFrames":0}',
			),
		).toEqual({
			currentFrame: 30,
			totalFrames: 60,
			percentage: 50,
			averageFps: 240.5,
			instantFps: 180.25,
			intervalMs: 166.4,
			intervalFrames: 30,
			intervalEncodeMs: 120.2,
			intervalPipelineWaitMs: 46.2,
			intervalMonolithicCompositeFrames: 0,
		});
	});

	it("ignores non-progress or malformed helper stderr", () => {
		expect(parseWindowsGpuExportProgressLine("warning: encoder selected")).toBeNull();
		expect(parseWindowsGpuExportProgressLine("PROGRESS not-json")).toBeNull();
		expect(
			parseWindowsGpuExportProgressLine(
				'PROGRESS {"currentFrame":1,"totalFrames":0,"percentage":999}',
			),
		).toBeNull();
	});
});

describe("parseNativeVideoMetadataProbeOutput", () => {
	it("parses FFmpeg input metadata with video and audio streams", () => {
		const metadata = parseNativeVideoMetadataProbeOutput(`
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'recording.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:06:04.25, start: 0.000000, bitrate: 3938 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080, 3720 kb/s, 46.05 fps, 60 tbr, 90k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)
`);

		expect(metadata).toEqual({
			width: 1920,
			height: 1080,
			duration: 364.25,
			mediaStartTime: 0,
			streamStartTime: 0,
			streamDuration: 364.25,
			frameRate: 46.05,
			codec: "h264 (High) (avc1 / 0x31637661)",
			hasAudio: true,
			audioCodec: "aac (LC) (mp4a / 0x6134706D)",
			audioSampleRate: 48000,
		});
	});

	it("parses video-only metadata and falls back to tbr when fps is absent", () => {
		const metadata = parseNativeVideoMetadataProbeOutput(`
Input #0, matroska,webm, from 'recording.webm':
  Duration: 00:00:10.50, start: 0.023000, bitrate: 1000 kb/s
  Stream #0:0: Video: vp9, yuv420p, 1280x720, 30 tbr, 1k tbn
`);

		expect(metadata).toEqual({
			width: 1280,
			height: 720,
			duration: 10.5,
			mediaStartTime: 0.023,
			streamStartTime: 0.023,
			streamDuration: 10.5,
			frameRate: 30,
			codec: "vp9",
			hasAudio: false,
			audioCodec: undefined,
			audioSampleRate: undefined,
		});
	});

	it("rejects output without usable video metadata", () => {
		expect(parseNativeVideoMetadataProbeOutput("Duration: N/A")).toBeNull();
		expect(parseNativeVideoMetadataProbeOutput("not a media file")).toBeNull();
	});
});

describe("parseFfmpegDurationSeconds", () => {
	it("parses HH:MM:SS timestamps", () => {
		expect(parseFfmpegDurationSeconds("01:02:03.5")).toBe(3723.5);
		expect(parseFfmpegDurationSeconds("bad")).toBeNull();
	});
});

describe("parseFfmpegFrameRate", () => {
	it("prefers fps and falls back to tbr", () => {
		expect(parseFfmpegFrameRate("Video: h264, 1920x1080, 59.94 fps, 60 tbr")).toBe(59.94);
		expect(parseFfmpegFrameRate("Video: h264, 1920x1080, 30 tbr")).toBe(30);
		expect(parseFfmpegFrameRate("Video: h264")).toBeNull();
	});
});
