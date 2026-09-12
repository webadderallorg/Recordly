import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModernVideoExporter as ModernVideoExporterClass } from "./modernVideoExporter";

const mocks = vi.hoisted(() => {
	const videoInfo = {
		width: 1920,
		height: 1080,
		duration: 1,
		streamDuration: 1,
		frameRate: 30,
		codec: "h264",
		hasAudio: false,
		audioCodec: null,
		audioSampleRate: null,
	};

	return {
		videoInfo,
		streamingDecoderDestroy: vi.fn(),
		streamingDecoderCancel: vi.fn(),
		streamingDecoderDecodeAll: vi.fn(async () => {}),
		streamingDecoderGetDemuxer: vi.fn(() => null),
		streamingDecoderGetEffectiveDuration: vi.fn(() => 0),
		streamingDecoderLoadMetadata: vi.fn(async () => videoInfo),
		frameRendererDestroy: vi.fn(),
		frameRendererGetBackend: vi.fn(() => "webgl"),
		frameRendererInitialize: vi.fn(async () => {}),
		muxerDestroy: vi.fn(),
		muxerFinalize: vi.fn(async () => ({
			mode: "buffer" as const,
			blob: new Blob([], { type: "video/mp4" }),
		})),
		muxerInitialize: vi.fn(async () => {}),
	};
});

vi.mock("./streamingDecoder", () => ({
	StreamingVideoDecoder: vi.fn().mockImplementation(function () {
		return {
			cancel: mocks.streamingDecoderCancel,
			decodeAll: mocks.streamingDecoderDecodeAll,
			destroy: mocks.streamingDecoderDestroy,
			getDemuxer: mocks.streamingDecoderGetDemuxer,
			getEffectiveDuration: mocks.streamingDecoderGetEffectiveDuration,
			loadMetadata: mocks.streamingDecoderLoadMetadata,
		};
	}),
}));

vi.mock("./modernFrameRenderer", () => ({
	FrameRenderer: vi.fn().mockImplementation(function () {
		return {
			destroy: mocks.frameRendererDestroy,
			getRendererBackend: mocks.frameRendererGetBackend,
			initialize: mocks.frameRendererInitialize,
		};
	}),
}));

vi.mock("./muxer", () => ({
	VideoMuxer: vi.fn().mockImplementation(function () {
		return {
			destroy: mocks.muxerDestroy,
			finalize: mocks.muxerFinalize,
			initialize: mocks.muxerInitialize,
		};
	}),
}));

describe("ModernVideoExporter native fallback routing", () => {
	let ModernVideoExporter: typeof ModernVideoExporterClass;

	beforeAll(async () => {
		({ ModernVideoExporter } = await import("./modernVideoExporter"));
	}, 30_000);

	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it("falls back to WebCodecs instead of surfacing a native error when Breeze is unavailable", async () => {
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			experimentalNativeExport: true,
			backendPreference: "breeze",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
			loadNativeStaticLayoutVideoInfo: () => Promise<unknown>;
			tryExportNativeStaticLayout: () => Promise<unknown>;
			tryStartNativeVideoExport: () => Promise<boolean>;
			lastNativeExportError: string | null;
		};

		vi.spyOn(exporter, "loadNativeStaticLayoutVideoInfo").mockResolvedValue(mocks.videoInfo);
		vi.spyOn(exporter, "tryExportNativeStaticLayout").mockResolvedValue(null);
		vi.spyOn(exporter, "tryStartNativeVideoExport").mockImplementation(async () => {
			exporter.lastNativeExportError = "Breeze native encoder unavailable";
			return false;
		});
		const initializeEncoder = vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(result.error).toBeUndefined();
		expect(result.blob).toBeInstanceOf(Blob);
		expect(initializeEncoder).toHaveBeenCalledTimes(1);
		expect(mocks.muxerFinalize).toHaveBeenCalledTimes(1);
	}, 15_000);

	it("keeps Windows auto exports on the streaming native route before static layout", async () => {
		vi.stubGlobal("navigator", {
			platform: "Win32",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		});

		const nativeResult = {
			success: true,
			blob: new Blob([], { type: "video/mp4" }),
		};
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			experimentalNativeExport: true,
			backendPreference: "auto",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			finishNativeVideoExport: () => Promise<unknown>;
			loadNativeStaticLayoutVideoInfo: () => Promise<unknown>;
			tryExportNativeStaticLayout: () => Promise<unknown>;
			tryStartNativeVideoExport: () => Promise<boolean>;
		};

		const loadNativeStaticLayoutVideoInfo = vi.spyOn(
			exporter,
			"loadNativeStaticLayoutVideoInfo",
		);
		const tryExportNativeStaticLayout = vi.spyOn(exporter, "tryExportNativeStaticLayout");
		const tryStartNativeVideoExport = vi
			.spyOn(exporter, "tryStartNativeVideoExport")
			.mockResolvedValue(true);
		const finishNativeVideoExport = vi
			.spyOn(exporter, "finishNativeVideoExport")
			.mockResolvedValue(nativeResult);

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(result.blob).toBe(nativeResult.blob);
		expect(tryStartNativeVideoExport).toHaveBeenCalledTimes(1);
		expect(loadNativeStaticLayoutVideoInfo).not.toHaveBeenCalled();
		expect(tryExportNativeStaticLayout).not.toHaveBeenCalled();
		expect(mocks.streamingDecoderLoadMetadata).toHaveBeenCalledTimes(1);
		expect(finishNativeVideoExport).toHaveBeenCalledTimes(1);
	}, 15_000);

	it("tries Windows auto static-layout first when NVIDIA CUDA is opted in", async () => {
		vi.stubGlobal("navigator", {
			platform: "Win32",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		});

		const staticLayoutResult = {
			success: true,
			blob: new Blob([], { type: "video/mp4" }),
		};
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			experimentalNativeExport: true,
			experimentalNvidiaCudaExport: true,
			backendPreference: "auto",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
			loadNativeStaticLayoutVideoInfo: () => Promise<unknown>;
			tryExportNativeStaticLayout: () => Promise<unknown>;
			tryStartNativeVideoExport: () => Promise<boolean>;
		};

		const initializeEncoder = vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});
		const loadNativeStaticLayoutVideoInfo = vi
			.spyOn(exporter, "loadNativeStaticLayoutVideoInfo")
			.mockResolvedValue(mocks.videoInfo);
		const tryExportNativeStaticLayout = vi
			.spyOn(exporter, "tryExportNativeStaticLayout")
			.mockResolvedValue(staticLayoutResult);
		const tryStartNativeVideoExport = vi
			.spyOn(exporter, "tryStartNativeVideoExport")
			.mockResolvedValue(true);

		const result = await exporter.export();

		expect(result).toBe(staticLayoutResult);
		expect(loadNativeStaticLayoutVideoInfo).toHaveBeenCalledTimes(1);
		expect(tryExportNativeStaticLayout).toHaveBeenCalledTimes(1);
		expect(tryStartNativeVideoExport).not.toHaveBeenCalled();
		expect(initializeEncoder).not.toHaveBeenCalled();
		expect(mocks.streamingDecoderLoadMetadata).not.toHaveBeenCalled();
	}, 15_000);

	it("retries the main decode path once with a fresh media source", async () => {
		mocks.streamingDecoderGetEffectiveDuration.mockReturnValue(1);
		mocks.streamingDecoderDecodeAll
			.mockRejectedValueOnce(
				new Error("readAVPacket pipeline failed: Failed after 3 attempts"),
			)
			.mockResolvedValueOnce(undefined);

		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			backendPreference: "webcodecs",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
		};

		vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(mocks.streamingDecoderLoadMetadata).toHaveBeenCalledTimes(2);
		expect(mocks.streamingDecoderLoadMetadata.mock.calls[0]).toEqual([
			"file:///recording.mp4",
			{
				useFallbackMediaSource: false,
			},
		]);
		expect(mocks.streamingDecoderLoadMetadata.mock.calls[1]).toEqual([
			"file:///recording.mp4",
			{
				useFallbackMediaSource: true,
			},
		]);
		expect(mocks.streamingDecoderDecodeAll).toHaveBeenCalledTimes(2);
		expect(mocks.muxerFinalize).toHaveBeenCalledTimes(1);
	});

	it("builds actionable diagnostics for input decoder failures", () => {
		vi.stubGlobal("navigator", {
			platform: "Win32",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		});
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1200,
			height: 570,
			frameRate: 60,
			bitrate: 8_000_000,
			backendPreference: "auto",
		} as never) as unknown as {
			buildLightningExportError: (error: unknown) => string;
			sourceVideoInfo: typeof mocks.videoInfo;
			renderBackend: "webgpu";
			encodeBackend: "ffmpeg";
			encoderName: string;
			processedFrameCount: number;
			totalExportStartTimeMs: number;
			mediaSourceRetryAttempted: boolean;
			effectiveDurationSec: number;
			runtimeDiagnostics: {
				appVersion: string;
				userAgent: string;
				logicalProcessors: number;
				deviceMemoryGb: number;
				hardware: RendererExportHardwareInfo;
			};
			backpressureProfile: {
				name: string;
				maxDecodeQueue: number;
				maxPendingFrames: number;
				maxEncodeQueue: number;
			};
		};
		exporter.sourceVideoInfo = mocks.videoInfo;
		exporter.renderBackend = "webgpu";
		exporter.encodeBackend = "ffmpeg";
		exporter.encoderName = "h264-stream-copy";
		exporter.processedFrameCount = 314;
		exporter.totalExportStartTimeMs = 1;
		exporter.mediaSourceRetryAttempted = true;
		exporter.effectiveDurationSec = 10;
		exporter.runtimeDiagnostics = {
			appVersion: "1.4.0",
			userAgent: "RecordlyTest/1.0 Electron/43.1.0",
			logicalProcessors: 12,
			deviceMemoryGb: 8,
			hardware: {
				platform: "win32",
				release: "10.0.26100",
				arch: "x64",
				cpuModel: "AMD Ryzen 9 7900X",
				logicalProcessors: 24,
				totalMemoryGb: 31.8,
				machineModel: "Custom PC",
				gpus: [
					{
						name: "NVIDIA GeForce RTX 4070",
						vendor: "NVIDIA",
						active: true,
					},
				],
				gpuFeatures: {
					videoDecode: "enabled",
					videoEncode: "enabled",
					webgl: "enabled",
					webgpu: "enabled",
				},
			},
		};
		exporter.backpressureProfile = {
			name: "webcodecs-balanced-plus",
			maxDecodeQueue: 12,
			maxPendingFrames: 32,
			maxEncodeQueue: 72,
		};

		const report = exporter.buildLightningExportError(
			new Error(
				"[VIDEO_DECODE_ENCODING_ERROR] VideoDecoder failure: EncodingError: bad frame",
			),
		);

		expect(report).toContain("Failure code: VIDEO_DECODE_ENCODING_ERROR");
		expect(report).toContain("Failure stage: Input video decoding");
		expect(report).toContain("Output: 1200x570 @ 60 FPS; 8.00 Mbps; mode=default");
		expect(report).toContain("Recordly version: 1.4.0");
		expect(report).toContain("Runtime: RecordlyTest/1.0 Electron/43.1.0");
		expect(report).toContain("System: win32 10.0.26100 (x64); model=Custom PC");
		expect(report).toContain("CPU: AMD Ryzen 9 7900X; 24 logical processors");
		expect(report).toContain("Memory: 31.8 GB");
		expect(report).toContain("GPU 1: NVIDIA GeForce RTX 4070; active");
		expect(report).toContain(
			"GPU acceleration: video decode=enabled; video encode=enabled; WebGL=enabled; WebGPU=enabled",
		);
		expect(report).toContain("Source: h264 1920x1080 @ 30.000 FPS; 1.000s");
		expect(report).toContain("Source audio: none");
		expect(report).toContain("Progress at failure: 314/600 (52.3%) rendered frames after");
		expect(report).toContain("Media source retry: attempted with a fresh source");
		expect(report).toContain(
			"Pipeline tuning: webcodecs-balanced-plus; decode queue=12; pending frames=32; encode queue=72",
		);
		expect(report).toContain("If only this recording fails");
		expect(report).not.toContain("Windows Lightning exports can use WebCodecs or FFmpeg");
	});

	it("forwards cursor click-effect settings into the modern frame renderer", async () => {
		const { ModernVideoExporter } = await import("./modernVideoExporter");
		const { FrameRenderer } = await import("./modernFrameRenderer");
		mocks.streamingDecoderGetEffectiveDuration.mockReturnValue(1);

		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 24,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			backendPreference: "webcodecs",
			cursorClickEffect: "echo",
			cursorClickEffectColor: "#22C55E",
			cursorClickEffectScale: 1.4,
			cursorClickEffectOpacity: 0.65,
			cursorClickEffectDurationMs: 720,
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
		};

		vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(FrameRenderer).toHaveBeenCalledWith(
			expect.objectContaining({
				cursorClickEffect: "echo",
				cursorClickEffectColor: "#22C55E",
				cursorClickEffectScale: 1.4,
				cursorClickEffectOpacity: 0.65,
				cursorClickEffectDurationMs: 720,
			}),
		);
	});

	it("uses the stable Lightning render backend by default", async () => {
		const { ModernVideoExporter } = await import("./modernVideoExporter");
		const { FrameRenderer } = await import("./modernFrameRenderer");
		mocks.streamingDecoderGetEffectiveDuration.mockReturnValue(1);

		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			backendPreference: "webcodecs",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
		};

		vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(FrameRenderer).toHaveBeenCalledWith(
			expect.objectContaining({
				preferredRenderBackend: "webgl",
			}),
		);
	});

	it("allows an explicit Lightning render backend override", async () => {
		const { ModernVideoExporter } = await import("./modernVideoExporter");
		const { FrameRenderer } = await import("./modernFrameRenderer");
		mocks.streamingDecoderGetEffectiveDuration.mockReturnValue(1);

		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			backendPreference: "webcodecs",
			preferredRenderBackend: "webgpu",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
		};

		vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(FrameRenderer).toHaveBeenCalledWith(
			expect.objectContaining({
				preferredRenderBackend: "webgpu",
			}),
		);
	});
});
