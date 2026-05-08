import { describe, expect, it } from "vitest";
import { ATEMPO_FILTER_EPSILON } from "./ffmpeg/filters";
import {
	buildEditedTrackSourceAudioFilter,
	buildNativeConcatArgs,
	buildNativeCudaOverlayStaticLayoutArgs,
	buildNativeCudaScaleCpuPadStaticLayoutArgs,
	buildNativePrecompositedStaticLayoutArgs,
	buildNativeStaticBackgroundRenderArgs,
	buildNativeStaticLayoutChunks,
	buildTrimmedSourceAudioFilter,
	createNativeSquircleMaskPgmBuffer,
	isNativeCudaOutOfMemory,
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

describe("native static layout command builders", () => {
	const baseConfig = {
		inputPath: "input.mp4",
		outputPath: "chunk.mp4",
		width: 1920,
		height: 1080,
		frameRate: 60,
		bitrate: 8_000_000,
		encodingMode: "fast" as const,
		contentWidth: 1536,
		contentHeight: 864,
		offsetX: 192,
		offsetY: 108,
		backgroundColor: "#101010",
		startSec: 120,
		durationSec: 60,
	};

	it("builds the primary CUDA overlay layout command", () => {
		const args = buildNativeCudaOverlayStaticLayoutArgs(baseConfig);

		expect(args).toContain("-filter_complex");
		expect(args).toContain(
			"color=c=0x101010:s=1920x1080:r=60:d=60.000,format=nv12,hwupload_cuda[bg];" +
				"[0:v]scale_cuda=w=1536:h=864:format=nv12,fps=60[fg];" +
				"[bg][fg]overlay_cuda=192:108:shortest=0:repeatlast=1:eof_action=repeat,trim=duration=60.000,setpts=PTS-STARTPTS[out]",
		);
		expect(args).toContain("h264_nvenc");
		expect(args).toContain("p1");
		expect(args).not.toContain("yuv420p");
		expect(args).toEqual(expect.arrayContaining(["-ss", "120.000", "-t", "60.000"]));
	});

	it("builds the stable CUDA scale plus CPU pad fallback command", () => {
		const args = buildNativeCudaScaleCpuPadStaticLayoutArgs(baseConfig);

		expect(args).toEqual(
			expect.arrayContaining([
				"-vf",
				"scale_cuda=w=1536:h=864:format=nv12:passthrough=0,hwdownload,format=nv12,fps=60,pad=w=1920:h=1080:x=192:y=108:color=0x101010",
				"-map",
				"0:v:0",
				"-an",
			]),
		);
	});

	it("sanitizes unsupported background colors to the safe dark fallback", () => {
		const args = buildNativeCudaScaleCpuPadStaticLayoutArgs({
			...baseConfig,
			backgroundColor: "linear-gradient(red, blue)",
		});

		expect(args).toContain(
			"scale_cuda=w=1536:h=864:format=nv12:passthrough=0,hwdownload,format=nv12,fps=60,pad=w=1920:h=1080:x=192:y=108:color=0x101010",
		);
	});

	it("builds a precomposited background command for image wallpaper and shadow", () => {
		const args = buildNativeStaticBackgroundRenderArgs({
			...baseConfig,
			outputPath: "background.png",
			backgroundImagePath: "wallpaper.jpg",
			maskPath: "mask.pgm",
			shadowIntensity: 0.67,
		});
		const filterComplex = args[args.indexOf("-filter_complex") + 1];

		expect(args).toEqual(expect.arrayContaining(["-i", "wallpaper.jpg", "-i", "mask.pgm"]));
		expect(filterComplex).toContain(
			"scale=w=1920:h=1080:force_original_aspect_ratio=increase,crop=w=1920:h=1080",
		);
		expect(filterComplex).toContain("split=3");
		expect(filterComplex).toContain("gblur=sigma=32.16:steps=2");
		expect(filterComplex).toContain("overlay=x=119:y=35:format=auto");
		expect(args).toEqual(expect.arrayContaining(["-frames:v", "1", "background.png"]));
	});

	it("pre-blurs image wallpapers for native fallback static backgrounds", () => {
		const args = buildNativeStaticBackgroundRenderArgs({
			...baseConfig,
			outputPath: "background.png",
			backgroundImagePath: "wallpaper.jpg",
			backgroundBlurPx: 36,
		});
		const filterComplex = args[args.indexOf("-filter_complex") + 1];

		expect(filterComplex).toContain("[bg0]gblur=sigma=36:steps=2[bg_blur]");
		expect(filterComplex).toContain("[bg_blur]format=rgba[out]");
	});

	it("builds a precomposited static layout command with a squircle alpha mask", () => {
		const args = buildNativePrecompositedStaticLayoutArgs({
			...baseConfig,
			staticBackgroundPath: "background.png",
			maskPath: "mask.pgm",
			borderRadius: 12.5,
		});
		const filterComplex = args[args.indexOf("-filter_complex") + 1];

		expect(args).toEqual(expect.arrayContaining(["-i", "background.png", "-i", "mask.pgm"]));
		expect(filterComplex).toContain(
			"scale_cuda=w=1536:h=864:format=nv12:passthrough=0,hwdownload,format=nv12,fps=60,format=rgba",
		);
		expect(filterComplex).toContain("[fgbase][mask]alphamerge[fg]");
		expect(filterComplex).toContain("overlay=x=192:y=108:format=auto");
		expect(args).toContain("h264_nvenc");
		expect(args).toEqual(expect.arrayContaining(["-pix_fmt", "yuv420p"]));
	});

	it("creates an opaque PGM mask for square video corners and a partial mask for radius", () => {
		const squareMask = createNativeSquircleMaskPgmBuffer(4, 4, 0);
		expect(squareMask.subarray(squareMask.length - 16)).toEqual(Buffer.alloc(16, 255));

		const roundedMask = createNativeSquircleMaskPgmBuffer(8, 8, 4);
		const header = Buffer.from("P5\n8 8\n255\n", "ascii");
		const pixels = roundedMask.subarray(header.length);
		expect(pixels[0]).toBeLessThan(255);
		expect(pixels[4 * 8 + 4]).toBe(255);
	});

	it("splits long exports into bounded chunks", () => {
		expect(buildNativeStaticLayoutChunks(367.5, 120)).toEqual([
			{ index: 0, startSec: 0, durationSec: 120 },
			{ index: 1, startSec: 120, durationSec: 120 },
			{ index: 2, startSec: 240, durationSec: 120 },
			{ index: 3, startSec: 360, durationSec: 7.5 },
		]);
	});

	it("builds concat args for already encoded chunks", () => {
		expect(buildNativeConcatArgs({ listPath: "chunks.txt", outputPath: "out.mp4" })).toEqual([
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			"chunks.txt",
			"-c",
			"copy",
			"-movflags",
			"+faststart",
			"out.mp4",
		]);
	});

	it("detects CUDA OOM as a retryable fast-path failure", () => {
		expect(
			isNativeCudaOutOfMemory(
				"cu->cuMemAlloc(&data, size) failed -> CUDA_ERROR_OUT_OF_MEMORY: out of memory",
			),
		).toBe(true);
		expect(isNativeCudaOutOfMemory("FFmpeg exited with code 1")).toBe(false);
	});
});
