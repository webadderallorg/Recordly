import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureCanvasFrameForNativeExport } from "../../src/lib/exporter/nativeFrameCapture";
import { ATEMPO_FILTER_EPSILON } from "./ffmpeg/filters";
import {
	buildEditedTrackSourceAudioFilter,
	buildNativeConcatArgs,
	buildNativeCudaOverlayStaticLayoutArgs,
	buildNativeCudaScaleCpuPadStaticLayoutArgs,
	buildNativePrecompositedStaticLayoutArgs,
	buildNativeStaticBackgroundRenderArgs,
	buildNativeStaticLayoutChunks,
	buildNativeVideoExportArgs,
	buildTrimmedSourceAudioFilter,
	createNativeSquircleMaskPgmBuffer,
	getCpuEncoderForCodec,
	getNativeEncoderCandidates,
	isNativeCudaOutOfMemory,
} from "./nativeVideoExport";

const childProcessMocks = vi.hoisted(() => ({
	encoderNames: "",
	failingEncoders: new Set<string>(),
	execFile: vi.fn(
		(
			_file: string,
			args: string[],
			_opts: unknown,
			cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
		) => {
			if (Array.isArray(args) && args.includes("-encoders")) {
				cb(null, { stdout: childProcessMocks.encoderNames, stderr: "" });
			} else {
				cb(null, { stdout: "", stderr: "" });
			}
		},
	),
	spawn: vi.fn((_file: string, args: string[]) => {
		let encoder = "";
		const codecIndex = args.indexOf("-c:v");
		if (codecIndex >= 0) {
			encoder = args[codecIndex + 1];
		}
		const exitCode = childProcessMocks.failingEncoders.has(encoder) ? 1 : 0;
		return {
			stdin: {
				end: vi.fn(() => undefined),
				destroy: vi.fn(),
				destroyed: false,
				writableEnded: false,
			},
			stderr: { on: vi.fn() },
			on: vi.fn((event: string, cb: (code: number) => void) => {
				if (event === "close") {
					setTimeout(() => cb(exitCode), 0);
				}
			}),
			kill: vi.fn(),
		};
	}),
}));

vi.mock("electron", () => ({
	app: {
		getAppPath: vi.fn(() => process.cwd()),
		getGPUInfo: vi.fn(async () => ({ gpuDevice: [] })),
		getPath: vi.fn(() => process.env.TEMP ?? process.cwd()),
		isPackaged: false,
	},
	powerSaveBlocker: {
		start: vi.fn(() => 1),
		isStarted: vi.fn(() => false),
		stop: vi.fn(),
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: vi.fn(() => "ffmpeg"),
	getFfprobeBinaryPath: vi.fn(() => "ffprobe"),
}));

vi.mock("node:child_process", () => ({
	execFile: childProcessMocks.execFile,
	spawn: childProcessMocks.spawn,
}));

import { resolveNativeVideoEncoder } from "./export/native-video";
// Use the real in-memory state module so we can seed/read the native encoder
// cache through its real setter for the cache-identity tests below.
import { setCachedNativeVideoEncoder } from "./state";

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

	it("selects HEVC NVENC without changing the CUDA filtergraph", () => {
		const args = buildNativeCudaOverlayStaticLayoutArgs({
			...baseConfig,
			videoCodec: "hevc",
		});

		expect(args).toContain("hevc_nvenc");
		expect(args).not.toContain("h264_nvenc");
		expect(args).toEqual(
			expect.arrayContaining([expect.stringContaining("overlay_cuda=192:108")]),
		);
	});

	it("adds sorted transparent RGBA overlay inputs to the CUDA filtergraph", () => {
		const args = buildNativeCudaOverlayStaticLayoutArgs({
			...baseConfig,
			overlayLayers: [
				{
					id: "caption",
					order: 2,
					path: "caption.rgba",
					x: 0,
					y: 800,
					width: 1920,
					height: 280,
					frameRate: 60,
					durationSec: 60,
					frameCount: 3600,
					pixelFormat: "rgba",
				},
				{
					id: "cursor",
					order: 1,
					path: "cursor.rgba",
					x: 0,
					y: 0,
					width: 1920,
					height: 1080,
					frameRate: 60,
					durationSec: 60,
					frameCount: 3600,
					pixelFormat: "rgba",
				},
			],
		});
		const filter = args[args.indexOf("-filter_complex") + 1];

		expect(args).toEqual(
			expect.arrayContaining(["-f", "rawvideo", "cursor.rgba", "caption.rgba"]),
		);
		expect(filter).toContain("[1:v]format=rgba[overlay_0]");
		expect(filter).toContain("overlay=0:0");
		expect(filter).toContain("[2:v]format=rgba[overlay_1]");
		expect(filter).toContain("overlay=0:800");
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

	it("preserves overlay layers in the precomposited CPU composition branch", () => {
		const args = buildNativePrecompositedStaticLayoutArgs({
			...baseConfig,
			staticBackgroundPath: "background.png",
			overlayLayers: [
				{
					id: "effects",
					order: 0,
					path: "effects.rgba",
					x: 0,
					y: 0,
					width: 1920,
					height: 1080,
					frameRate: 60,
					durationSec: 60,
					frameCount: 3600,
					pixelFormat: "rgba",
				},
			],
		});
		const filterComplex = args[args.indexOf("-filter_complex") + 1];

		expect(args).toEqual(expect.arrayContaining(["-f", "rawvideo", "effects.rgba"]));
		expect(filterComplex).toContain("[2:v]format=rgba[overlay_0]");
		expect(filterComplex).toContain("[layout][overlay_0]overlay=x=0:y=0:format=auto");
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

describe("getNativeEncoderCandidates", () => {
	it("orders H.265 hardware candidates highest for Auto on Windows", () => {
		expect(getNativeEncoderCandidates("hevc", "auto", "win32")).toEqual([
			"hevc_nvenc",
			"hevc_qsv",
			"hevc_amf",
			"hevc_mf",
			"libx265",
		]);
	});

	it("returns only hardware candidates for the hardware preference", () => {
		expect(getNativeEncoderCandidates("hevc", "hardware", "win32")).toEqual([
			"hevc_nvenc",
			"hevc_qsv",
			"hevc_amf",
			"hevc_mf",
		]);
		expect(getNativeEncoderCandidates("hevc", "hardware", "darwin")).toEqual([
			"hevc_videotoolbox",
		]);
		expect(getNativeEncoderCandidates("h264", "hardware", "linux")).toEqual([
			"h264_nvenc",
			"h264_qsv",
		]);
	});

	it("returns only the CPU encoder for the cpu preference", () => {
		expect(getNativeEncoderCandidates("hevc", "cpu", "linux")).toEqual(["libx265"]);
		expect(getNativeEncoderCandidates("h264", "cpu", "win32")).toEqual(["libx264"]);
	});

	it("orders H.264 Linux hardware before the CPU fallback for Auto", () => {
		expect(getNativeEncoderCandidates("h264", "auto", "linux")).toEqual([
			"h264_nvenc",
			"h264_qsv",
			"libx264",
		]);
	});

	it("maps each codec to its CPU encoder", () => {
		expect(getCpuEncoderForCodec("h264")).toBe("libx264");
		expect(getCpuEncoderForCodec("hevc")).toBe("libx265");
	});
});

describe("native raw-frame orientation", () => {
	it("keeps synthetic top and bottom rows top-down without an FFmpeg flip", async () => {
		class SyntheticVideoFrame {
			async copyTo(destination: Uint8Array): Promise<void> {
				destination.set([255, 0, 0, 255, 0, 0, 255, 255]);
			}

			close(): void {}
		}

		vi.stubGlobal("VideoFrame", SyntheticVideoFrame);
		const frame = await captureCanvasFrameForNativeExport(
			{ width: 1, height: 2 } as HTMLCanvasElement,
			0,
			true,
		);
		expect([...frame]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);

		const args = buildNativeVideoExportArgs(
			"libx264",
			{
				width: 1,
				height: 2,
				frameRate: 30,
				bitrate: 1_500_000,
				encodingMode: "fast",
				inputMode: "rawvideo",
			},
			"out.mp4",
		);
		expect(args).toEqual(expect.arrayContaining(["-f", "rawvideo", "-pix_fmt", "rgba"]));
		expect(args).not.toContain("-vf");
		expect(args).not.toContain("vflip");
	});
});

describe("buildNativeVideoExportArgs codec-aware", () => {
	const base = {
		width: 1920,
		height: 1080,
		frameRate: 60,
		bitrate: 8_000_000,
		encodingMode: "quality" as const,
	};

	it("libx265 includes bitrate, GOP, pixel format, and MP4 flags", () => {
		const args = buildNativeVideoExportArgs(
			"libx265",
			{ ...base, videoCodec: "hevc", encoderPreference: "cpu" },
			"out.mp4",
		);
		expect(args[args.indexOf("-c:v") + 1]).toBe("libx265");
		expect(args[args.indexOf("-preset") + 1]).toBe("slow");
		expect(args[args.indexOf("-g") + 1]).toBe("300");
		expect(args).toContain("-b:v");
		expect(args[args.lastIndexOf("-pix_fmt") + 1]).toBe("yuv420p");
		expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
		expect(args).toContain("out.mp4");
	});

	it("hevc_nvenc includes bitrate, GOP, pixel format, and MP4 flags", () => {
		const args = buildNativeVideoExportArgs(
			"hevc_nvenc",
			{ ...base, videoCodec: "hevc", encoderPreference: "hardware" },
			"out.mp4",
		);
		expect(args[args.indexOf("-c:v") + 1]).toBe("hevc_nvenc");
		expect(args).toContain("-preset");
		expect(args[args.indexOf("-g") + 1]).toBe("300");
		expect(args).toContain("-b:v");
		expect(args[args.lastIndexOf("-pix_fmt") + 1]).toBe("yuv420p");
		expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
		expect(args).toContain("out.mp4");
	});

	it("libx264 CPU keeps its existing preset tuning", () => {
		const args = buildNativeVideoExportArgs(
			"libx264",
			{ ...base, videoCodec: "h264", encoderPreference: "cpu" },
			"out.mp4",
		);
		expect(args[args.indexOf("-preset") + 1]).toBe("slow");
		// quality mode => -preset slow on libx264 (no -tune for quality).
		expect(args).toContain("-preset");
	});
});

describe("resolveNativeVideoEncoder", () => {
	const encoderListing = (...names: string[]) =>
		names.map((name) => `  V....D ${name}  ffmpeg-${name} encoder\r\n`).join("");

	beforeEach(() => {
		childProcessMocks.execFile.mockClear();
		childProcessMocks.spawn.mockClear();
		childProcessMocks.failingEncoders = new Set<string>();
		setCachedNativeVideoEncoder(null);
		childProcessMocks.encoderNames = encoderListing("libx264", "libx265");
	});

	it("resolves H.264 CPU to libx264", async () => {
		childProcessMocks.encoderNames = encoderListing("libx264");
		await expect(resolveNativeVideoEncoder("ffmpeg", "balanced", "h264", "cpu")).resolves.toBe(
			"libx264",
		);
		const probeArgs = childProcessMocks.spawn.mock.calls[0]?.[1] as string[];
		expect(probeArgs).toContain("libx264");
	});

	it("resolves HEVC CPU to libx265", async () => {
		childProcessMocks.encoderNames = encoderListing("libx265");
		await expect(resolveNativeVideoEncoder("ffmpeg", "balanced", "hevc", "cpu")).resolves.toBe(
			"libx265",
		);
		const probeArgs = childProcessMocks.spawn.mock.calls[0]?.[1] as string[];
		expect(probeArgs).toContain("libx265");
	});

	it("auto falls back from a failing hardware encoder to CPU", async () => {
		const hardware = getNativeEncoderCandidates("hevc", "hardware", process.platform);
		childProcessMocks.encoderNames = encoderListing(...hardware, "libx265");
		childProcessMocks.failingEncoders = new Set(hardware);
		await expect(resolveNativeVideoEncoder("ffmpeg", "balanced", "hevc", "auto")).resolves.toBe(
			"libx265",
		);
	});

	it("hardware-only does not silently fall back to CPU", async () => {
		const hardware = getNativeEncoderCandidates("hevc", "hardware", process.platform);
		childProcessMocks.encoderNames = encoderListing(...hardware, "libx265");
		childProcessMocks.failingEncoders = new Set(hardware);
		await expect(
			resolveNativeVideoEncoder("ffmpeg", "balanced", "hevc", "hardware"),
		).rejects.toThrow(/hardware/i);
		const probedEncoders = (
			childProcessMocks.spawn.mock.calls as Array<[string, string[]]>
		).map(([, args]) => args[args.indexOf("-c:v") + 1]);
		expect(probedEncoders).not.toContain("libx265");
	});

	it("errors when no available hardware encoder can be probed", async () => {
		childProcessMocks.encoderNames = encoderListing("libx265");
		await expect(
			resolveNativeVideoEncoder("ffmpeg", "balanced", "hevc", "hardware"),
		).rejects.toThrow(/hardware/i);
		expect(childProcessMocks.spawn).not.toHaveBeenCalled();
	});

	it("includes codec and preference in the cache identity", async () => {
		// Seed the cache with an H.264/auto entry via the real state setter.
		setCachedNativeVideoEncoder({
			ffmpegPath: "ffmpeg",
			encodingMode: "balanced",
			codec: "h264",
			preference: "auto",
			encoderName: "libx264",
		});
		await expect(resolveNativeVideoEncoder("ffmpeg", "balanced", "h264", "auto")).resolves.toBe(
			"libx264",
		);
		expect(childProcessMocks.execFile).not.toHaveBeenCalled();
		expect(childProcessMocks.spawn).not.toHaveBeenCalled();

		// A different codec must not reuse the cached H.264/auto entry.
		setCachedNativeVideoEncoder(null);
		childProcessMocks.encoderNames = encoderListing("libx265");
		await expect(resolveNativeVideoEncoder("ffmpeg", "balanced", "hevc", "auto")).resolves.toBe(
			"libx265",
		);

		// A different preference must not collide with the cached H.264/auto entry.
		setCachedNativeVideoEncoder({
			ffmpegPath: "ffmpeg",
			encodingMode: "balanced",
			codec: "h264",
			preference: "auto",
			encoderName: "libx264",
		});
		childProcessMocks.encoderNames = encoderListing("libx264");
		await expect(resolveNativeVideoEncoder("ffmpeg", "balanced", "h264", "cpu")).resolves.toBe(
			"libx264",
		);
		expect(childProcessMocks.execFile).toHaveBeenCalled();
	});
});
