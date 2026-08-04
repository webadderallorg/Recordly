import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModernVideoExporter as ModernVideoExporterClass } from "./modernVideoExporter";
import type { ExportMetrics } from "./types";

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

	it("preserves the H.264 Auto non-raw route", async () => {
		const exporter = new ModernVideoExporter({
			exportVideoCodec: "h264",
			exportEncoderPreference: "auto",
		} as never) as unknown as {
			shouldForceNativeRawFrame: () => boolean;
		};

		expect(exporter.shouldForceNativeRawFrame()).toBe(false);
	});

	it("allows eligible HEVC Auto and Hardware exports to try the GPU compositor", () => {
		const autoExporter = new ModernVideoExporter({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "auto",
			experimentalNativeExport: true,
			experimentalNvidiaCudaExport: true,
		} as never) as unknown as {
			canUseNativeGpuStaticLayout: () => boolean;
			shouldForceNativeRawFrame: () => boolean;
		};
		const hardwareExporter = new ModernVideoExporter({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			experimentalNativeExport: true,
			experimentalNvidiaCudaExport: true,
		} as never) as unknown as {
			canUseNativeGpuStaticLayout: () => boolean;
			shouldForceNativeRawFrame: () => boolean;
		};

		expect(autoExporter.canUseNativeGpuStaticLayout()).toBe(true);
		expect(autoExporter.shouldForceNativeRawFrame()).toBe(false);
		expect(hardwareExporter.canUseNativeGpuStaticLayout()).toBe(true);
		expect(hardwareExporter.shouldForceNativeRawFrame()).toBe(false);
	});

	it("keeps HEVC CPU exports on rawvideo and out of the GPU compositor", () => {
		const exporter = new ModernVideoExporter({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "cpu",
			experimentalNativeExport: true,
			experimentalNvidiaCudaExport: true,
		} as never) as unknown as {
			canUseNativeGpuStaticLayout: () => boolean;
			shouldForceNativeRawFrame: () => boolean;
		};

		expect(exporter.canUseNativeGpuStaticLayout()).toBe(false);
		expect(exporter.shouldForceNativeRawFrame()).toBe(true);
	});

	it("passes high-level HEVC preference to rawvideo without deriving encoder names", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				nativeVideoExportStart: vi.fn().mockResolvedValue({
					success: true,
					sessionId: "hevc-raw-session",
					encoderName: "hevc_nvenc",
				}),
			},
		});
		const exporter = new ModernVideoExporter({
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
		} as never) as unknown as {
			tryStartNativeVideoExportRawFrame: () => Promise<boolean>;
			encoderName: string | null;
		};

		await expect(exporter.tryStartNativeVideoExportRawFrame()).resolves.toBe(true);
		expect(window.electronAPI.nativeVideoExportStart).toHaveBeenCalledWith(
			expect.objectContaining({
				inputMode: "rawvideo",
				videoCodec: "hevc",
				encoderPreference: "hardware",
			}),
		);
		expect(exporter.encoderName).toBe("hevc_nvenc");
	});
	it("records negotiated raw transport and ACK metrics", async () => {
		const exporter = new ModernVideoExporter({} as never) as unknown as {
			buildExportMetrics: () => ExportMetrics;
			nativeTransportMode: "transferable-stream";
			nativeRawBytesSubmitted: number;
			nativeRawFramesSubmitted: number;
			nativeWriteTimeMs: number;
			nativeWriteAckTimeMs: number;
			nativeFrameTransportTimeMs: number;
			peakNativeWriteInFlightBytes: number;
		};
		exporter.nativeTransportMode = "transferable-stream";
		exporter.nativeRawBytesSubmitted = 16;
		exporter.nativeRawFramesSubmitted = 2;
		exporter.nativeWriteTimeMs = 12;
		exporter.nativeWriteAckTimeMs = 12;
		exporter.nativeFrameTransportTimeMs = 12;
		exporter.peakNativeWriteInFlightBytes = 8;

		const metrics = exporter.buildExportMetrics();

		expect(metrics.nativeTransportMode).toBe("transferable-stream");
		expect(metrics.nativeRawBytesSubmitted).toBe(16);
		expect(metrics.nativeWriteMs).toBe(12);
		expect(metrics.nativeWriteAckMs).toBe(12);
		expect(metrics.averageNativeFrameTransportMs).toBe(6);
		expect(metrics.peakNativeWriteInFlightBytes).toBe(8);
	});

	it("falls back to cloned IPC when raw channel negotiation is unavailable", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				nativeVideoExportOpenFrameChannel: vi
					.fn()
					.mockResolvedValue({ success: false, error: "probe failed" }),
				nativeVideoExportWriteFrameViaChannel: vi.fn(),
			},
		});
		const exporter = new ModernVideoExporter({} as never) as unknown as {
			negotiateNativeRawFrameTransport: (sessionId: string) => Promise<void>;
			nativeTransportMode: string | null;
			nativeTransportFallbackReason: string | null;
		};

		await exporter.negotiateNativeRawFrameTransport("session");

		expect(exporter.nativeTransportMode).toBe("cloned-ipc");
		expect(exporter.nativeTransportFallbackReason).toBe("probe failed");
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

	it("finishes eligible HEVC GPU exports before creating the canvas renderer", async () => {
		const staticLayoutResult = {
			success: true,
			tempFilePath: "C:/Temp/hevc-gpu.mp4",
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
			exportVideoCodec: "hevc",
			exportEncoderPreference: "auto",
			backendPreference: "auto",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; tempFilePath?: string }>;
			loadNativeStaticLayoutVideoInfo: () => Promise<unknown>;
			tryExportNativeStaticLayout: () => Promise<unknown>;
			tryStartNativeVideoExportRawFrame: () => Promise<boolean>;
		};

		const loadNativeStaticLayoutVideoInfo = vi
			.spyOn(exporter, "loadNativeStaticLayoutVideoInfo")
			.mockResolvedValue(mocks.videoInfo);
		const tryExportNativeStaticLayout = vi
			.spyOn(exporter, "tryExportNativeStaticLayout")
			.mockResolvedValue(staticLayoutResult);
		const tryStartNativeVideoExportRawFrame = vi
			.spyOn(exporter, "tryStartNativeVideoExportRawFrame")
			.mockResolvedValue(true);

		const result = await exporter.export();

		expect(result).toEqual(staticLayoutResult);
		expect(loadNativeStaticLayoutVideoInfo).toHaveBeenCalledTimes(1);
		expect(tryExportNativeStaticLayout).toHaveBeenCalledTimes(1);
		expect(tryStartNativeVideoExportRawFrame).not.toHaveBeenCalled();
		expect(mocks.frameRendererInitialize).not.toHaveBeenCalled();
		expect(mocks.streamingDecoderLoadMetadata).not.toHaveBeenCalled();
	});
	it("tries native CUDA static layout first for HEVC Hardware", async () => {
		const staticLayoutResult = {
			success: true,
			tempFilePath: "C:/Temp/hevc-hardware-gpu.mp4",
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
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			backendPreference: "auto",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; tempFilePath?: string }>;
			loadNativeStaticLayoutVideoInfo: () => Promise<unknown>;
			tryExportNativeStaticLayout: () => Promise<unknown>;
			tryStartNativeVideoExportRawFrame: () => Promise<boolean>;
		};

		const loadNativeStaticLayoutVideoInfo = vi
			.spyOn(exporter, "loadNativeStaticLayoutVideoInfo")
			.mockResolvedValue(mocks.videoInfo);
		const tryExportNativeStaticLayout = vi
			.spyOn(exporter, "tryExportNativeStaticLayout")
			.mockResolvedValue(staticLayoutResult);
		const tryStartNativeVideoExportRawFrame = vi
			.spyOn(exporter, "tryStartNativeVideoExportRawFrame")
			.mockResolvedValue(true);

		const result = await exporter.export();

		expect(result).toEqual(staticLayoutResult);
		expect(loadNativeStaticLayoutVideoInfo).toHaveBeenCalledTimes(1);
		expect(tryExportNativeStaticLayout).toHaveBeenCalledTimes(1);
		expect(tryStartNativeVideoExportRawFrame).not.toHaveBeenCalled();
		expect(mocks.frameRendererInitialize).not.toHaveBeenCalled();
	});

	it("falls back to HEVC rawvideo for unsupported canvas-only features", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				nativeStaticLayoutExport: vi.fn(),
				nativeStaticLayoutExportCancel: vi.fn(),
			},
		});
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
			annotationRegions: [{ id: "annotation-1", startMs: 0, endMs: 500 }],
			experimentalNativeExport: true,
			experimentalNvidiaCudaExport: true,
			exportVideoCodec: "hevc",
			exportEncoderPreference: "auto",
			backendPreference: "auto",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; tempFilePath?: string }>;
			loadNativeStaticLayoutVideoInfo: () => Promise<unknown>;
			tryStartNativeVideoExportRawFrame: () => Promise<boolean>;
			finishNativeVideoExport: () => Promise<unknown>;
			nativeStaticLayoutSkipReasons: string[];
			nativeRawFrameMode: boolean;
			configureNativeRawFrameBackpressure: () => void;
		};

		const loadNativeStaticLayoutVideoInfo = vi
			.spyOn(exporter, "loadNativeStaticLayoutVideoInfo")
			.mockResolvedValue(mocks.videoInfo);
		const tryStartNativeVideoExportRawFrame = vi
			.spyOn(exporter, "tryStartNativeVideoExportRawFrame")
			.mockImplementation(async () => {
				exporter.nativeRawFrameMode = true;
				return true;
			});
		const configureNativeRawFrameBackpressure = vi.spyOn(
			exporter,
			"configureNativeRawFrameBackpressure",
		);
		vi.spyOn(exporter, "finishNativeVideoExport").mockResolvedValue({
			success: true,
			tempFilePath: "C:/Temp/hevc-raw.mp4",
		});

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(loadNativeStaticLayoutVideoInfo).toHaveBeenCalledTimes(1);
		expect(window.electronAPI.nativeStaticLayoutExport).not.toHaveBeenCalled();
		expect(tryStartNativeVideoExportRawFrame).toHaveBeenCalledTimes(1);
		expect(exporter.nativeStaticLayoutSkipReasons).toContain(
			"native-overlay-preparation-failed",
		);
		expect(configureNativeRawFrameBackpressure).toHaveBeenCalledTimes(1);
		expect(mocks.frameRendererInitialize).toHaveBeenCalledTimes(1);
	});

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
});
