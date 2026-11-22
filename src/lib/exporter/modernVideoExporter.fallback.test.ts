import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModernVideoExporter as ModernVideoExporterClass } from "./modernVideoExporter";
import { exporterInternals } from "./modernVideoExporter.testSupport";
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
		audioCodec: undefined,
		audioSampleRate: undefined,
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
	}, 30000);
	afterEach(() => {
		vi.clearAllMocks();
		if (vi.isMockFunction(console.error)) vi.mocked(console.error).mockRestore();
		vi.unstubAllGlobals();
	});
	it.each([
		"success",
		"unavailable",
		"runtime-failure",
	])("uses the cloud encoder with bounded recovery: %s", async (scenario) => {
		vi.stubGlobal("navigator", { platform: "MacIntel" });
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 60,
			bitrate: 6_000_000,
			wallpaper: "#000000",
			deliveryProfile: "cloud",
			backendPreference: "breeze",
		} as never);
		const operations = exporterInternals(exporter).operations;
		const start = vi
			.spyOn(operations, "tryStartNativeVideoExport")
			.mockResolvedValue(scenario !== "unavailable");
		const staticLayout = vi.spyOn(operations, "tryExportNativeStaticLayout");
		const initialize = vi
			.spyOn(operations, "initializeEncoder")
			.mockResolvedValue({ codec: "avc1.640033", hardwareAcceleration: "prefer-hardware" });
		vi.spyOn(operations, "finishNativeVideoExport").mockResolvedValue(
			scenario === "runtime-failure"
				? { success: false, error: "Cloud encoder stopped" }
				: { success: true, tempFilePath: "/tmp/cloud.mp4" },
		);
		const result = await exporter.export();
		expect(result.success).toBe(true);
		expect(start).toHaveBeenCalledTimes(1);
		expect(staticLayout).not.toHaveBeenCalled();
		expect(initialize).toHaveBeenCalledTimes(scenario === "success" ? 0 : 1);
		expect(exporterInternals(exporter).session.config.bitrate).toBe(6_000_000);
	});
	it.each(
		[
			{
				name: "cloud",
				platform: "MacIntel",
				backendPreference: "webcodecs",
				deliveryProfile: "cloud",
				staticRoute: false,
			},
			{
				name: "platform auto",
				platform: "MacIntel",
				backendPreference: "auto",
				staticRoute: false,
			},
			{
				name: "auto software escalation",
				platform: "Linux x86_64",
				backendPreference: "auto",
				staticRoute: false,
			},
			{
				name: "Breeze static",
				platform: "Linux x86_64",
				backendPreference: "breeze",
				staticRoute: true,
			},
			{
				name: "experimental static",
				platform: "Linux x86_64",
				backendPreference: "webcodecs",
				experimentalNvidiaCudaExport: true,
				staticRoute: true,
			},
		].flatMap((scenario) =>
			[undefined, false, true].map((forceSoftwareEncoding) => ({
				...scenario,
				forceSoftwareEncoding,
			})),
		),
	)("respects forceSoftwareEncoding=$forceSoftwareEncoding across $name export routing", async ({
		platform,
		backendPreference,
		deliveryProfile,
		experimentalNvidiaCudaExport,
		staticRoute,
		forceSoftwareEncoding,
	}) => {
		vi.stubGlobal("navigator", { platform });
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#000000",
			backendPreference,
			preferredRenderBackend: "webgpu",
			deliveryProfile,
			experimentalNvidiaCudaExport,
			forceSoftwareEncoding,
		} as never);
		const operations = exporterInternals(exporter).operations;
		const nativeStart = vi
			.spyOn(operations, "tryStartNativeVideoExport")
			.mockResolvedValue(true);
		const staticLayout = vi
			.spyOn(operations, "tryExportNativeStaticLayout")
			.mockResolvedValue({ success: true, tempFilePath: "/tmp/static.mp4" });
		vi.spyOn(operations, "loadNativeStaticLayoutVideoInfo").mockResolvedValue(mocks.videoInfo);
		vi.spyOn(operations, "finishNativeVideoExport").mockResolvedValue({
			success: true,
			tempFilePath: "/tmp/native.mp4",
		});
		const initialize = vi
			.spyOn(operations, "initializeEncoder")
			.mockResolvedValue({ codec: "avc1.640033", hardwareAcceleration: "prefer-software" });
		const result = await exporter.export();
		expect(result.success).toBe(true);
		if (forceSoftwareEncoding) {
			expect(nativeStart).not.toHaveBeenCalled();
			expect(staticLayout).not.toHaveBeenCalled();
			expect(initialize).toHaveBeenCalledOnce();
			const { FrameRenderer } = await import("./modernFrameRenderer");
			expect(FrameRenderer).toHaveBeenCalledWith(
				expect.objectContaining({
					width: 1920,
					height: 1080,
					preferredRenderBackend: "webgpu",
				}),
			);
		} else {
			expect(staticLayout).toHaveBeenCalledTimes(staticRoute ? 1 : 0);
			expect(nativeStart).toHaveBeenCalledTimes(staticRoute ? 0 : 1);
		}
		expect(exporterInternals(exporter).session.config.bitrate).toBe(8_000_000);
	});
	it("fails forced software cleanly when software WebCodecs is unavailable without retrying native hardware", async () => {
		vi.stubGlobal("navigator", { platform: "Linux x86_64" });
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#000000",
			backendPreference: "auto",
			forceSoftwareEncoding: true,
		} as never);
		const operations = exporterInternals(exporter).operations;
		const nativeStart = vi
			.spyOn(operations, "tryStartNativeVideoExport")
			.mockResolvedValue(true);
		const staticLayout = vi.spyOn(operations, "tryExportNativeStaticLayout");
		vi.spyOn(operations, "initializeEncoder").mockRejectedValue(
			new Error("Software encoder unavailable"),
		);
		vi.spyOn(operations, "finishNativeVideoExport").mockResolvedValue({
			success: true,
			tempFilePath: "/tmp/native.mp4",
		});
		const result = await exporter.export();
		expect(result.success).toBe(false);
		expect(result.error).toContain("Software encoder unavailable");
		expect(nativeStart).not.toHaveBeenCalled();
		expect(staticLayout).not.toHaveBeenCalled();
	});

	it("removes failed native writes without creating an unhandled rejection", async () => {
		const exporter = new ModernVideoExporter({} as never);
		const write = Promise.reject(new Error("Native write failed"));
		exporterInternals(exporter).session.flow.trackNativeWritePromise(write);
		await expect(write).rejects.toThrow("Native write failed");
		expect(exporterInternals(exporter).session.flow.nativeWritePromises.size).toBe(0);
	});
	it.each([
		"returned",
		"thrown",
		"write",
		"cancelled",
		"both-fail",
		"decode",
	])("handles a native runtime failure: %s", async (failure) => {
		vi.stubGlobal("navigator", { platform: "Win32" });
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8000000,
			wallpaper: "#000000",
			backendPreference: "auto",
		} as never);
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const start = vi
			.spyOn(exporterInternals(exporter).operations, "tryStartNativeVideoExport")
			.mockResolvedValue(true);
		const initialize = vi
			.spyOn(exporterInternals(exporter).operations, "initializeEncoder")
			.mockImplementation(async () => {
				if (failure === "both-fail") throw new Error("WebCodecs unavailable");
				return { codec: "avc1.640033", hardwareAcceleration: "prefer-hardware" };
			});
		vi.spyOn(
			exporterInternals(exporter).operations,
			"finishNativeVideoExport",
		).mockImplementation(async () => {
			if (failure === "cancelled") exporter.cancel();
			if (failure === "thrown" || failure === "cancelled")
				throw new Error("Native finish failed");
			return { success: false, error: "Native finish failed" };
		});
		if (failure === "write" || failure === "decode") {
			mocks.streamingDecoderDecodeAll.mockImplementationOnce(async () => {
				const error = new Error(
					failure === "write" ? "Native write failed" : "Source decode failed",
				);
				if (failure === "write")
					exporterInternals(exporter).session.native.nativeEncoderError = error;
				throw error;
			});
		}
		const result = await exporter.export();
		if (failure !== "cancelled" && failure !== "decode") {
			expect(
				(
					result as {
						metrics?: ExportMetrics;
					}
				).metrics?.diagnostics?.attempts,
			).toContainEqual(
				expect.objectContaining({
					route: "native-stream",
					status: "retry",
					reason: expect.stringContaining("Native"),
				}),
			);
		}
		expect(start).toHaveBeenCalledTimes(1);
		const shouldRetry = failure !== "cancelled" && failure !== "decode";
		expect(initialize).toHaveBeenCalledTimes(shouldRetry ? 1 : 0);
		expect(result.success).toBe(shouldRetry && failure !== "both-fail");
		if (shouldRetry)
			expect(log).toHaveBeenCalledWith(
				expect.stringContaining("restarting once with WebCodecs"),
			);
		if (failure === "both-fail") {
			expect(result.error).toContain("Native finish failed");
			expect(result.error).toContain("WebCodecs unavailable");
		}
		if (failure === "cancelled") expect(result.error).toBe("Export cancelled");
	});
	it("falls back to WebCodecs instead of surfacing a native error when Breeze is unavailable", async () => {
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8000000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			experimentalNativeExport: true,
			backendPreference: "breeze",
		} as never);
		vi.spyOn(
			exporterInternals(exporter).operations,
			"loadNativeStaticLayoutVideoInfo",
		).mockResolvedValue(mocks.videoInfo);
		vi.spyOn(
			exporterInternals(exporter).operations,
			"tryExportNativeStaticLayout",
		).mockResolvedValue(null);
		vi.spyOn(
			exporterInternals(exporter).operations,
			"tryStartNativeVideoExport",
		).mockImplementation(async () => {
			exporterInternals(exporter).session.native.lastNativeExportError =
				"Breeze native encoder unavailable";
			return false;
		});
		const initializeEncoder = vi
			.spyOn(exporterInternals(exporter).operations, "initializeEncoder")
			.mockResolvedValue({
				codec: "avc1.640034",
				hardwareAcceleration: "prefer-hardware",
			});
		const result = await exporter.export();
		expect(result.success).toBe(true);
		expect(result.error).toBeUndefined();
		expect(result.blob).toBeInstanceOf(Blob);
		expect(initializeEncoder).toHaveBeenCalledTimes(1);
		expect(mocks.muxerFinalize).toHaveBeenCalledTimes(1);
	}, 15000);
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
			bitrate: 8000000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			experimentalNativeExport: true,
			backendPreference: "auto",
		} as never);
		const loadNativeStaticLayoutVideoInfo = vi.spyOn(
			exporterInternals(exporter).operations,
			"loadNativeStaticLayoutVideoInfo",
		);
		const tryExportNativeStaticLayout = vi.spyOn(
			exporterInternals(exporter).operations,
			"tryExportNativeStaticLayout",
		);
		const tryStartNativeVideoExport = vi
			.spyOn(exporterInternals(exporter).operations, "tryStartNativeVideoExport")
			.mockResolvedValue(true);
		const finishNativeVideoExport = vi
			.spyOn(exporterInternals(exporter).operations, "finishNativeVideoExport")
			.mockResolvedValue(nativeResult);
		const result = await exporter.export();
		expect(result.success).toBe(true);
		expect(result.blob).toBe(nativeResult.blob);
		expect(tryStartNativeVideoExport).toHaveBeenCalledTimes(1);
		expect(loadNativeStaticLayoutVideoInfo).not.toHaveBeenCalled();
		expect(tryExportNativeStaticLayout).not.toHaveBeenCalled();
		expect(mocks.streamingDecoderLoadMetadata).toHaveBeenCalledTimes(1);
		expect(finishNativeVideoExport).toHaveBeenCalledTimes(1);
	}, 15000);
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
			bitrate: 8000000,
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
		} as never);
		const initializeEncoder = vi
			.spyOn(exporterInternals(exporter).operations, "initializeEncoder")
			.mockResolvedValue({
				codec: "avc1.640034",
				hardwareAcceleration: "prefer-hardware",
			});
		const loadNativeStaticLayoutVideoInfo = vi
			.spyOn(exporterInternals(exporter).operations, "loadNativeStaticLayoutVideoInfo")
			.mockResolvedValue(mocks.videoInfo);
		const tryExportNativeStaticLayout = vi
			.spyOn(exporterInternals(exporter).operations, "tryExportNativeStaticLayout")
			.mockResolvedValue(staticLayoutResult);
		const tryStartNativeVideoExport = vi
			.spyOn(exporterInternals(exporter).operations, "tryStartNativeVideoExport")
			.mockResolvedValue(true);
		const result = await exporter.export();
		expect(result).toBe(staticLayoutResult);
		expect(loadNativeStaticLayoutVideoInfo).toHaveBeenCalledTimes(1);
		expect(tryExportNativeStaticLayout).toHaveBeenCalledTimes(1);
		expect(tryStartNativeVideoExport).not.toHaveBeenCalled();
		expect(initializeEncoder).not.toHaveBeenCalled();
		expect(mocks.streamingDecoderLoadMetadata).not.toHaveBeenCalled();
	}, 15000);
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
			bitrate: 8000000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			backendPreference: "webcodecs",
		} as never);
		vi.spyOn(exporterInternals(exporter).operations, "initializeEncoder").mockResolvedValue({
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
			bitrate: 8000000,
			backendPreference: "auto",
		} as never);
		exporterInternals(exporter).session.sourceVideoInfo = mocks.videoInfo;
		exporterInternals(exporter).session.metrics.renderBackend = "webgpu";
		exporterInternals(exporter).session.metrics.encodeBackend = "ffmpeg";
		exporterInternals(exporter).session.metrics.encoderName = "h264-stream-copy";
		exporterInternals(exporter).session.metrics.processedFrameCount = 314;
		exporterInternals(exporter).session.metrics.totalExportStartTimeMs = 1;
		exporterInternals(exporter).session.metrics.mediaSourceRetryAttempted = true;
		exporterInternals(exporter).session.effectiveDurationSec = 10;
		exporterInternals(exporter).session.metrics.runtimeDiagnostics = {
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
		exporterInternals(exporter).session.backpressureProfile = {
			name: "webcodecs-balanced-plus",
			maxDecodeQueue: 12,
			maxPendingFrames: 32,
			maxEncodeQueue: 72,
			maxInFlightNativeWrites: 1,
		};
		const report = exporterInternals(exporter).operations.buildLightningExportError(
			new Error(
				"[VIDEO_DECODE_ENCODING_ERROR] VideoDecoder failure: EncodingError: bad frame",
			),
		);
		expect(report).toContain("Failure code: VIDEO_DECODE_ENCODING_ERROR");
		expect(report).toContain("Failure stage: Input video decoding");
		expect(report).toContain("Output: 1200x570 @ 60 FPS; 8.00 Mbps; mode=default");
		expect(report).toContain("Recordly version: 1.4.0");
		expect(report).toContain(
			"Browser user agent (compatibility string): RecordlyTest/1.0 Electron/43.1.0",
		);
		expect(report).toContain(
			"System: win32 (Electron process=x64); kernel release=10.0.26100; model=Custom PC",
		);
		expect(report).toContain("CPU: AMD Ryzen 9 7900X; 24 logical processors");
		expect(report).toContain("Memory: 31.8 GB");
		expect(report).toContain("GPU 1: NVIDIA GeForce RTX 4070; active");
		expect(report).toContain(
			"GPU acceleration: video decode=enabled; video encode=enabled; WebGL=enabled; WebGPU=enabled",
		);
		expect(report).toContain("Source: h264 1920x1080 @ 30.000 FPS; 1.000s");
		expect(report).toContain("Source audio: none");
		expect(report).toContain(
			"Progress at failure: 314/600 (52.3%) reported output frames after",
		);
		expect(report).toContain("Media source retry: attempted with a fresh source");
		expect(report).toContain(
			"Pipeline tuning: webcodecs-balanced-plus; configured decode queue=12; configured pending frames=32",
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
			bitrate: 8000000,
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
		} as never);
		vi.spyOn(exporterInternals(exporter).operations, "initializeEncoder").mockResolvedValue({
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
	it("reports WebCodecs encoding separately from FFmpeg stream packaging", async () => {
		mocks.streamingDecoderGetEffectiveDuration.mockReturnValue(1);
		vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
		vi.stubGlobal(
			"VideoEncoder",
			class {
				static isConfigSupported = async () => ({ supported: true });
				state = "unconfigured";
				encodeQueueSize = 0;
				configure() {
					this.state = "configured";
				}
				async flush() {}
				close() {
					this.state = "closed";
				}
			},
		);
		vi.stubGlobal("window", {
			electronAPI: {
				getAppVersion: async () => "1.4.0",
				getExportHardwareInfo: async () => ({
					success: true,
					hardware: {
						platform: "win32",
						arch: "x64",
						gpus: [{ name: "Intel Graphics", vendor: "Intel", active: true }],
						gpuFeatures: {
							videoEncode: "enabled",
							videoDecode: "enabled",
							webgl: "enabled",
							webgpu: "enabled",
						},
					},
				}),
				nativeVideoExportStart: async () => ({ success: true, sessionId: "test-session" }),
				nativeVideoExportFinish: async () => ({
					success: true,
					tempPath: "/tmp/export.mp4",
					encoderName: "h264-stream-copy",
				}),
				nativeVideoExportCancel: async () => ({ success: true }),
			},
		});
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///source.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8000000,
			wallpaper: "#000000",
			zoomRegions: [],
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			backendPreference: "auto",
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
		});
		const result = await exporter.export();
		expect(result.success).toBe(true);
		expect(result.metrics?.diagnostics).toMatchObject({
			requestedBackend: "auto",
			muxer: "ffmpeg-stream-copy",
			encoder: {
				api: "webcodecs",
				codec: "avc1.640034",
				hardwareAcceleration: "prefer-hardware",
				hardwareEncoder: "not-exposed-by-webcodecs",
			},
			environment: {
				platform: "win32",
				arch: "x64",
				hardwareInfoStatus: "available",
				gpus: [{ name: "Intel Graphics", vendor: "Intel", active: true }],
			},
		});
		expect(result.metrics?.diagnostics?.attempts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					route: "native-static-layout",
					status: "skipped",
					reason: "windows-auto-static-layout-disabled",
				}),
				expect.objectContaining({ route: "native-stream", status: "selected" }),
			]),
		);
	});
	it("bounds hardware diagnostic collection and ignores late replies", async () => {
		vi.useFakeTimers();
		try {
			let reply: (value: unknown) => void = () => {};
			vi.stubGlobal("window", {
				electronAPI: {
					getAppVersion: async () => "1.4.0",
					getExportHardwareInfo: () =>
						new Promise((resolve) => {
							reply = resolve;
						}),
				},
			});
			const exporter = new ModernVideoExporter({} as never);
			const pending = exporterInternals(exporter).operations.collectRuntimeDiagnostics();
			await vi.advanceTimersByTimeAsync(1500);
			const snapshot = await pending;
			expect(snapshot).toMatchObject({
				appVersion: "1.4.0",
				hardwareInfoStatus: "timed-out",
			});
			reply({ success: true, hardware: { platform: "win32" } });
			await Promise.resolve();
			expect(snapshot.hardware).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});
