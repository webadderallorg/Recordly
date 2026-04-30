import { describe, expect, it } from "vitest";
import { ATEMPO_FILTER_EPSILON } from "./ffmpeg/filters";
import {
	buildEditedTrackSourceAudioFilter,
	buildNativeFastVideoExportArgs,
	buildTrimmedSourceAudioFilter,
	canStreamCopyNativeFastVideoExport,
	parseNativeFastVideoSourceProbe,
} from "./nativeVideoExport";

describe("buildTrimmedSourceAudioFilter", () => {
	it("concatenates trimmed source segments into a single output label", () => {
		expect(
			buildTrimmedSourceAudioFilter([
				{ startMs: 0, endMs: 2_000 },
				{ startMs: 4_000, endMs: 6_000 },
			]),
		).toBe(
			"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS[trimmed_audio_0];" +
				"[1:a]atrim=start=4.000:end=6.000,asetpts=PTS-STARTPTS[trimmed_audio_1];" +
				"[trimmed_audio_0][trimmed_audio_1]concat=n=2:v=0:a=1[aout]",
		);
	});
});

describe("buildNativeFastVideoExportArgs", () => {
	it("builds a direct FFmpeg export that maps optional audio and scales in-process", () => {
		const args = buildNativeFastVideoExportArgs(
			"libx264",
			{
				sourcePath: "C:\\Videos\\source.mp4",
				width: 1920,
				height: 1080,
				frameRate: 30,
				bitrate: 20_000_000,
				encodingMode: "fast",
			},
			"C:\\Videos\\out.mp4",
		);

		expect(args).toContain("-map");
		expect(args).toContain("0:a:0?");
		expect(args).toContain("scale=1920:1080:flags=lanczos,setsar=1,fps=30,format=yuv420p");
		expect(args).toContain("libx264");
		expect(args).toContain("ultrafast");
	});

	it("uses input seeking for a single contiguous kept segment", () => {
		const args = buildNativeFastVideoExportArgs(
			"h264_nvenc",
			{
				sourcePath: "C:\\Videos\\source.mp4",
				width: 1280,
				height: 720,
				frameRate: 60,
				bitrate: 10_000_000,
				encodingMode: "balanced",
				segments: [{ startMs: 5_000, endMs: 15_000 }],
			},
			"C:\\Videos\\out.mp4",
		);

		expect(args.slice(0, 10)).toContain("-ss");
		expect(args).toContain("5.000");
		expect(args).toContain("-t");
		expect(args).toContain("10.000");
		expect(args).toContain("h264_nvenc");
	});

	it("stream-copies a matching source without scaling or re-encoding", () => {
		const args = buildNativeFastVideoExportArgs(
			"copy",
			{
				sourcePath: "C:\\Videos\\source.mp4",
				width: 1280,
				height: 720,
				frameRate: 30,
				bitrate: 10_000_000,
				encodingMode: "fast",
				videoMode: "copy",
			},
			"C:\\Videos\\out.mp4",
		);

		expect(args).toContain("copy");
		expect(args).not.toContain("-vf");
		expect(args.join(" ")).toContain("-c:v copy -c:a copy");
	});
});

describe("native fast video source probing", () => {
	const ffmpegProbeOutput = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 160 kb/s (default)
`;

	it("parses FFmpeg input stream metadata for guarded stream-copy decisions", () => {
		expect(parseNativeFastVideoSourceProbe(ffmpegProbeOutput)).toEqual({
			videoCodecName: "h264",
			audioCodecName: "aac",
			pixelFormat: "yuv420p",
			width: 1280,
			height: 720,
			fps: 30,
		});
	});

	it("allows stream copy only when codec, dimensions, fps, and timeline match", () => {
		const options = {
			sourcePath: "C:\\Videos\\source.mp4",
			width: 1280,
			height: 720,
			frameRate: 30,
			bitrate: 10_000_000,
			encodingMode: "fast" as const,
		};
		const probe = parseNativeFastVideoSourceProbe(ffmpegProbeOutput);

		expect(canStreamCopyNativeFastVideoExport(probe, options)).toBe(true);
		expect(
			canStreamCopyNativeFastVideoExport(probe, {
				...options,
				width: 1920,
				height: 1080,
			}),
		).toBe(false);
		expect(
			canStreamCopyNativeFastVideoExport(probe, {
				...options,
				segments: [{ startMs: 1_000, endMs: 2_000 }],
			}),
		).toBe(false);
		expect(
			canStreamCopyNativeFastVideoExport({ ...probe, pixelFormat: "yuv444p" }, options),
		).toBe(false);
	});
});

describe("buildEditedTrackSourceAudioFilter", () => {
	it("builds a concat filtergraph that applies tempo filters for speed changes", () => {
		const filter = buildEditedTrackSourceAudioFilter(
			[
				{ startMs: 0, endMs: 2_000, speed: 1 },
				{ startMs: 2_000, endMs: 6_000, speed: 1.5 },
			],
			44_100,
		);

		expect(filter).toBe(
			"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS[edited_audio_0];" +
				"[1:a]atrim=start=2.000:end=6.000,asetpts=PTS-STARTPTS,atempo=1.500000[edited_audio_1];" +
				"[edited_audio_0][edited_audio_1]concat=n=2:v=0:a=1[aout]",
		);
	});

	it("builds a filtergraph for slowdown segments with a tempo filter", () => {
		const filter = buildEditedTrackSourceAudioFilter(
			[{ startMs: 0, endMs: 2_000, speed: 0.5 }],
			44_100,
		);

		expect(filter).toBe(
			"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS,atempo=0.500000[edited_audio_0];" +
				"[edited_audio_0]anull[aout]",
		);
	});

	it("treats near-unity speed changes as unchanged audio", () => {
		const filter = buildEditedTrackSourceAudioFilter(
			[{ startMs: 0, endMs: 2_000, speed: 1.0002 }],
			44_100,
		);

		expect(filter).toBe(
			"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS[edited_audio_0];" +
				"[edited_audio_0]anull[aout]",
		);
	});

	it("treats exact epsilon speed changes as unchanged audio", () => {
		for (const speed of [1 - ATEMPO_FILTER_EPSILON, 1 + ATEMPO_FILTER_EPSILON]) {
			const filter = buildEditedTrackSourceAudioFilter(
				[{ startMs: 0, endMs: 2_000, speed }],
				44_100,
			);

			expect(filter).toBe(
				"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS[edited_audio_0];" +
					"[edited_audio_0]anull[aout]",
			);
		}
	});

	it("returns null when the edited-track filtergraph inputs are incomplete", () => {
		expect(buildEditedTrackSourceAudioFilter([], 44_100)).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter(
				[{ startMs: 0, endMs: 2_000, speed: 1.5 }],
				Number.NaN,
			),
		).toBeNull();
	});

	it("returns null when the edited-track segments are malformed", () => {
		expect(
			buildEditedTrackSourceAudioFilter(
				[{ startMs: Number.NaN, endMs: 2_000, speed: 1.5 }],
				44_100,
			),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter([{ startMs: 0, endMs: 2_000, speed: 0 }], 44_100),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter([{ startMs: 0, endMs: 2_000, speed: -1 }], 44_100),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter(
				[{ startMs: 0, endMs: 2_000, speed: Number.NaN }],
				44_100,
			),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter([{ startMs: 0, endMs: 2_000, speed: 1 }], 0.4),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter([{ startMs: -100, endMs: 2_000, speed: 1 }], 44_100),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter(
				[{ startMs: 0, endMs: 2_000, speed: Number.MAX_SAFE_INTEGER }],
				44_100,
			),
		).toBeNull();
	});
});
