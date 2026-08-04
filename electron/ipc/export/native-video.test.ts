import { afterEach, describe, expect, it, vi } from "vitest";

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
import type { NativeTiledOverlayLayerDescriptor } from "../../../src/lib/exporter/nativeStaticLayoutOverlays";
import {
	buildExperimentalNvidiaCudaStaticLayoutArgs,
	buildExperimentalWindowsGpuStaticLayoutArgs,
	buildNativeStaticLayoutOverlayManifest,
	buildNativeStaticLayoutSourceProxyArgs,
	buildNativeStaticLayoutTiledOverlayManifest,
	buildNativeStaticLayoutTimelineSegments,
	buildNativeVideoAudioMuxArgs,
	canCopyAudioCodecIntoMp4,
	exportNativeStaticLayoutVideo,
	formatNativeStaticLayoutZoomTelemetryLines,
	getExperimentalNvidiaCudaExportSkipReason,
	getNativeExportCapabilities,
	getNativeGpuCompositorStallTimeoutMs,
	getNativeStaticLayoutOverlayExpectedSidecarBytes,
	getNativeStaticLayoutRawFrameFallbackReason,
	getNativeStaticLayoutSourceProxyBitrate,
	getNvidiaCudaAudioExportSkipReason,
	getNvidiaCudaAutoStallTimeoutMs,
	hasNativeStaticLayoutProgressAdvanced,
	hasNvidiaGpuDeviceInGpuInfo,
	mapNvidiaCudaWrapperProgressPercentage,
	muxExportedVideoAudioBuffer,
	type NativeStaticLayoutExportOptions,
	type NativeStaticLayoutOverlayLayer,
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
	resolveNativeStaticLayoutFpsFields,
	resolveNvidiaCudaCursorAssets,
	resolveNvidiaCudaNativeFps,
	resolveNvidiaCudaNativeSummaryMetrics,
	resolveNvidiaCudaOverlaySidecarSummaryMetrics,
	resolveNvidiaCudaTiledOverlaySidecarSummaryMetrics,
	shouldCreateNativeStaticLayoutSourceProxy,
	validateNativeStaticLayoutSourceProxyMetadata,
	validateNativeVideoStreamStats,
	validateNvidiaCudaExportSummary,
	validateNvidiaCudaStageMetricInvariants,
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
	it("only applies the stall guard to active validated CUDA candidates by default", () => {
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

describe("getNativeExportCapabilities", () => {
	it("reports NVIDIA CUDA availability when the wrapper and an NVIDIA GPU are present", async () => {
		const capabilities = await withPackagedCudaCandidate(
			{ gpuDevice: [{ vendorId: 0x10de, deviceString: "NVIDIA GeForce GTX 1650" }] },
			() => getNativeExportCapabilities(),
		);

		expect(capabilities.nvidiaCuda.available).toBe(process.platform === "win32");
		expect(capabilities.nvidiaCuda.hasWrapper).toBe(process.platform === "win32");
		expect(capabilities.nvidiaCuda.hasNvidiaGpu).toBe(
			process.platform === "win32" ? true : null,
		);
	});

	it("keeps CUDA available when the GPU probe is inconclusive so the live helper decides", async () => {
		const envName = "RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT";
		const originalEnv = process.env[envName];
		const originalIsPackaged = electronAppMock.isPackaged;
		electronAppMock.isPackaged = true;
		electronAppMock.getGPUInfo.mockRejectedValue(new Error("GPU info unavailable"));
		fsMocks.access.mockResolvedValue(undefined);
		delete process.env[envName];

		try {
			const capabilities = await getNativeExportCapabilities();
			if (process.platform === "win32") {
				expect(capabilities.nvidiaCuda.available).toBe(true);
				expect(capabilities.nvidiaCuda.hasNvidiaGpu).toBeNull();
				expect(capabilities.nvidiaCuda.skipReason).toBeNull();
			} else {
				expect(capabilities.nvidiaCuda.available).toBe(false);
				expect(capabilities.nvidiaCuda.skipReason).toBe("not-windows");
			}
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
	});
});

describe("getExperimentalNvidiaCudaExportSkipReason", () => {
	it("requires user opt-in before packaged CUDA candidates run", async () => {
		const reason = await withPackagedCudaCandidate(
			{ gpuDevice: [{ vendorId: 0x10de, deviceString: "NVIDIA GeForce GTX 1650" }] },
			() =>
				getExperimentalNvidiaCudaExportSkipReason(
					createNvidiaCudaSkipOptions({
						audioOptions: { audioMode: "copy-source", audioSourcePath: "input.mp4" },
					}),
				),
		);

		expect(reason).toBe(process.platform === "win32" ? "env-disabled" : "not-windows");
	});

	it("allows user opt-in CUDA candidates when the helper and an NVIDIA GPU are present", async () => {
		const reason = await withPackagedCudaCandidate(
			{ gpuDevice: [{ vendorId: 0x10de, deviceString: "NVIDIA GeForce GTX 1650" }] },
			() =>
				getExperimentalNvidiaCudaExportSkipReason(
					createNvidiaCudaSkipOptions({
						experimentalNvidiaCudaExport: true,
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

	it("does not use packaged auto-candidate audio bypass when CUDA is explicitly enabled", async () => {
		const exportEnvName = "RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT";
		const forceEnvName = "RECORDLY_NVIDIA_CUDA_FORCE_VIDEO_ONLY";
		const allowAudioEnvName = "RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT";
		const originalExportEnv = process.env[exportEnvName];
		const originalForceEnv = process.env[forceEnvName];
		const originalAllowAudioEnv = process.env[allowAudioEnvName];
		const originalIsPackaged = electronAppMock.isPackaged;
		electronAppMock.isPackaged = true;
		process.env[exportEnvName] = "1";
		delete process.env[forceEnvName];
		delete process.env[allowAudioEnvName];

		try {
			const reason = await getExperimentalNvidiaCudaExportSkipReason(
				createNvidiaCudaSkipOptions({
					audioOptions: { audioMode: "copy-source", audioSourcePath: "input.mp4" },
				}),
			);

			expect(reason).toBe(
				process.platform === "win32" ? "audio-mode:copy-source" : "not-windows",
			);
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
			electronAppMock.isPackaged = originalIsPackaged;
		}
	});

	it("skips user opt-in CUDA candidates when Electron reports no NVIDIA GPU", async () => {
		const reason = await withPackagedCudaCandidate(
			{ gpuDevice: [{ vendorId: 0x8086, deviceString: "Intel UHD Graphics" }] },
			() =>
				getExperimentalNvidiaCudaExportSkipReason(
					createNvidiaCudaSkipOptions({ experimentalNvidiaCudaExport: true }),
				),
		);

		expect(reason).toBe(
			process.platform === "win32" ? "nvidia-gpu-unavailable" : "not-windows",
		);
	});

	it("lets the user opt-in candidate be explicitly disabled", async () => {
		const reason = await withPackagedCudaCandidate(
			{ gpuDevice: [{ vendorId: 0x10de, deviceString: "NVIDIA GeForce GTX 1650" }] },
			async () => {
				process.env.RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT = "0";
				return getExperimentalNvidiaCudaExportSkipReason(
					createNvidiaCudaSkipOptions({ experimentalNvidiaCudaExport: true }),
				);
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

describe("buildNativeStaticLayoutOverlayManifest", () => {
	it("serializes sorted overlay layers into the CUDA manifest contract", () => {
		expect(
			buildNativeStaticLayoutOverlayManifest([
				{
					id: "captions",
					order: 2,
					path: "captions.rgba",
					x: 0,
					y: 900,
					width: 1920,
					height: 180,
					frameRate: 30,
					durationSec: 2,
					frameCount: 60,
					pixelFormat: "rgba",
				},
				{
					id: "effects",
					order: 0,
					path: "effects.rgba",
					x: 0,
					y: 0,
					width: 1920,
					height: 1080,
					frameRate: 30,
					durationSec: 2,
					frameCount: 60,
					pixelFormat: "rgba",
				},
			]),
		).toEqual({
			layers: [
				{
					id: "effects",
					path: "effects.rgba",
					x: 0,
					y: 0,
					width: 1920,
					height: 1080,
					frameCount: 60,
				},
				{
					id: "captions",
					path: "captions.rgba",
					x: 0,
					y: 900,
					width: 1920,
					height: 180,
					frameCount: 60,
				},
			],
		});
	});

	it("passes effectiveFrameCount through while preserving the logical frameCount", () => {
		expect(
			buildNativeStaticLayoutOverlayManifest([
				{
					id: "effects",
					order: 0,
					path: "effects.rgba",
					x: 0,
					y: 0,
					width: 1920,
					height: 1080,
					frameRate: 30,
					durationSec: 2,
					frameCount: 60,
					effectiveFrameCount: 41,
					pixelFormat: "rgba",
				},
				{
					id: "captions",
					order: 2,
					path: "captions.rgba",
					x: 0,
					y: 900,
					width: 1920,
					height: 180,
					frameRate: 30,
					durationSec: 2,
					frameCount: 60,
					pixelFormat: "rgba",
				},
			]),
		).toEqual({
			layers: [
				{
					id: "effects",
					path: "effects.rgba",
					x: 0,
					y: 0,
					width: 1920,
					height: 1080,
					frameCount: 60,
					effectiveFrameCount: 41,
				},
				{
					id: "captions",
					path: "captions.rgba",
					x: 0,
					y: 900,
					width: 1920,
					height: 180,
					frameCount: 60,
				},
			],
		});
	});

	it("omits effectiveFrameCount for fully dynamic layers", () => {
		const manifest = buildNativeStaticLayoutOverlayManifest([
			{
				id: "effects",
				order: 0,
				path: "effects.rgba",
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameRate: 30,
				durationSec: 2,
				frameCount: 60,
				pixelFormat: "rgba",
			},
		]);

		expect(manifest.layers[0]).toEqual({
			id: "effects",
			path: "effects.rgba",
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
			frameCount: 60,
		});
		expect("effectiveFrameCount" in manifest.layers[0]).toBe(false);
	});
});

describe("getNativeStaticLayoutOverlayExpectedSidecarBytes", () => {
	const frameByteSize = 1920 * 1080 * 4;

	it("sizes deduped sidecars from effectiveFrameCount, not the logical frameCount", () => {
		expect(
			getNativeStaticLayoutOverlayExpectedSidecarBytes({
				id: "effects",
				order: 0,
				path: "effects.rgba",
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameRate: 30,
				durationSec: 2,
				frameCount: 60,
				effectiveFrameCount: 41,
				pixelFormat: "rgba",
			}),
		).toBe(frameByteSize * 41);
	});

	it("falls back to the logical frameCount for fully dynamic layers", () => {
		expect(
			getNativeStaticLayoutOverlayExpectedSidecarBytes({
				id: "effects",
				order: 0,
				path: "effects.rgba",
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				frameRate: 30,
				durationSec: 2,
				frameCount: 60,
				pixelFormat: "rgba",
			}),
		).toBe(frameByteSize * 60);
	});
});

describe("native static-layout overlay sidecar validation", () => {
	const frameByteSize = 1920 * 1080 * 4;

	function createOverlayLayer(
		overrides: Partial<NativeStaticLayoutOverlayLayer> = {},
	): NativeStaticLayoutOverlayLayer {
		return {
			id: "effects",
			order: 0,
			path: "effects.rgba",
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
			frameRate: 30,
			durationSec: 10,
			frameCount: 300,
			pixelFormat: "rgba",
			...overrides,
		};
	}

	afterEach(() => {
		fsMocks.stat.mockResolvedValue({ size: 5_000_000_000 });
	});

	it("rejects deduped sidecars truncated below effectiveFrameCount", async () => {
		fsMocks.stat.mockResolvedValue({ size: frameByteSize * 204 });

		await expect(
			exportNativeStaticLayoutVideo(
				"ffmpeg",
				createNvidiaCudaSkipOptions({
					overlayLayers: [
						createOverlayLayer({ frameCount: 300, effectiveFrameCount: 205 }),
					],
				}),
			),
		).rejects.toThrow(
			`Native overlay layer effects is truncated: expected ${frameByteSize * 205} bytes, received ${frameByteSize * 204}`,
		);
	});

	it("accepts deduped sidecars whose physical bytes match effectiveFrameCount", async () => {
		fsMocks.stat.mockResolvedValue({ size: frameByteSize * 205 });

		const error = await exportNativeStaticLayoutVideo(
			"ffmpeg",
			createNvidiaCudaSkipOptions({
				overlayLayers: [createOverlayLayer({ frameCount: 300, effectiveFrameCount: 205 })],
			}),
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).not.toMatch(/truncated/i);
	});

	it("keeps validating fully dynamic layers against the logical frameCount", async () => {
		fsMocks.stat.mockResolvedValue({ size: frameByteSize * 299 });

		await expect(
			exportNativeStaticLayoutVideo(
				"ffmpeg",
				createNvidiaCudaSkipOptions({
					overlayLayers: [createOverlayLayer({ frameCount: 300 })],
				}),
			),
		).rejects.toThrow(
			`Native overlay layer effects is truncated: expected ${frameByteSize * 300} bytes, received ${frameByteSize * 299}`,
		);
	});
});

describe("buildExperimentalNvidiaCudaStaticLayoutArgs", () => {
	it("passes output canvas dimensions to the CUDA wrapper", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({ width: 1020, height: 572 }),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(expect.arrayContaining(["--width", "1020", "--height", "572"]));
	});

	it("passes the high-level HEVC codec to the generalized CUDA compositor", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				videoCodec: "hevc",
				encoderPreference: "hardware",
			}),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(
			expect.arrayContaining(["--output-codec", "hevc", "--encoding-mode", "quality"]),
		);
		expect(args).not.toContain("h264");
	});

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

	it("passes source crop coordinates to the CUDA wrapper", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				sourceCropX: 192,
				sourceCropY: 108,
				sourceCropWidth: 1536,
				sourceCropHeight: 864,
			}),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(
			expect.arrayContaining([
				"--source-crop-x",
				"192",
				"--source-crop-y",
				"108",
				"--source-crop-width",
				"1536",
				"--source-crop-height",
				"864",
			]),
		);
	});

	it("passes the overlay sidecar manifest to the CUDA wrapper", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				overlayManifestPath: "overlay-manifest.json",
			}),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(
			expect.arrayContaining(["--overlay-manifest", "overlay-manifest.json"]),
		);
	});

	it("passes the resolved temporal zoom blur plan to the CUDA wrapper", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				temporalBlur: {
					sampleCount: 13,
					shutterFraction: 0.62,
					weightCurvePower: 1.5,
				},
			}),
			"output.mp4",
			"work",
		);

		expect(args).toEqual(
			expect.arrayContaining([
				"--temporal-blur-sample-count",
				"13",
				"--temporal-blur-shutter-fraction",
				"0.62",
				"--temporal-blur-weight-power",
				"1.5",
			]),
		);
	});

	it("omits temporal blur args when no plan is configured", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({}),
			"output.mp4",
			"work",
		);

		expect(args).not.toContain("--temporal-blur-sample-count");
	});

	it("keeps the D3D11 builder free of overlay manifest args", () => {
		const args = buildExperimentalWindowsGpuStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				overlayManifestPath: "overlay-manifest.json",
			}),
			"output.mp4",
			"work",
		);

		expect(args).not.toContain("--overlay-manifest");
	});
});

describe("resolveNvidiaCudaCursorAssets", () => {
	it("strips cursor asset paths when the CUDA route must not draw the cursor", () => {
		const options = createNvidiaCudaSkipOptions({
			cursorTelemetryPath: "cursor-telemetry.csv",
			cursorAtlasPath: "cursor-atlas.png",
			cursorAtlasMetadataPath: "cursor-atlas.csv",
		});

		expect(resolveNvidiaCudaCursorAssets(options, true)).toEqual({
			cursorTelemetryPath: null,
			cursorAtlasPath: null,
			cursorAtlasMetadataPath: null,
		});
	});

	it("preserves cursor asset paths when native cursor drawing is allowed", () => {
		const options = createNvidiaCudaSkipOptions({
			cursorTelemetryPath: "cursor-telemetry.json",
			cursorAtlasPath: "cursor-atlas.png",
			cursorAtlasMetadataPath: "cursor-atlas.tsv",
		});

		expect(resolveNvidiaCudaCursorAssets(options, false)).toEqual({
			cursorTelemetryPath: "cursor-telemetry.json",
			cursorAtlasPath: "cursor-atlas.png",
			cursorAtlasMetadataPath: "cursor-atlas.tsv",
		});
	});

	it("normalizes missing cursor asset paths to null", () => {
		const options = createNvidiaCudaSkipOptions({});
		expect(resolveNvidiaCudaCursorAssets(options, false)).toEqual({
			cursorTelemetryPath: null,
			cursorAtlasPath: null,
			cursorAtlasMetadataPath: null,
		});
	});
});

describe("CUDA cursor telemetry contract", () => {
	it("never emits --cursor-json for overlay exports after cursor assets are stripped", () => {
		// Mirrors the reported failure: the Windows GPU prep leaves CSV telemetry
		// paths on the options, overlay layers are present, and the CUDA wrapper
		// must not receive the CSV file as --cursor-json (it JSON.parses the path).
		const csvOptions = createNvidiaCudaSkipOptions({
			cursorTelemetryPath: "cursor-telemetry.csv",
			cursorAtlasPath: "cursor-atlas.png",
			cursorAtlasMetadataPath: "cursor-atlas.csv",
			overlayManifestPath: "overlay-manifest.json",
		});
		const cudaOptions = {
			...csvOptions,
			...resolveNvidiaCudaCursorAssets(csvOptions, true),
		};

		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(cudaOptions, "output.mp4", "work");

		expect(args).not.toContain("--cursor-json");
		expect(args).not.toContain("cursor-telemetry.csv");
		expect(args).not.toContain("--cursor-atlas-png");
		expect(args).not.toContain("--cursor-atlas-metadata");
		expect(args).toEqual(
			expect.arrayContaining(["--overlay-manifest", "overlay-manifest.json"]),
		);
	});

	it("emits --cursor-json only for non-overlay CUDA exports with prepared JSON telemetry", () => {
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

		expect(args).toEqual(expect.arrayContaining(["--cursor-json", "cursor-telemetry.json"]));
		expect(args).not.toContain("cursor-telemetry.csv");
	});
});

describe("native static-layout encoder preference", () => {
	it("requires rawvideo for CPU preference", () => {
		expect(
			getNativeStaticLayoutRawFrameFallbackReason({
				videoCodec: "hevc",
				encoderPreference: "cpu",
			}),
		).toBe("encoder-preference-cpu-requires-native-rawvideo");
	});

	it("keeps HEVC hardware eligible for the CUDA route", () => {
		expect(
			getNativeStaticLayoutRawFrameFallbackReason({
				videoCodec: "hevc",
				encoderPreference: "hardware",
			}),
		).toBeNull();
	});
});

describe("buildExperimentalWindowsGpuStaticLayoutArgs", () => {
	it("rejects HEVC instead of constructing an H.264 GPU command", () => {
		expect(() =>
			buildExperimentalWindowsGpuStaticLayoutArgs(
				createNvidiaCudaSkipOptions({ videoCodec: "hevc" }),
				"output.mp4",
			),
		).toThrow(/generalized NVIDIA CUDA compositor/i);
	});
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

	it("passes source crop coordinates to the D3D11 compositor", () => {
		const args = buildExperimentalWindowsGpuStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				sourceCropX: 192,
				sourceCropY: 108,
				sourceCropWidth: 1536,
				sourceCropHeight: 864,
			}),
			"output.mp4",
		);

		expect(args).toEqual(
			expect.arrayContaining([
				"--source-crop-x",
				"192",
				"--source-crop-y",
				"108",
				"--source-crop-width",
				"1536",
				"--source-crop-height",
				"864",
			]),
		);
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

	it("transcodes unknown source audio instead of copying unsafe codecs into MP4", () => {
		const args = buildNativeVideoAudioMuxArgs("video.mp4", "source.wav", "out.mp4", {
			audioMode: "copy-source",
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

	it("blocks unknown codecs so sidecar WAV/PCM audio is encoded for MP4", () => {
		expect(canCopyAudioCodecIntoMp4(undefined)).toBe(false);
		expect(canCopyAudioCodecIntoMp4("")).toBe(false);
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

	it("passes through the extended additive compositor counters", () => {
		const summary = parseNvidiaCudaExportSummary(
			JSON.stringify({
				success: true,
				fps: 30,
				nativeSummary: {
					success: true,
					frames: 300,
					totalMs: 920.5,
					measuredFps: 326.1,
					temporalBlurSampleCount: 13,
					temporalBlurFrames: 40,
					temporalBlurSamplesTotal: 520,
					temporalBlurBgPrecomposedFrames: 38,
					overlayFileLoads: 4,
					overlayCacheHits: 596,
					compositeGpuMs: 240.25,
					zoomBlurGpuMs: 12.5,
					overlayBlendGpuMs: 60.75,
					overlayUploadMs: 18.1,
					overlayBlendFrames: 300,
					nvencMs: 512.4,
					packetWriteMs: 8.2,
					encodeMs: 700.1,
					decodeWallMs: 80.3,
					compositeMs: 262.9,
					flushMs: 2.4,
					realtimeMultiplier: 32.6,
					outputBytes: 1843200,
				},
			}),
		);

		expect(summary?.nativeSummary).toMatchObject({
			totalMs: 920.5,
			measuredFps: 326.1,
			temporalBlurSampleCount: 13,
			temporalBlurFrames: 40,
			temporalBlurSamplesTotal: 520,
			temporalBlurBgPrecomposedFrames: 38,
			overlayFileLoads: 4,
			overlayCacheHits: 596,
			compositeGpuMs: 240.25,
			zoomBlurGpuMs: 12.5,
			overlayBlendGpuMs: 60.75,
			overlayUploadMs: 18.1,
			overlayBlendFrames: 300,
			nvencMs: 512.4,
			packetWriteMs: 8.2,
			encodeMs: 700.1,
			decodeWallMs: 80.3,
			compositeMs: 262.9,
			flushMs: 2.4,
			realtimeMultiplier: 32.6,
			outputBytes: 1843200,
		});
	});

	it("returns null when the wrapper output has no JSON object", () => {
		expect(parseNvidiaCudaExportSummary("native helper failed before summary")).toBeNull();
	});
});

describe("resolveNvidiaCudaNativeSummaryMetrics", () => {
	it("maps only finite additive counters the helper actually reported", () => {
		expect(
			resolveNvidiaCudaNativeSummaryMetrics({
				success: true,
				totalMs: 920.5,
				nvencMs: 512.4,
				compositeGpuMs: 240.25,
				overlayBlendGpuMs: 60.75,
				overlayUploadMs: 18.1,
				overlayFileLoads: 4,
				overlayCacheHits: 596,
				temporalBlurSamplesTotal: 520,
				temporalBlurBgPrecomposedFrames: 38,
				// Legacy counters stay out of the metric mapping; the completion
				// log surfaces them through explicit keys.
				roiCompositeFrames: 300,
			}),
		).toEqual({
			totalMs: 920.5,
			nvencMs: 512.4,
			compositeGpuMs: 240.25,
			overlayBlendGpuMs: 60.75,
			overlayUploadMs: 18.1,
			overlayFileLoads: 4,
			overlayCacheHits: 596,
			temporalBlurSamplesTotal: 520,
			temporalBlurBgPrecomposedFrames: 38,
		});
	});

	it("omits absent, non-finite, and non-numeric counters", () => {
		expect(
			resolveNvidiaCudaNativeSummaryMetrics({
				temporalBlurSampleCount: Number.NaN,
				temporalBlurFrames: Number.POSITIVE_INFINITY,
				nvencMs: "512" as unknown as number,
				overlayFileLoads: 0,
			}),
		).toEqual({ overlayFileLoads: 0 });
	});

	it("returns an empty object for missing native summaries", () => {
		expect(resolveNvidiaCudaNativeSummaryMetrics(undefined)).toEqual({});
	});
});

describe("resolveNvidiaCudaNativeFps", () => {
	it("prefers the helper measured flush-span FPS over the encode-loop fps", () => {
		expect(
			resolveNvidiaCudaNativeFps({
				fps: 30,
				nativeSummary: { fps: 320.5, measuredFps: 326.1 },
			}),
		).toBe(326.1);
	});

	it("falls back to the encode-loop fps and preserves the legacy nativeFps contract", () => {
		expect(resolveNvidiaCudaNativeFps({ nativeSummary: { fps: 320.5 } })).toBe(320.5);
		expect(resolveNvidiaCudaNativeFps({ nativeSummary: { fps: 0 } })).toBeUndefined();
		expect(resolveNvidiaCudaNativeFps(undefined)).toBeUndefined();
	});
});

describe("validateNvidiaCudaStageMetricInvariants", () => {
	it("accepts coherent additive stage metrics", () => {
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					totalMs: 920.5,
					compositeGpuMs: 240.25,
					overlayBlendGpuMs: 60.75,
					overlayUploadMs: 18.1,
					nvencMs: 512.4,
					packetWriteMs: 8.2,
					encodeMs: 700.1,
					decodeWallMs: 80.3,
					temporalBlurFrames: 40,
					temporalBlurSamplesTotal: 520,
					temporalBlurBgPrecomposedFrames: 38,
				},
			}),
		).toEqual([]);
	});

	it("rejects additive counters that exceed the helper wall time", () => {
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					totalMs: 100,
					nvencMs: 512.4,
					overlayUploadMs: 18.1,
				},
			}),
		).toEqual(["nvencMs 512.4ms exceeds helper wall time 100ms"]);
	});

	it("rejects temporal blur counters that contradict the frame count", () => {
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					temporalBlurFrames: 40,
					temporalBlurSamplesTotal: 20,
				},
			}),
		).toEqual(["temporalBlurSamplesTotal 20 below temporalBlurFrames 40"]);
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					temporalBlurFrames: 40,
					temporalBlurBgPrecomposedFrames: 41,
				},
			}),
		).toEqual(["temporalBlurBgPrecomposedFrames 41 exceeds temporalBlurFrames 40"]);
	});

	it("reports no issues when the native summary is absent", () => {
		expect(validateNvidiaCudaStageMetricInvariants({})).toEqual([]);
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

	it("rejects inline-audio CUDA output when the helper does not produce audio", () => {
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
			},
			{ durationSec: 10, targetFrames: 300, requiresTimelineSync: true },
		);

		expect(issues).toEqual(["missing output audio stream"]);
	});

	it("rejects inline-audio CUDA output when the probed audio stream is empty", () => {
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
				outputAudio: { duration: "0.000000" },
			},
			{ durationSec: 10, targetFrames: 300, requiresTimelineSync: true },
		);

		expect(issues).toEqual(["output audio duration is not positive"]);
	});

	it("rejects inline-audio CUDA output when the audio duration is missing", () => {
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
				outputAudio: {},
			},
			{ durationSec: 10, targetFrames: 300, requiresTimelineSync: true },
		);

		expect(issues).toEqual(["missing output audio duration"]);
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
				'PROGRESS {"currentFrame":30,"totalFrames":60,"percentage":50,"averageFps":240.5,"instantFps":180.25,"intervalMs":166.4,"intervalFrames":30,"intervalEncodeMs":120.2,"intervalPipelineWaitMs":46.2,"intervalMonolithicCompositeFrames":0,"intervalZoomBlurFrames":13,"stage":"finalizing"}',
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
			intervalZoomBlurFrames: 13,
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
	describe("resolveNativeStaticLayoutFpsFields", () => {
		it("prefers native measured FPS over the preparation-inclusive estimate", () => {
			const progress = {
				currentFrame: 300,
				totalFrames: 600,
				percentage: 50,
				averageFps: 17.2,
				instantFps: 19.1,
			};

			expect(resolveNativeStaticLayoutFpsFields(progress, 45_000)).toEqual({
				averageFps: 17.2,
				estimatedFps: undefined,
				fpsSource: "native",
			});
		});

		it("never labels the preparation-inclusive estimate as measured encode speed", () => {
			const progress = {
				currentFrame: 120,
				totalFrames: 600,
				percentage: 20,
			};

			expect(resolveNativeStaticLayoutFpsFields(progress, 30_000)).toEqual({
				averageFps: undefined,
				estimatedFps: 4,
				fpsSource: "estimated",
			});
		});

		it("reports no FPS fields before any frame has been encoded", () => {
			expect(
				resolveNativeStaticLayoutFpsFields(
					{ currentFrame: 0, totalFrames: 600, percentage: 0 },
					12_000,
				),
			).toEqual({
				averageFps: undefined,
				estimatedFps: undefined,
				fpsSource: undefined,
			});
		});

		it("keeps the estimate when only interval FPS is present but no helper average", () => {
			const progress = {
				currentFrame: 60,
				totalFrames: 600,
				percentage: 10,
				instantFps: 240.5,
			};

			expect(resolveNativeStaticLayoutFpsFields(progress, 10_000)).toEqual({
				averageFps: undefined,
				estimatedFps: undefined,
				fpsSource: "native",
			});
		});
	});
	describe("formatNativeStaticLayoutZoomTelemetryLines", () => {
		it("writes renderer zoom-blur columns for the CUDA compositor", () => {
			const lines = formatNativeStaticLayoutZoomTelemetryLines([
				{
					timeMs: 0,
					scale: 1,
					x: 0,
					y: 0,
					blurStrength: 0,
					blurCenterX: 960,
					blurCenterY: 540,
				},
				{
					timeMs: 33.333,
					scale: 1.0123,
					x: -11.8,
					y: -6.6,
					blurStrength: 0.00345,
					blurCenterX: 960,
					blurCenterY: 540,
				},
			]);

			expect(lines).toEqual([
				"0,1,0,0,0,960,540",
				"33.333,1.0123,-11.8,-6.6,0.00345,960,540",
			]);
		});

		it("keeps 4-column telemetry backward compatible with blur defaults", () => {
			const lines = formatNativeStaticLayoutZoomTelemetryLines([
				{ timeMs: 0, scale: 1, x: 0, y: 0 },
			]);

			expect(lines).toEqual(["0,1,0,0,0,0,0"]);
		});
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

describe("native cursor atlas ownership", () => {
	function createCursorOverlayLayer(
		overrides: Partial<NativeStaticLayoutOverlayLayer> = {},
	): NativeStaticLayoutOverlayLayer {
		return {
			id: "effects",
			order: 0,
			path: "effects.rgba",
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
			frameRate: 30,
			durationSec: 10,
			frameCount: 300,
			pixelFormat: "rgba",
			...overrides,
		};
	}

	it("passes cursor assets and the overlay manifest through when the atlas owns the cursor", () => {
		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				cursorTelemetryPath: "cursor-telemetry.json",
				cursorSize: 96,
				cursorAtlasPath: "cursor-atlas.png",
				cursorAtlasMetadataPath: "cursor-atlas.tsv",
				overlayManifestPath: "overlay-manifest.json",
				cursorAtlasOwned: true,
			}),
			"output.mp4",
			"work",
		);

		// The sidecar excluded cursor pixels, so the CUDA wrapper must receive both
		// the overlay manifest and the cursor atlas: dropping either would lose the
		// cursor and baking it again would double-render.
		expect(args).toEqual(
			expect.arrayContaining(["--overlay-manifest", "overlay-manifest.json"]),
		);
		expect(args).toEqual(
			expect.arrayContaining([
				"--cursor-json",
				"cursor-telemetry.json",
				"--cursor-atlas-png",
				"cursor-atlas.png",
				"--cursor-atlas-metadata",
				"cursor-atlas.tsv",
			]),
		);
	});

	it("keeps stripping baked-cursor assets even when a manifest path is present", () => {
		const csvOptions = createNvidiaCudaSkipOptions({
			cursorTelemetryPath: "cursor-telemetry.csv",
			cursorAtlasPath: "cursor-atlas.png",
			cursorAtlasMetadataPath: "cursor-atlas.csv",
			overlayManifestPath: "overlay-manifest.json",
		});
		const cudaOptions = {
			...csvOptions,
			...resolveNvidiaCudaCursorAssets(csvOptions, true),
		};

		const args = buildExperimentalNvidiaCudaStaticLayoutArgs(cudaOptions, "output.mp4", "work");

		expect(args).not.toContain("--cursor-json");
		expect(args).not.toContain("--cursor-atlas-png");
		expect(args).toEqual(
			expect.arrayContaining(["--overlay-manifest", "overlay-manifest.json"]),
		);
	});

	it("refuses a native-owned cursor when the CUDA route cannot run", async () => {
		const error = await exportNativeStaticLayoutVideo(
			"ffmpeg",
			createNvidiaCudaSkipOptions({
				overlayLayers: [createCursorOverlayLayer()],
				cursorAtlasOwned: true,
				experimentalWindowsGpuCompositor: false,
			}),
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(
			/Cursor ownership by the native atlas requires the generalized NVIDIA CUDA compositor/i,
		);
	});

	it("allows a native-owned cursor when the CUDA route is explicitly opted in on Windows", async () => {
		if (process.platform !== "win32") {
			return;
		}

		const error = await exportNativeStaticLayoutVideo(
			"ffmpeg",
			createNvidiaCudaSkipOptions({
				overlayLayers: [createCursorOverlayLayer()],
				cursorAtlasOwned: true,
				experimentalWindowsGpuCompositor: true,
				experimentalNvidiaCudaExport: true,
			}),
		).catch((caught: unknown) => caught);

		// The preflight guard must not reject the CUDA-opt-in route; any later
		// failure is a runtime/skip error, not a cursor-ownership refusal.
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).not.toMatch(
			/Cursor ownership by the native atlas requires the generalized NVIDIA CUDA compositor/i,
		);
	});
});

describe("resolveNvidiaCudaOverlaySidecarSummaryMetrics", () => {
	it("surfaces dimensions and physical/effective frame counts for deduped sidecars", () => {
		expect(
			resolveNvidiaCudaOverlaySidecarSummaryMetrics(
				createNvidiaCudaSkipOptions({
					overlayLayers: [
						{
							id: "effects",
							order: 0,
							path: "effects.rgba",
							x: 0,
							y: 0,
							width: 1920,
							height: 1080,
							frameRate: 30,
							durationSec: 10,
							frameCount: 300,
							effectiveFrameCount: 41,
							pixelFormat: "rgba",
						},
					],
				}),
			),
		).toEqual({
			overlayWidth: 1920,
			overlayHeight: 1080,
			overlayFrameCount: 300,
			overlayPhysicalFrames: 41,
			overlayEffectiveFrames: 41,
		});
	});

	it("falls back to the logical frame count for fully dynamic sidecars", () => {
		const metrics = resolveNvidiaCudaOverlaySidecarSummaryMetrics(
			createNvidiaCudaSkipOptions({
				overlayLayers: [
					{
						id: "effects",
						order: 0,
						path: "effects.rgba",
						x: 0,
						y: 0,
						width: 1920,
						height: 1080,
						frameRate: 30,
						durationSec: 10,
						frameCount: 300,
						pixelFormat: "rgba",
					},
				],
			}),
		);

		expect(metrics).toEqual({
			overlayWidth: 1920,
			overlayHeight: 1080,
			overlayFrameCount: 300,
			overlayPhysicalFrames: 300,
		});
		expect("overlayEffectiveFrames" in metrics).toBe(false);
	});

	it("returns no metrics when overlay layers are absent", () => {
		expect(
			resolveNvidiaCudaOverlaySidecarSummaryMetrics(createNvidiaCudaSkipOptions({})),
		).toEqual({});
	});
});

describe("native summary metric mapping (module 3 surface)", () => {
	it("maps the additive temporal/overlay counters the helper emitted", () => {
		expect(
			resolveNvidiaCudaNativeSummaryMetrics({
				temporalBlurStationaryFrames: 12,
				temporalBgCacheBuilds: 14,
				temporalBgCacheHits: 26,
				overlayStaticRegionBlends: 598,
				overlayWidth: 1920,
				overlayHeight: 1080,
				overlayFrameCount: 300,
				overlayPhysicalFrames: 41,
				overlayEffectiveFrames: 41,
				overlayBlendFrames: 300,
			}),
		).toEqual({
			temporalBlurStationaryFrames: 12,
			temporalBgCacheBuilds: 14,
			temporalBgCacheHits: 26,
			overlayStaticRegionBlends: 598,
			overlayWidth: 1920,
			overlayHeight: 1080,
			overlayFrameCount: 300,
			overlayPhysicalFrames: 41,
			overlayEffectiveFrames: 41,
			overlayBlendFrames: 300,
		});
	});

	it("keeps absent host-read/H2D fields out of the mapping until the helper emits them", () => {
		expect(
			resolveNvidiaCudaNativeSummaryMetrics({
				overlayHostReadMs: Number.NaN,
				overlayH2DEnqueueMs: 4.5,
			}),
		).toEqual({ overlayH2DEnqueueMs: 4.5 });
	});
});

describe("native summary metric invariants (module 3)", () => {
	it("accepts coherent temporal cache and stationary counters", () => {
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					temporalBlurFrames: 40,
					temporalBlurStationaryFrames: 10,
					temporalBlurBgPrecomposedFrames: 30,
					temporalBgCacheBuilds: 8,
					temporalBgCacheHits: 22,
					overlayBlendFrames: 300,
					overlayStaticRegionBlends: 297,
					overlayFrameCount: 300,
					overlayPhysicalFrames: 41,
					overlayEffectiveFrames: 41,
				},
			}),
		).toEqual([]);
	});

	it("rejects stationary frames beyond the temporal frame count", () => {
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					temporalBlurFrames: 40,
					temporalBlurStationaryFrames: 41,
				},
			}),
		).toEqual(["temporalBlurStationaryFrames 41 exceeds temporalBlurFrames 40"]);
	});

	it("rejects temporal cache counters that exceed the precomposed frame budget", () => {
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					temporalBlurFrames: 40,
					temporalBlurBgPrecomposedFrames: 30,
					temporalBgCacheBuilds: 20,
					temporalBgCacheHits: 15,
				},
			}),
		).toEqual([
			"temporalBgCacheBuilds 20 + temporalBgCacheHits 15 exceed temporalBlurBgPrecomposedFrames 30",
		]);
	});

	it("rejects overlay static-region blends beyond overlay blend frames", () => {
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					overlayBlendFrames: 300,
					overlayStaticRegionBlends: 301,
				},
			}),
		).toEqual(["overlayStaticRegionBlends 301 exceeds overlayBlendFrames 300"]);
	});

	it("rejects overlay sidecar frame counts that contradict the logical count", () => {
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					overlayFrameCount: 300,
					overlayPhysicalFrames: 301,
				},
			}),
		).toEqual(["overlayPhysicalFrames 301 exceeds overlayFrameCount 300"]);
		expect(
			validateNvidiaCudaStageMetricInvariants({
				nativeSummary: {
					overlayFrameCount: 300,
					overlayEffectiveFrames: 0,
				},
			}),
		).toEqual(["overlayEffectiveFrames 0 out of range for overlayFrameCount 300"]);
	});
});

describe("CUDA progress interval fields (module 3 surface)", () => {
	it("parses the additive temporal/overlay interval counters from PROGRESS lines", () => {
		expect(
			parseWindowsGpuExportProgressLine(
				'PROGRESS {"currentFrame":120,"totalFrames":300,"percentage":40,"intervalTemporalBlurStationaryFrames":3,"intervalTemporalBgCacheBuilds":4,"intervalTemporalBgCacheHits":9,"intervalOverlayStaticRegionBlends":11}',
			),
		).toMatchObject({
			currentFrame: 120,
			totalFrames: 300,
			percentage: 40,
			intervalTemporalBlurStationaryFrames: 3,
			intervalTemporalBgCacheBuilds: 4,
			intervalTemporalBgCacheHits: 9,
			intervalOverlayStaticRegionBlends: 11,
		});
	});
});

const TILED_TILE_BYTE_SIZE = 128 * 128 * 4;
const TILED_LAYER_WIDTH = 384;
const TILED_LAYER_HEIGHT = 256;
const TILED_LAYER_TILE_COUNT = 3 * 2;

function tiledTileRecord(
	tileIndex: number,
	byteOffset: number,
	overrides: Partial<{ byteLength: number; byteOffset: number }> = {},
) {
	return { tileIndex, byteOffset, byteLength: TILED_TILE_BYTE_SIZE, ...overrides };
}

function staticTilesFor(tileCount = TILED_LAYER_TILE_COUNT) {
	return Array.from({ length: tileCount }, (_, tileIndex) =>
		tiledTileRecord(tileIndex, tileIndex * TILED_TILE_BYTE_SIZE),
	);
}

function tiledLayer(
	overrides: Partial<NativeTiledOverlayLayerDescriptor> = {},
): NativeTiledOverlayLayerDescriptor {
	return {
		id: "tiled-effects",
		order: 0,
		x: 0,
		y: 0,
		width: TILED_LAYER_WIDTH,
		height: TILED_LAYER_HEIGHT,
		frameRate: 30,
		durationSec: 2,
		frameCount: 60,
		tileSize: 128,
		pixelFormat: "rgba",
		payloadPath: "C:/Temp/tiled-overlay.bin",
		payloadByteLength: TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE,
		staticTiles: staticTilesFor(),
		frameDeltas: [],
		...overrides,
	};
}

describe("tiled overlay integration (native-video module)", () => {
	it("passes the tiled overlay manifest only when tiled layers are present", () => {
		const noTiled = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				overlayManifestPath: "overlay-manifest.json",
			}),
			"output.mp4",
			"work",
		);
		expect(noTiled).toEqual(
			expect.arrayContaining(["--overlay-manifest", "overlay-manifest.json"]),
		);
		expect(noTiled).not.toContain("--tiled-overlay-manifest");

		const withTiled = buildExperimentalNvidiaCudaStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				overlayManifestPath: "overlay-manifest.json",
				tiledOverlayManifestPath: "tiled-overlay-manifest.json",
			}),
			"output.mp4",
			"work",
		);
		expect(withTiled).toEqual(
			expect.arrayContaining(["--overlay-manifest", "overlay-manifest.json"]),
		);
		expect(withTiled).toEqual(
			expect.arrayContaining(["--tiled-overlay-manifest", "tiled-overlay-manifest.json"]),
		);
	});

	it("keeps the D3D11 builder free of tiled overlay args", () => {
		const args = buildExperimentalWindowsGpuStaticLayoutArgs(
			createNvidiaCudaSkipOptions({
				tiledOverlayManifestPath: "tiled-overlay-manifest.json",
			}),
			"output.mp4",
		);
		expect(args).not.toContain("--tiled-overlay-manifest");
		expect(args).not.toContain("--overlay-manifest");
	});

	it("builds the versioned tiled storage descriptor sorted by order then id", () => {
		const manifest = buildNativeStaticLayoutTiledOverlayManifest(
			{
				width: 1920,
				height: 1080,
				frameRate: 30,
				durationSec: 2,
			},
			[
				tiledLayer({ id: "captions", order: 2 }),
				tiledLayer({ id: "effects", order: 0 }),
				tiledLayer({ id: "annotations", order: 0 }),
			],
		);

		expect(manifest.version).toBe(1);
		expect(manifest.outputWidth).toBe(1920);
		expect(manifest.outputHeight).toBe(1080);
		expect(manifest.layers.map((layer) => layer.id)).toEqual([
			"annotations",
			"effects",
			"captions",
		]);
	});

	it("rejects a malformed tiled descriptor through the export preflight", async () => {
		fsMocks.stat.mockResolvedValue({ size: 1_000_000 });

		const error = await exportNativeStaticLayoutVideo(
			"ffmpeg",
			createNvidiaCudaSkipOptions({
				durationSec: 2,
				experimentalWindowsGpuCompositor: false,
				tiledOverlayLayers: [
					tiledLayer({
						id: "",
						payloadPath: "",
					}),
				],
			}),
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(/Invalid tiled overlay descriptor/i);
	});

	it("rejects a truncated tiled payload through the export preflight", async () => {
		fsMocks.stat.mockResolvedValue({ size: 1 });

		const error = await exportNativeStaticLayoutVideo(
			"ffmpeg",
			createNvidiaCudaSkipOptions({
				durationSec: 2,
				experimentalWindowsGpuCompositor: false,
				tiledOverlayLayers: [tiledLayer()],
			}),
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(/Tiled overlay layer .* payload is truncated/i);
	});

	it("resolves additive tiled overlay summary metrics without touching helper output", () => {
		const nextOffset = TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE;
		const firstLayer = tiledLayer({
			payloadByteLength: nextOffset + 4 * TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{ frameIndex: 10, changedTiles: [tiledTileRecord(1, nextOffset)] },
				{
					frameIndex: 20,
					changedTiles: [
						tiledTileRecord(4, nextOffset + TILED_TILE_BYTE_SIZE),
						tiledTileRecord(5, nextOffset + 2 * TILED_TILE_BYTE_SIZE),
					],
				},
				{
					frameIndex: 30,
					changedTiles: [tiledTileRecord(2, nextOffset + 3 * TILED_TILE_BYTE_SIZE)],
				},
			],
		});

		expect(
			resolveNvidiaCudaTiledOverlaySidecarSummaryMetrics(
				createNvidiaCudaSkipOptions({
					tiledOverlayLayers: [firstLayer, tiledLayer({ id: "captions", order: 1 })],
				}),
			),
		).toEqual({
			tiledOverlayLayers: 2,
			changedTileCount: 4,
			uploadedTileBytes:
				(TILED_LAYER_TILE_COUNT + 4 + TILED_LAYER_TILE_COUNT) * TILED_TILE_BYTE_SIZE,
			cachedTileCount:
				TILED_LAYER_TILE_COUNT * 60 -
				(TILED_LAYER_TILE_COUNT + 4) +
				(TILED_LAYER_TILE_COUNT * 60 - TILED_LAYER_TILE_COUNT),
		});
	});

	it("preserves raw overlay sidecar metrics and does not mix them with tiled metrics", () => {
		const rawLayer: NativeStaticLayoutOverlayLayer = {
			id: "effects",
			order: 0,
			path: "effects.rgba",
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
			frameRate: 30,
			durationSec: 10,
			frameCount: 300,
			pixelFormat: "rgba",
		};
		const tiled = tiledLayer();

		const bothMetrics = resolveNvidiaCudaOverlaySidecarSummaryMetrics(
			createNvidiaCudaSkipOptions({
				overlayLayers: [rawLayer],
				tiledOverlayLayers: [tiled],
			}),
		);
		const tiledMetrics = resolveNvidiaCudaTiledOverlaySidecarSummaryMetrics(
			createNvidiaCudaSkipOptions({
				overlayLayers: [rawLayer],
				tiledOverlayLayers: [tiled],
			}),
		);

		expect(bothMetrics).toEqual({
			overlayWidth: 1920,
			overlayHeight: 1080,
			overlayFrameCount: 300,
			overlayPhysicalFrames: 300,
		});
		expect(tiledMetrics).toEqual({
			tiledOverlayLayers: 1,
			changedTileCount: 0,
			uploadedTileBytes: TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE,
			cachedTileCount: TILED_LAYER_TILE_COUNT * 60 - TILED_LAYER_TILE_COUNT,
		});
	});

	it("reports the conservative raw fallback reason for ineligible tiled layers", () => {
		const denseLayer = tiledLayer({
			frameCount: 2,
			payloadByteLength: (TILED_LAYER_TILE_COUNT + 3) * TILED_TILE_BYTE_SIZE,
			frameDeltas: [
				{
					frameIndex: 0,
					changedTiles: [0, 1, 2].map((tileIndex, index) =>
						tiledTileRecord(
							tileIndex,
							(TILED_LAYER_TILE_COUNT + index) * TILED_TILE_BYTE_SIZE,
						),
					),
				},
			],
		});

		expect(
			resolveNvidiaCudaTiledOverlaySidecarSummaryMetrics(
				createNvidiaCudaSkipOptions({
					tiledOverlayLayers: [denseLayer],
				}),
			),
		).toMatchObject({
			rawFallbackReason: "payload-bytes-exceed-raw",
		});
	});

	it("adds the additive tiled counters into the native summary mapping", () => {
		expect(
			resolveNvidiaCudaNativeSummaryMetrics({
				success: true,
				changedTileCount: 8,
				uploadedTileBytes: 1024,
				cachedTileCount: 200,
				rawFallbackReason: "small-layer",
				overlayHostReadMs: 12.5,
				overlayH2DEnqueueMs: 4.5,
				overlayCacheHits: 96,
				totalMs: 920.5,
				nativeFps: 240.5,
			}),
		).toEqual({
			changedTileCount: 8,
			uploadedTileBytes: 1024,
			cachedTileCount: 200,
			rawFallbackReason: "small-layer",
			overlayHostReadMs: 12.5,
			overlayH2DEnqueueMs: 4.5,
			overlayCacheHits: 96,
			totalMs: 920.5,
		});
		expect(
			resolveNvidiaCudaNativeSummaryMetrics({
				nativeFps: 240.5,
			}),
		).toEqual({});
	});

	it("validates tiled overlay metric invariants for additive counters", () => {
		const tileCount = TILED_LAYER_TILE_COUNT;
		const frameCount = 60;
		const uploadedBytes = (tileCount + 1) * TILED_TILE_BYTE_SIZE;
		const cached = tileCount * frameCount - (tileCount + 1);
		const issues = validateNvidiaCudaStageMetricInvariants({
			nativeSummary: {
				totalMs: 100,
				changedTileCount: -1,
				uploadedTileBytes: uploadedBytes,
				cachedTileCount: cached,
				overlayCacheHits: cached + 1,
				overlayHostReadMs: 20,
				overlayH2DEnqueueMs: 40,
			},
		});

		expect(issues).toEqual([]);
	});

	it("keeps uploaded tile bytes bounded by the payload size and consistent with tile counts", () => {
		const layer = tiledLayer();
		const metrics = resolveNvidiaCudaTiledOverlaySidecarSummaryMetrics(
			createNvidiaCudaSkipOptions({
				tiledOverlayLayers: [layer],
			}),
		);

		expect(metrics.uploadedTileBytes).toBe(TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE);
		expect(metrics.uploadedTileBytes).toBeLessThanOrEqual(layer.payloadByteLength);
		expect(metrics.cachedTileCount).toBeGreaterThanOrEqual(0);
		expect(metrics.cachedTileCount).toBeLessThanOrEqual(TILED_LAYER_TILE_COUNT * 60);
		expect(metrics.changedTileCount).toBe(0);
	});

	it("does not confuse logical frame count with effective state versions", () => {
		const layer = tiledLayer({
			frameCount: 60,
			frameDeltas: [
				{
					frameIndex: 10,
					changedTiles: [
						tiledTileRecord(1, TILED_LAYER_TILE_COUNT * TILED_TILE_BYTE_SIZE),
					],
				},
			],
		});

		expect(layer.frameCount).toBe(60);
		expect(layer.frameDeltas.length + 1).toBe(2);
		expect(
			resolveNvidiaCudaTiledOverlaySidecarSummaryMetrics(
				createNvidiaCudaSkipOptions({
					tiledOverlayLayers: [layer],
				}),
			),
		).toMatchObject({
			changedTileCount: 1,
			cachedTileCount: TILED_LAYER_TILE_COUNT * 60 - (TILED_LAYER_TILE_COUNT + 1),
		});
	});

	it("keeps HEVC Hardware eligible for the CUDA route despite tiled overlay layers", () => {
		expect(
			getNativeStaticLayoutRawFrameFallbackReason({
				videoCodec: "hevc",
				encoderPreference: "hardware",
			}),
		).toBeNull();
	});
});
