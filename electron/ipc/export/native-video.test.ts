import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getAppPath: vi.fn(() => process.cwd()),
		getGPUInfo: vi.fn(async () => ({ gpuDevice: [] })),
		getPath: vi.fn(() => process.env.TEMP ?? process.cwd()),
		isPackaged: false,
	},
}));

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: vi.fn(() => "ffmpeg"),
	getFfprobeBinaryPath: vi.fn(() => "ffprobe"),
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

import { app } from "electron";
import {
	buildExperimentalNvidiaCudaStaticLayoutArgs,
	buildExperimentalWindowsGpuStaticLayoutArgs,
	buildNativeStaticLayoutSourceProxyArgs,
	buildNativeStaticLayoutTimelineSegments,
	buildNativeVideoAudioMuxArgs,
	canCopyAudioCodecIntoMp4,
	getExperimentalNvidiaCudaExportSkipReason,
	getNativeGpuCompositorStallTimeoutMs,
	getNativeStaticLayoutSourceProxyBitrate,
	getNvidiaCudaAudioExportSkipReason,
	getNvidiaCudaAutoStallTimeoutMs,
	hasNativeStaticLayoutProgressAdvanced,
	hasNvidiaGpuDeviceInGpuInfo,
	mapNvidiaCudaWrapperProgressPercentage,
	muxExportedVideoAudioBuffer,
	type NativeStaticLayoutExportOptions,
	normalizeNativeStaticLayoutBackground,
	parseFfmpegDurationSeconds,
	parseFfmpegFrameRate,
	parseFfmpegProgressLineSeconds,
	parseNativeVideoMetadataProbeOutput,
	parseNativeVideoStreamStatsProbeOutput,
	parseNvidiaCudaExportSummary,
	parseWindowsGpuExportProgressLine,
	parseWindowsGpuExportSummary,
	resolveExperimentalNvidiaCudaExportScriptPath,
	shouldCreateNativeStaticLayoutSourceProxy,
	validateNativeStaticLayoutSourceProxyMetadata,
	validateNativeVideoStreamStats,
	validateNvidiaCudaExportSummary,
	validateWindowsGpuExportSummary,
} from "./native-video";

const electronAppMock = app as unknown as {
	getAppPath: ReturnType<typeof vi.fn>;
	getGPUInfo: ReturnType<typeof vi.fn>;
	isPackaged: boolean;
};

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

function resetFsAccessMock() {
	fsMocks.access.mockImplementation(async () => {
		throw new Error("missing");
	});
}

function createNvidiaCudaSkipOptions(
	overrides: Partial<NativeStaticLayoutExportOptions> = {},
): NativeStaticLayoutExportOptions {
	return {
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
		experimentalWindowsGpuCompositor: true,
		...overrides,
	};
}

async function withPackagedCudaCandidate<T>(gpuInfo: unknown, callback: () => Promise<T>) {
	const envName = "RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT";
	const originalEnv = process.env[envName];
	const originalIsPackaged = electronAppMock.isPackaged;
	electronAppMock.isPackaged = true;
	electronAppMock.getGPUInfo.mockResolvedValue(gpuInfo);
	fsMocks.access.mockResolvedValue(undefined);
	delete process.env[envName];

	try {
		return await callback();
	} finally {
		if (originalEnv === undefined) {
			delete process.env[envName];
		} else {
			process.env[envName] = originalEnv;
		}
		electronAppMock.isPackaged = originalIsPackaged;
		electronAppMock.getGPUInfo.mockReset();
		electronAppMock.getGPUInfo.mockResolvedValue({ gpuDevice: [] });
		resetFsAccessMock();
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

describe("native static-layout source proxy", () => {
	const h264Metadata = {
		width: 1920,
		height: 1080,
		duration: 45,
		frameRate: 30,
		codec: "h264 (High)",
		hasAudio: true,
		audioCodec: "aac",
	};

	it("proxies non-H.264 codecs and non-MP4-like containers", () => {
		expect(shouldCreateNativeStaticLayoutSourceProxy(h264Metadata, "recording.mp4")).toBe(
			false,
		);
		expect(shouldCreateNativeStaticLayoutSourceProxy(h264Metadata, "recording.webm")).toBe(
			true,
		);
		expect(
			shouldCreateNativeStaticLayoutSourceProxy(
				{ ...h264Metadata, codec: "vp9 (Profile 0)" },
				"recording.webm",
			),
		).toBe(true);
	});

	it("builds a CFR H.264 MP4 proxy at visually safe bitrate", () => {
		const options = createNvidiaCudaSkipOptions({
			inputPath: "recording.webm",
			bitrate: 22_000_000,
			durationSec: 30,
		});
		const metadata = {
			...h264Metadata,
			codec: "vp9 (Profile 0)",
			audioCodec: "opus",
			duration: 45.036,
			streamDuration: 45.036,
		};
		const args = buildNativeStaticLayoutSourceProxyArgs(options, "source-proxy.mp4", metadata);

		expect(args).toEqual(
			expect.arrayContaining([
				"-i",
				"recording.webm",
				"-an",
				"-t",
				"45.036",
				"-c:v",
				"libx264",
				"-preset",
				"veryfast",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"+faststart",
				"source-proxy.mp4",
			]),
		);
		expect(args).toEqual(
			expect.arrayContaining([
				"-vf",
				"fps=fps=30:start_time=0,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p,setpts=PTS-STARTPTS",
			]),
		);
		expect(getNativeStaticLayoutSourceProxyBitrate(options, metadata)).toBeGreaterThan(
			options.bitrate,
		);
	});

	it("validates proxy codec and duration before native composition", () => {
		expect(
			validateNativeStaticLayoutSourceProxyMetadata(
				{ ...h264Metadata, codec: "vp9", duration: 45 },
				{ sourceDurationSec: 45 },
			),
		).toEqual(["proxy codec is not H.264/AVC: vp9"]);
		expect(
			validateNativeStaticLayoutSourceProxyMetadata(
				{ ...h264Metadata, duration: 10 },
				{ sourceDurationSec: 45 },
			),
		).toEqual(["proxy duration 10.000s shorter than expected 45.000s"]);
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

	it("allows validated fallback candidates to try CUDA audio exports", () => {
		withNvidiaCudaAudioOverride(undefined, () => {
			expect(
				getNvidiaCudaAudioExportSkipReason("copy-source", {
					allowValidatedFallbackCandidate: true,
				}),
			).toBeNull();
		});
	});
});

describe("getNvidiaCudaAutoStallTimeoutMs", () => {
	it("only applies the stall guard to packaged auto candidates by default", () => {
		expect(getNvidiaCudaAutoStallTimeoutMs(false)).toBeNull();
		expect(getNvidiaCudaAutoStallTimeoutMs(true)).toBe(120_000);
	});

	it("allows the CUDA auto stall guard to be disabled or tuned", () => {
		const envName = "RECORDLY_NVIDIA_CUDA_AUTO_STALL_TIMEOUT_MS";
		const originalValue = process.env[envName];

		try {
			process.env[envName] = "0";
			expect(getNvidiaCudaAutoStallTimeoutMs(true)).toBeNull();

			process.env[envName] = "5000";
			expect(getNvidiaCudaAutoStallTimeoutMs(true)).toBe(10_000);

			process.env[envName] = "45000";
			expect(getNvidiaCudaAutoStallTimeoutMs(true)).toBe(45_000);
		} finally {
			if (originalValue === undefined) {
				delete process.env[envName];
			} else {
				process.env[envName] = originalValue;
			}
		}
	});
});

describe("getNativeGpuCompositorStallTimeoutMs", () => {
	it("guards Windows GPU compositor stalls by default", () => {
		expect(getNativeGpuCompositorStallTimeoutMs()).toBe(120_000);
	});

	it("allows the Windows GPU stall guard to be disabled or tuned", () => {
		const envName = "RECORDLY_NATIVE_GPU_STALL_TIMEOUT_MS";
		const originalValue = process.env[envName];

		try {
			process.env[envName] = "0";
			expect(getNativeGpuCompositorStallTimeoutMs()).toBeNull();

			process.env[envName] = "5000";
			expect(getNativeGpuCompositorStallTimeoutMs()).toBe(10_000);

			process.env[envName] = "45000";
			expect(getNativeGpuCompositorStallTimeoutMs()).toBe(45_000);
		} finally {
			if (originalValue === undefined) {
				delete process.env[envName];
			} else {
				process.env[envName] = originalValue;
			}
		}
	});
});

describe("hasNvidiaGpuDeviceInGpuInfo", () => {
	it("detects NVIDIA GPUs by vendor id or device strings", () => {
		expect(
			hasNvidiaGpuDeviceInGpuInfo({
				gpuDevice: [{ active: false, vendorId: 0x10de, deviceId: 0x1f91 }],
			}),
		).toBe(true);
		expect(
			hasNvidiaGpuDeviceInGpuInfo({
				gpuDevice: [{ vendorString: "NVIDIA Corporation" }],
			}),
		).toBe(true);
		expect(
			hasNvidiaGpuDeviceInGpuInfo({
				gpuDevice: [{ deviceString: "NVIDIA GeForce GTX 1650" }],
			}),
		).toBe(true);
	});

	it("rejects non-NVIDIA and malformed GPU info", () => {
		expect(
			hasNvidiaGpuDeviceInGpuInfo({
				gpuDevice: [
					{ vendorId: 0x1002, deviceString: "AMD Radeon" },
					{ vendorId: 0x8086, deviceString: "Intel UHD Graphics" },
				],
			}),
		).toBe(false);
		expect(hasNvidiaGpuDeviceInGpuInfo({})).toBe(false);
		expect(hasNvidiaGpuDeviceInGpuInfo(null)).toBe(false);
	});
});

describe("getExperimentalNvidiaCudaExportSkipReason", () => {
	it("auto-enables packaged CUDA candidates when the helper and an NVIDIA GPU are present", async () => {
		const reason = await withPackagedCudaCandidate(
			{ gpuDevice: [{ vendorId: 0x10de, deviceString: "NVIDIA GeForce GTX 1650" }] },
			() =>
				getExperimentalNvidiaCudaExportSkipReason(
					createNvidiaCudaSkipOptions({
						audioOptions: { audioMode: "copy-source", audioSourcePath: "input.mp4" },
					}),
				),
		);

		expect(reason).toBe(process.platform === "win32" ? null : "not-windows");
	});

	it("allows explicit lab CUDA audio exports when forced onto the shared mux path", async () => {
		const exportEnvName = "RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT";
		const forceEnvName = "RECORDLY_NVIDIA_CUDA_FORCE_VIDEO_ONLY";
		const allowAudioEnvName = "RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT";
		const originalExportEnv = process.env[exportEnvName];
		const originalForceEnv = process.env[forceEnvName];
		const originalAllowAudioEnv = process.env[allowAudioEnvName];
		process.env[exportEnvName] = "1";
		process.env[forceEnvName] = "1";
		delete process.env[allowAudioEnvName];

		try {
			const reason = await getExperimentalNvidiaCudaExportSkipReason(
				createNvidiaCudaSkipOptions({
					audioOptions: { audioMode: "copy-source", audioSourcePath: "input.mp4" },
				}),
			);

			expect(reason).toBe(process.platform === "win32" ? null : "not-windows");
		} finally {
			if (originalExportEnv === undefined) {
				delete process.env[exportEnvName];
			} else {
				process.env[exportEnvName] = originalExportEnv;
			}
			if (originalForceEnv === undefined) {
				delete process.env[forceEnvName];
			} else {
				process.env[forceEnvName] = originalForceEnv;
			}
			if (originalAllowAudioEnv === undefined) {
				delete process.env[allowAudioEnvName];
			} else {
				process.env[allowAudioEnvName] = originalAllowAudioEnv;
			}
		}
	});

	it("skips packaged CUDA auto-candidates when Electron reports no NVIDIA GPU", async () => {
		const reason = await withPackagedCudaCandidate(
			{ gpuDevice: [{ vendorId: 0x8086, deviceString: "Intel UHD Graphics" }] },
			() => getExperimentalNvidiaCudaExportSkipReason(createNvidiaCudaSkipOptions()),
		);

		expect(reason).toBe(
			process.platform === "win32" ? "nvidia-gpu-unavailable" : "not-windows",
		);
	});

	it("lets the packaged auto-candidate be explicitly disabled", async () => {
		const reason = await withPackagedCudaCandidate(
			{ gpuDevice: [{ vendorId: 0x10de, deviceString: "NVIDIA GeForce GTX 1650" }] },
			async () => {
				process.env.RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT = "0";
				return getExperimentalNvidiaCudaExportSkipReason(createNvidiaCudaSkipOptions());
			},
		);

		expect(reason).toBe(process.platform === "win32" ? "env-disabled" : "not-windows");
	});
});

describe("resolveExperimentalNvidiaCudaExportScriptPath", () => {
	it("prefers the packaged app.asar.unpacked CUDA wrapper over the virtual app.asar copy", async () => {
		const envName = "RECORDLY_NVIDIA_CUDA_EXPORT_SCRIPT";
		const originalEnv = process.env[envName];
		const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
		delete process.env[envName];

		try {
			if (process.platform !== "win32") {
				expect(await resolveExperimentalNvidiaCudaExportScriptPath()).toBeNull();
				return;
			}

			const resourcesPath = "C:\\Recordly\\resources";
			const unpackedScriptPath =
				"C:\\Recordly\\resources\\app.asar.unpacked\\electron\\native\\nvidia-cuda-compositor\\run-mp4-pipeline.mjs";
			const asarScriptPath =
				"C:\\Recordly\\resources\\app.asar\\electron\\native\\nvidia-cuda-compositor\\run-mp4-pipeline.mjs";
			Object.defineProperty(process, "resourcesPath", {
				configurable: true,
				value: resourcesPath,
			});
			electronAppMock.getAppPath.mockReturnValue("C:\\Recordly\\resources\\app.asar");
			fsMocks.access.mockImplementation(async (candidate: string) => {
				if (candidate === unpackedScriptPath || candidate === asarScriptPath) {
					return;
				}
				throw new Error(`missing ${candidate}`);
			});

			expect(await resolveExperimentalNvidiaCudaExportScriptPath()).toBe(unpackedScriptPath);
		} finally {
			if (originalEnv === undefined) {
				delete process.env[envName];
			} else {
				process.env[envName] = originalEnv;
			}
			if (originalResourcesPath) {
				Object.defineProperty(process, "resourcesPath", originalResourcesPath);
			} else {
				delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
			}
			electronAppMock.getAppPath.mockReset();
			electronAppMock.getAppPath.mockReturnValue(process.cwd());
			resetFsAccessMock();
		}
	});
});

describe("buildExperimentalNvidiaCudaStaticLayoutArgs", () => {
	it("keeps explicit copy-source CUDA audio inline by default", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				audioOptions: { audioMode: "copy-source", audioSourcePath: "input.mp4" },
			}),
			"output.mp4",
			"work",
		);

		expect(args).not.toContain("--video-only");
	});

	it("forces packaged auto CUDA candidates onto the shared audio mux path", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				audioOptions: { audioMode: "copy-source", audioSourcePath: "input.mp4" },
				nvidiaCudaForceVideoOnly: true,
			}),
			"output.mp4",
			"work",
		);

		expect(args).toContain("--video-only");
	});

	it("passes native timeline maps to the CUDA wrapper", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				timelineMapPath: "timeline-map.csv",
				timelineSegments: [
					{
						sourceStartMs: 0,
						sourceEndMs: 6_000,
						outputStartMs: 0,
						outputEndMs: 4_000,
						speed: 1.5,
					},
				],
			}),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(expect.arrayContaining(["--timeline-map", "timeline-map.csv"]));
	});

	it("passes background blur to the CUDA wrapper", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				backgroundImagePath: "wallpaper.jpg",
				backgroundBlurPx: 36,
			}),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(expect.arrayContaining(["--background-blur", "36"]));
	});

	it("passes the export encoding mode to the CUDA wrapper", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				encodingMode: "quality",
			}),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(expect.arrayContaining(["--encoding-mode", "quality"]));
	});

	it("passes webcam source-time controls to the CUDA wrapper", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				webcamInputPath: "webcam.mp4",
				webcamLeft: 32,
				webcamTop: 48,
				webcamSize: 240,
				webcamRadius: 18,
				webcamTimeOffsetMs: -125.5,
			}),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(
			expect.arrayContaining([
				"--webcam-input",
				"webcam.mp4",
				"--webcam-time-offset-ms",
				"-125.5",
				"--webcam-stream",
			]),
		);
	});

	it("passes cursor telemetry and atlas assets to the CUDA wrapper", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				cursorTelemetryPath: "cursor-telemetry.json",
				cursorSize: 96,
				cursorAtlasPath: "cursor-atlas.png",
				cursorAtlasMetadataPath: "cursor-atlas.tsv",
			}),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(
			expect.arrayContaining([
				"--cursor-json",
				"cursor-telemetry.json",
				"--cursor-height",
				"96",
				"--cursor-style",
				"external",
				"--cursor-atlas-png",
				"cursor-atlas.png",
				"--cursor-atlas-metadata",
				"cursor-atlas.tsv",
			]),
		);
	});
});

describe("buildExperimentalWindowsGpuStaticLayoutArgs", () => {
	it("passes background blur to the D3D11 compositor", () => {
		const args = buildExperimentalWindowsGpuStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				backgroundImagePath: "wallpaper.jpg",
				backgroundBlurPx: 36,
			}),
			"output.mp4",
		);

		expect(args).toEqual(expect.arrayContaining(["--background-blur", "36"]));
	});
});

describe("buildNativeStaticLayoutTimelineSegments", () => {
	it("derives contiguous output timeline ranges from edited-track source segments", () => {
		expect(
			buildNativeStaticLayoutTimelineSegments([
				{ startMs: 0, endMs: 2_000, speed: 1 },
				{ startMs: 2_000, endMs: 8_000, speed: 1.5 },
				{ startMs: 8_000, endMs: 10_000, speed: 0.5 },
			]),
		).toEqual([
			{
				sourceStartMs: 0,
				sourceEndMs: 2_000,
				outputStartMs: 0,
				outputEndMs: 2_000,
				speed: 1,
			},
			{
				sourceStartMs: 2_000,
				sourceEndMs: 8_000,
				outputStartMs: 2_000,
				outputEndMs: 6_000,
				speed: 1.5,
			},
			{
				sourceStartMs: 8_000,
				sourceEndMs: 10_000,
				outputStartMs: 6_000,
				outputEndMs: 10_000,
				speed: 0.5,
			},
		]);
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
			audioSourceCodec: "aac (LC) (mp4a / 0x6134706D)",
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
			audioSourceCodec: "aac",
		});

		expect(args).toEqual(expect.arrayContaining(["-c:a", "copy"]));
		expect(args).not.toContain("-shortest");
	});

	it("transcodes WebM/Opus source audio when muxing into MP4", () => {
		const args = buildNativeVideoAudioMuxArgs("video.mp4", "source.webm", "out.mp4", {
			audioMode: "copy-source",
			audioSourceCodec: "opus",
			outputDurationSec: 60,
		});

		expect(args).toEqual(expect.arrayContaining(["-c:a", "aac", "-b:a", "192k"]));
		expect(args.join(";")).not.toContain("-c:a;copy");
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

	it("pads and trims edited-track filtergraph audio to the expected duration", () => {
		const args = buildNativeVideoAudioMuxArgs("video.mp4", "source.mp4", "out.mp4", {
			audioMode: "edited-track",
			editedTrackStrategy: "filtergraph-fast-path",
			audioSourceSampleRate: 48_000,
			editedTrackSegments: [{ startMs: 0, endMs: 4_000, speed: 0.5 }],
			outputDurationSec: 8,
		});

		expect(args).toEqual(expect.arrayContaining(["-map", "[aout_sync]"]));
		expect(args.join(";")).toContain(
			"[aout]apad,atrim=duration=8.000,asetpts=PTS-STARTPTS[aout_sync]",
		);
	});

	it("can enable machine-readable FFmpeg mux progress", () => {
		const args = buildNativeVideoAudioMuxArgs(
			"video.mp4",
			"source.mp4",
			"out.mp4",
			{ audioMode: "copy-source", audioSourceCodec: "aac", outputDurationSec: 60 },
			{ progressPipe: 2 },
		);

		expect(args).toEqual(
			expect.arrayContaining(["-stats_period", "0.5", "-progress", "pipe:2", "-nostats"]),
		);
	});
});

describe("canCopyAudioCodecIntoMp4", () => {
	it("allows common MP4-compatible audio codecs", () => {
		expect(canCopyAudioCodecIntoMp4("aac (LC) (mp4a / 0x6134706D)")).toBe(true);
		expect(canCopyAudioCodecIntoMp4("mp3")).toBe(true);
	});

	it("blocks Opus so native exports transcode it to AAC for MP4", () => {
		expect(canCopyAudioCodecIntoMp4("opus")).toBe(false);
	});
});

describe("validateNativeVideoStreamStats", () => {
	it("accepts a complete video stream", () => {
		expect(
			validateNativeVideoStreamStats(
				{ durationSec: 45, frameCount: 1350, frameRate: 30 },
				{ durationSec: 45, targetFrames: 1350 },
			),
		).toEqual([]);
	});

	it("rejects files with container duration but too few video frames", () => {
		expect(
			validateNativeVideoStreamStats(
				{ durationSec: 0.067, frameCount: 2, frameRate: 30 },
				{ durationSec: 45, targetFrames: 1350 },
			),
		).toEqual([
			"video frames 2 below expected minimum 1282",
			"video stream duration 0.067s differs from expected 45.000s",
		]);
	});
});

describe("parseNativeVideoStreamStatsProbeOutput", () => {
	it("parses FFprobe count-frame JSON output", () => {
		expect(
			parseNativeVideoStreamStatsProbeOutput(
				JSON.stringify({
					streams: [
						{
							duration: "44.999000",
							nb_read_frames: "1349",
							avg_frame_rate: "30000/1001",
						},
					],
				}),
			),
		).toEqual({
			durationSec: 44.999,
			frameCount: 1349,
			frameRate: 30000 / 1001,
		});
	});
});

describe("parseFfmpegProgressLineSeconds", () => {
	it("parses FFmpeg progress timestamps into seconds", () => {
		expect(parseFfmpegProgressLineSeconds("out_time_us=1500000")).toBe(1.5);
		expect(parseFfmpegProgressLineSeconds("out_time_ms=2500000")).toBe(2.5);
		expect(parseFfmpegProgressLineSeconds("out_time=00:01:02.500000")).toBe(62.5);
		expect(parseFfmpegProgressLineSeconds("progress=continue")).toBeNull();
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

describe("validateWindowsGpuExportSummary", () => {
	it("rejects short Windows GPU outputs before muxing audio", () => {
		expect(
			validateWindowsGpuExportSummary(
				{ success: true, frames: 2, seconds: 0.067 },
				{ durationSec: 45, targetFrames: 1350 },
			),
		).toEqual([
			"Windows GPU frames 2 below expected minimum 1282",
			"Windows GPU duration 0.067s differs from expected 45.000s",
		]);
	});

	it("accepts complete Windows GPU outputs within tolerance", () => {
		expect(
			validateWindowsGpuExportSummary(
				{ success: true, frames: 1345, seconds: 44.9 },
				{ durationSec: 45, targetFrames: 1350 },
			),
		).toEqual([]);
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

		expect(issues).toEqual(["CUDA timeline mode is not timestamp-aligned for audio export"]);
	});

	it("accepts video-only CUDA output when audio is muxed by the shared export path", () => {
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
			},
			{ durationSec: 10, targetFrames: 300, requiresTimelineSync: false },
		);

		expect(issues).toEqual([]);
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
				'PROGRESS {"currentFrame":30,"totalFrames":60,"percentage":50,"averageFps":240.5,"instantFps":180.25,"intervalMs":166.4,"intervalFrames":30,"intervalEncodeMs":120.2,"intervalPipelineWaitMs":46.2,"intervalMonolithicCompositeFrames":0,"stage":"finalizing"}',
			),
		).toEqual({
			currentFrame: 30,
			totalFrames: 60,
			percentage: 50,
			stage: "finalizing",
			averageFps: 240.5,
			instantFps: 180.25,
			intervalMs: 166.4,
			intervalFrames: 30,
			intervalEncodeMs: 120.2,
			intervalPipelineWaitMs: 46.2,
			intervalMonolithicCompositeFrames: 0,
		});
	});

	it("preserves CUDA preparation progress as a non-rendering stage", () => {
		expect(
			parseWindowsGpuExportProgressLine(
				'PROGRESS {"currentFrame":0,"totalFrames":100,"percentage":2.5,"stage":"preparing"}',
			),
		).toEqual({
			currentFrame: 0,
			totalFrames: 100,
			percentage: 2.5,
			stage: "preparing",
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

describe("mapNvidiaCudaWrapperProgressPercentage", () => {
	it("keeps preflight progress and maps native encode into the main export span", () => {
		expect(
			mapNvidiaCudaWrapperProgressPercentage({
				currentFrame: 0,
				totalFrames: 100,
				percentage: 2.5,
			}),
		).toBe(2.5);
		expect(
			mapNvidiaCudaWrapperProgressPercentage({
				currentFrame: 0,
				totalFrames: 100,
				percentage: 0,
			}),
		).toBe(3);
		expect(
			mapNvidiaCudaWrapperProgressPercentage({
				currentFrame: 50,
				totalFrames: 100,
				percentage: 50,
			}),
		).toBe(50.5);
		expect(
			mapNvidiaCudaWrapperProgressPercentage({
				currentFrame: 100,
				totalFrames: 100,
				percentage: 100,
			}),
		).toBe(98);
		expect(
			mapNvidiaCudaWrapperProgressPercentage({
				currentFrame: 100,
				totalFrames: 100,
				percentage: 97.25,
				stage: "finalizing",
			}),
		).toBe(97.25);
	});
});

describe("hasNativeStaticLayoutProgressAdvanced", () => {
	it("treats repeated preparation heartbeats as stalled until real progress arrives", () => {
		const previous = { currentFrame: 0, percentage: 2.5 };

		expect(
			hasNativeStaticLayoutProgressAdvanced(
				{ currentFrame: 0, totalFrames: 100, percentage: 2.5, stage: "preparing" },
				previous,
			),
		).toBe(false);
		expect(
			hasNativeStaticLayoutProgressAdvanced(
				{ currentFrame: 0, totalFrames: 100, percentage: 2.7, stage: "preparing" },
				previous,
			),
		).toBe(true);
		expect(
			hasNativeStaticLayoutProgressAdvanced(
				{ currentFrame: 1, totalFrames: 100, percentage: 2.5 },
				previous,
			),
		).toBe(true);
		expect(
			hasNativeStaticLayoutProgressAdvanced(
				{ currentFrame: 100, totalFrames: 100, percentage: 97.25, stage: "finalizing" },
				{ currentFrame: 100, percentage: 97.25 },
			),
		).toBe(true);
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
