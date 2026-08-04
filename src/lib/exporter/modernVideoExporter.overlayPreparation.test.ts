import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModernVideoExporter as ModernVideoExporterClass } from "./modernVideoExporter";
import type { DecodedVideoInfo } from "./streamingDecoder";

const FRAME_BYTE_SIZE = 1920 * 1080 * 4;
const DEFAULT_FRAME_VALUE = 0xaa;

const frameSource = vi.hoisted(() => {
	return {
		// Per-capture fill values; consecutive captured RGBA frames are byte-compared
		// by the exporter, so tests control dedup by choosing constant vs varying
		// values. Works for both capture paths (VideoFrame copyTo and readback).
		values: [] as number[],
		videoFrameCall: 0,
		readbackCall: 0,
	};
});

const mocks = vi.hoisted(() => {
	const rendererCanvas = {
		width: 1920,
		height: 1080,
	};
	const framesRendered: number[] = [];

	return {
		framesRendered,
		rendererCanvas,
		frameRendererDestroy: vi.fn(),
		frameRendererGetCanvas: vi.fn(() => rendererCanvas),
		frameRendererInitialize: vi.fn(async () => {}),
		frameRendererRenderOverlayFrame: vi.fn(async (timestampUs: number) => {
			framesRendered.push(timestampUs);
		}),
	};
});

vi.mock("./modernFrameRenderer", () => ({
	FrameRenderer: vi.fn().mockImplementation(function () {
		return {
			destroy: mocks.frameRendererDestroy,
			getCanvas: mocks.frameRendererGetCanvas,
			initialize: mocks.frameRendererInitialize,
			renderOverlayFrame: mocks.frameRendererRenderOverlayFrame,
		};
	}),
}));

class FakeVideoFrame {
	constructor(
		public readonly source: unknown,
		public readonly init: { timestamp?: number } = {},
	) {}

	async copyTo(
		buffer: Uint8Array,
		options: { format?: string; layout?: Array<{ offset: number; stride: number }> },
	): Promise<void> {
		const value = frameSource.values[frameSource.videoFrameCall] ?? DEFAULT_FRAME_VALUE;
		frameSource.videoFrameCall += 1;
		buffer.fill(value);
		void options;
	}

	close(): void {
		// no-op
	}
}

class FakeOffscreenCanvas {
	width = 1920;
	height = 1080;

	getContext(): {
		clearRect: () => void;
		drawImage: () => void;
		getImageData: () => { data: Uint8ClampedArray };
	} {
		return {
			clearRect: () => undefined,
			drawImage: () => undefined,
			getImageData: () => {
				const value = frameSource.values[frameSource.readbackCall] ?? DEFAULT_FRAME_VALUE;
				frameSource.readbackCall += 1;
				const data = new Uint8ClampedArray(FRAME_BYTE_SIZE);
				data.fill(value);
				return { data };
			},
		};
	}
}

function createWindowStub(overrides: Record<string, unknown> = {}) {
	const electronAPI = {
		openExportStream: vi.fn(async () => ({
			success: true,
			streamId: "overlay-stream",
			tempPath: "C:/Temp/overlay.rgba",
		})),
		writeExportStreamChunk: vi.fn(async () => ({ success: true })),
		closeExportStream: vi.fn(async () => ({
			success: true,
			tempPath: "C:/Temp/overlay.rgba",
			bytesWritten: 0,
		})),
		discardExportedTemp: vi.fn(async () => ({ success: true })),
		nativeStaticLayoutExport: vi.fn(),
		nativeStaticLayoutExportCancel: vi.fn(),
	};
	vi.stubGlobal("window", {
		electronAPI,
		...overrides,
	});
	return electronAPI;
}

function createExporter() {
	return new ModernVideoExporter({
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
		cursorTelemetry: [{ timeMs: 0, cx: 0.25, cy: 0.35 }],
		showCursor: true,
		experimentalNativeExport: true,
		experimentalNvidiaCudaExport: true,
		exportVideoCodec: "hevc",
		exportEncoderPreference: "hardware",
		backendPreference: "auto",
	} as never) as unknown as {
		prepareNativeStaticLayoutOverlay: (
			videoInfo: DecodedVideoInfo,
			durationSec: number,
			totalFrames: number,
		) => Promise<Array<Record<string, unknown>> | null>;
		nativeStaticLayoutOverlayFailure: { stage: string; message: string } | null;
		hasNativeStaticLayoutOverlayContent: () => boolean;
		tryExportNativeStaticLayout: (
			videoInfo: DecodedVideoInfo,
			audioPlan: unknown,
			effectiveDurationSec: number,
			totalFrames: number,
		) => Promise<{ success: boolean; tempFilePath?: string; error?: string } | null>;
	};
}

const videoInfo: DecodedVideoInfo = {
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

let ModernVideoExporter: typeof ModernVideoExporterClass;

describe("ModernVideoExporter native overlay preparation", () => {
	beforeAll(async () => {
		({ ModernVideoExporter } = await import("./modernVideoExporter"));
	}, 30_000);

	afterEach(() => {
		frameSource.values = [];
		frameSource.videoFrameCall = 0;
		frameSource.readbackCall = 0;
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it("prepares a minimal overlay sidecar end-to-end through the export stream API", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		// All captured frames are byte-identical (constant fill), so the sidecar
		// deduplicates to the single changed frame.
		api.closeExportStream.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/overlay.rgba",
			bytesWritten: FRAME_BYTE_SIZE,
		});

		const exporter = createExporter();
		const layers = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(layers).not.toBeNull();
		expect(layers).toHaveLength(1);
		expect(layers?.[0]).toMatchObject({
			id: "native-effects",
			order: 0,
			path: "C:/Temp/overlay.rgba",
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
			frameRate: 30,
			durationSec: 1,
			frameCount: 30,
			effectiveFrameCount: 1,
			pixelFormat: "rgba",
		});
		expect(mocks.frameRendererInitialize).toHaveBeenCalledTimes(1);
		// Every timeline frame is still rendered so dynamic content is detected.
		expect(mocks.frameRendererRenderOverlayFrame).toHaveBeenCalledTimes(30);
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "rgba" });
		expect(api.writeExportStreamChunk).toHaveBeenCalledTimes(1);
		const onlyWrite = api.writeExportStreamChunk.mock.calls[0] as [string, number, Uint8Array];
		expect(onlyWrite[0]).toBe("overlay-stream");
		expect(onlyWrite[1]).toBe(0);
		expect(onlyWrite[2]).toHaveLength(FRAME_BYTE_SIZE);
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-stream");
		expect(mocks.frameRendererDestroy).toHaveBeenCalledTimes(1);
		expect(exporter.nativeStaticLayoutOverlayFailure).toBeNull();
	});

	it("writes every frame for a fully dynamic overlay and omits the effective frame count", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		frameSource.values = Array.from({ length: 30 }, (_, index) => index);
		const api = createWindowStub();
		api.closeExportStream.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/overlay.rgba",
			bytesWritten: FRAME_BYTE_SIZE * 30,
		});

		const exporter = createExporter();
		const layers = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(layers).not.toBeNull();
		expect(layers?.[0]).toMatchObject({
			frameCount: 30,
		});
		expect("effectiveFrameCount" in (layers?.[0] ?? {})).toBe(false);
		expect(api.writeExportStreamChunk).toHaveBeenCalledTimes(30);
		const lastWrite = api.writeExportStreamChunk.mock.calls[29] as [string, number, Uint8Array];
		expect(lastWrite[1]).toBe(29 * FRAME_BYTE_SIZE);
		expect(lastWrite[2][0]).toBe(29);
	});

	it("writes the exact prefix when a dynamic overlay freezes into an identical suffix", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		// Frames 0..4 change; frames 5..29 are identical to frame 4.
		frameSource.values = [
			0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
			4,
		];
		const api = createWindowStub();
		api.closeExportStream.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/overlay.rgba",
			bytesWritten: FRAME_BYTE_SIZE * 5,
		});

		const exporter = createExporter();
		const layers = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(layers).not.toBeNull();
		expect(layers?.[0]).toMatchObject({
			frameCount: 30,
			effectiveFrameCount: 5,
		});
		// Every frame is still rendered; only the identical suffix is trimmed.
		expect(mocks.frameRendererRenderOverlayFrame).toHaveBeenCalledTimes(30);
		expect(api.writeExportStreamChunk).toHaveBeenCalledTimes(5);
		for (let index = 0; index < 5; index += 1) {
			const write = api.writeExportStreamChunk.mock.calls[index] as [
				string,
				number,
				Uint8Array,
			];
			expect(write[1]).toBe(index * FRAME_BYTE_SIZE);
			expect(write[2][0]).toBe(index);
			expect(write[2]).toHaveLength(FRAME_BYTE_SIZE);
		}
	});

	it("records an overlay-renderer-frame failure stage when the overlay frame render throws", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		mocks.frameRendererRenderOverlayFrame.mockRejectedValueOnce(
			new Error("Overlay renderer is not initialized"),
		);

		const exporter = createExporter();
		const layers = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 1);

		expect(layers).toBeNull();
		expect(exporter.nativeStaticLayoutOverlayFailure).toMatchObject({
			stage: "overlay-renderer-frame",
			message: expect.stringContaining("Overlay renderer is not initialized"),
		});
		// The failed stream must be aborted so a half-written sidecar never reaches
		// the native CUDA compositor.
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-stream", { abort: true });
		expect(mocks.frameRendererDestroy).toHaveBeenCalledTimes(1);
	});

	it("records an overlay-stream-truncated failure stage when the sidecar byte count is short", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		api.closeExportStream.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/overlay.rgba",
			bytesWritten: FRAME_BYTE_SIZE - 1,
		});

		const exporter = createExporter();
		const layers = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(layers).toBeNull();
		expect(exporter.nativeStaticLayoutOverlayFailure).toMatchObject({
			stage: "overlay-stream-truncated",
			message: expect.stringContaining(`expected ${FRAME_BYTE_SIZE} bytes`),
		});
		// The stream closed successfully, so the sidecar must be discarded rather
		// than aborted (abort-close on a finalized stream is a no-op).
		expect(api.discardExportedTemp).toHaveBeenCalledWith("C:/Temp/overlay.rgba");
	});

	it("records an overlay-canvas-capture failure stage when canvas readback is unavailable", async () => {
		vi.stubGlobal("VideoFrame", undefined);
		vi.stubGlobal("OffscreenCanvas", undefined);
		const api = createWindowStub();

		const exporter = createExporter();
		const layers = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 1);

		expect(layers).toBeNull();
		expect(exporter.nativeStaticLayoutOverlayFailure).toMatchObject({
			stage: "overlay-canvas-capture",
		});
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-stream", { abort: true });
	});

	it("routes HEVC Hardware with overlay content to the native CUDA compositor with the sidecar", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		api.closeExportStream.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/overlay.rgba",
			bytesWritten: FRAME_BYTE_SIZE,
		});
		api.nativeStaticLayoutExport.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/hevc-static.mp4",
			videoCodec: "hevc",
			encoderPreference: "hardware",
			route: "nvidia-cuda-compositor",
			encoderName: "nvidia-cuda-compositor",
			metrics: {
				chunkCount: 1,
				chunkDurationSec: 120,
				chunkExecMs: 0,
				chunks: [],
			},
		});

		const exporter = createExporter();
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toMatchObject({ success: true, tempFilePath: "C:/Temp/hevc-static.mp4" });
		const exportCall = api.nativeStaticLayoutExport.mock.calls[0] as [Record<string, unknown>];
		const overlayLayers = exportCall[0].overlayLayers as Array<Record<string, unknown>>;
		expect(overlayLayers).toHaveLength(1);
		expect(overlayLayers[0]).toMatchObject({
			id: "native-effects",
			path: "C:/Temp/overlay.rgba",
			width: 1920,
			height: 1080,
			frameRate: 30,
			durationSec: 1,
			frameCount: 30,
			effectiveFrameCount: 1,
			pixelFormat: "rgba",
		});
		expect(exportCall[0]).toMatchObject({
			videoCodec: "hevc",
			encoderPreference: "hardware",
		});
		expect(api.writeExportStreamChunk).toHaveBeenCalledTimes(1);
	});
});
