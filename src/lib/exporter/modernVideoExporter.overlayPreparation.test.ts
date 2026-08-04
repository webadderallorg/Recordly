import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModernVideoExporter as ModernVideoExporterClass } from "./modernVideoExporter";
import { NATIVE_TILED_OVERLAY_TILE_SIZE } from "./nativeStaticLayoutOverlays";
import type { DecodedVideoInfo } from "./streamingDecoder";

const FRAME_BYTE_SIZE = 1920 * 1080 * 4;
const DEFAULT_FRAME_VALUE = 0xaa;
const TILE_BYTE_SIZE = NATIVE_TILED_OVERLAY_TILE_SIZE * NATIVE_TILED_OVERLAY_TILE_SIZE * 4;
const TILE_COLUMNS = Math.ceil(1920 / NATIVE_TILED_OVERLAY_TILE_SIZE);
const TILE_ROWS = Math.ceil(1080 / NATIVE_TILED_OVERLAY_TILE_SIZE);
const TILE_COUNT = TILE_COLUMNS * TILE_ROWS;
const STATIC_TILED_PAYLOAD_BYTES = TILE_COUNT * TILE_BYTE_SIZE;

const frameSource = vi.hoisted(() => {
	return {
		values: [] as number[],
		videoFrameCall: 0,
		readbackCall: 0,
		fill: (frameIndex: number, buffer: Uint8Array | Uint8ClampedArray) => {
			const value = frameSource.values[frameIndex] ?? DEFAULT_FRAME_VALUE;
			buffer.fill(value);
		},
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
		frameSource.fill(frameSource.videoFrameCall, buffer);
		frameSource.videoFrameCall += 1;
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
				const data = new Uint8ClampedArray(FRAME_BYTE_SIZE);
				frameSource.fill(frameSource.readbackCall, data);
				frameSource.readbackCall += 1;
				return { data };
			},
		};
	}
}

function fillRect(
	buffer: Uint8Array | Uint8ClampedArray,
	x: number,
	y: number,
	width: number,
	height: number,
	color: number,
): void {
	const endX = Math.min(1920, x + width);
	const endY = Math.min(1080, y + height);
	for (let rowY = y; rowY < endY; rowY += 1) {
		const rowOffset = rowY * 1920 * 4;
		for (let colX = x; colX < endX; colX += 1) {
			const pixelOffset = rowOffset + colX * 4;
			buffer[pixelOffset] = color;
			buffer[pixelOffset + 1] = color;
			buffer[pixelOffset + 2] = color;
			buffer[pixelOffset + 3] = 0xff;
		}
	}
}

function createWindowStub() {
	const streamBytes: Record<string, number> = {};
	const electronAPI = {
		openExportStream: vi.fn(async ({ extension }: { extension: string }) => {
			const streamId = `overlay-${extension}`;
			const tempPath = `C:/Temp/overlay.${extension}`;
			streamBytes[streamId] = 0;
			return { success: true, streamId, tempPath };
		}),
		writeExportStreamChunk: vi.fn(
			async (streamId: string, offset: number, chunk: Uint8Array) => {
				streamBytes[streamId] = Math.max(
					streamBytes[streamId] ?? 0,
					offset + chunk.byteLength,
				);
				return { success: true };
			},
		),
		closeExportStream: vi.fn(async (streamId: string, options?: { abort?: boolean }) => {
			const tempPath = `C:/Temp/overlay.${String(streamId).replace("overlay-", "")}`;
			if (options?.abort) {
				return { success: true, tempPath, bytesWritten: 0 };
			}
			return { success: true, tempPath, bytesWritten: streamBytes[streamId] ?? 0 };
		}),
		discardExportedTemp: vi.fn(async () => ({ success: true })),
		nativeStaticLayoutExport: vi.fn(),
		nativeStaticLayoutExportCancel: vi.fn(),
	};
	vi.stubGlobal("window", { electronAPI });
	return electronAPI;
}

function createExporter(overrides: Record<string, unknown> = {}) {
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
		...overrides,
	} as never) as unknown as {
		prepareNativeStaticLayoutOverlay: (
			videoInfo: DecodedVideoInfo,
			durationSec: number,
			totalFrames: number,
		) => Promise<{
			overlayLayers: Array<Record<string, unknown>>;
			tiledOverlayLayers: Array<Record<string, unknown>>;
			rawFallbackReason: string | null;
		} | null>;
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
		frameSource.fill = (frameIndex, buffer) => {
			const value = frameSource.values[frameIndex] ?? DEFAULT_FRAME_VALUE;
			buffer.fill(value);
		};
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it("prepares a tiled overlay sidecar for a fully static overlay", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(0);
		expect(result?.tiledOverlayLayers).toHaveLength(1);
		expect(result?.tiledOverlayLayers[0]).toMatchObject({
			id: "native-effects",
			order: 0,
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
			frameRate: 30,
			durationSec: 1,
			frameCount: 30,
			tileSize: NATIVE_TILED_OVERLAY_TILE_SIZE,
			pixelFormat: "rgba",
			payloadPath: "C:/Temp/overlay.tiledrgba",
			payloadByteLength: STATIC_TILED_PAYLOAD_BYTES,
			staticTiles: expect.any(Array),
			frameDeltas: [],
		});
		expect(result?.rawFallbackReason).toBeNull();
		expect(result?.tiledOverlayLayers[0]?.staticTiles).toHaveLength(TILE_COUNT);
		expect(mocks.frameRendererInitialize).toHaveBeenCalledTimes(1);
		expect(mocks.frameRendererRenderOverlayFrame).toHaveBeenCalledTimes(30);
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "rgba" });
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "tiledrgba" });
		expect(api.writeExportStreamChunk).toHaveBeenCalledTimes(TILE_COUNT + 1);
		const lastTiledWrite = api.writeExportStreamChunk.mock.calls[
			api.writeExportStreamChunk.mock.calls.length - 1
		] as [string, number, Uint8Array];
		expect(lastTiledWrite[0]).toBe("overlay-tiledrgba");
		expect(lastTiledWrite[1]).toBe((TILE_COUNT - 1) * TILE_BYTE_SIZE);
		expect(lastTiledWrite[2]).toHaveLength(TILE_BYTE_SIZE);
		expect(api.discardExportedTemp).toHaveBeenCalledWith("C:/Temp/overlay.rgba");
		expect(mocks.frameRendererDestroy).toHaveBeenCalledTimes(1);
		expect(exporter.nativeStaticLayoutOverlayFailure).toBeNull();
	});

	it("falls back to a raw sidecar for a fully dynamic overlay", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		frameSource.values = Array.from({ length: 30 }, (_, index) => index);
		const api = createWindowStub();

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(1);
		expect(result?.tiledOverlayLayers).toHaveLength(0);
		expect(result?.overlayLayers[0]).toMatchObject({
			id: "native-effects",
			path: "C:/Temp/overlay.rgba",
			frameCount: 30,
			pixelFormat: "rgba",
		});
		expect("effectiveFrameCount" in (result?.overlayLayers[0] ?? {})).toBe(false);
		expect(result?.rawFallbackReason).toBe("dense-frame-delta");
		expect(api.openExportStream).toHaveBeenCalledTimes(1);
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "rgba" });
		expect(api.writeExportStreamChunk).toHaveBeenCalledTimes(30);
		const lastWrite = api.writeExportStreamChunk.mock.calls[29] as [string, number, Uint8Array];
		expect(lastWrite[0]).toBe("overlay-rgba");
		expect(lastWrite[1]).toBe(29 * FRAME_BYTE_SIZE);
		expect(lastWrite[2][0]).toBe(29);
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-rgba");
	});

	it("trims the identical raw suffix and preserves the raw fallback reason", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		frameSource.values = [
			0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
			4,
		];
		const api = createWindowStub();

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers[0]).toMatchObject({
			frameCount: 30,
			effectiveFrameCount: 5,
		});
		expect(result?.rawFallbackReason).toBe("dense-frame-delta");
		expect(mocks.frameRendererRenderOverlayFrame).toHaveBeenCalledTimes(30);
		expect(api.writeExportStreamChunk).toHaveBeenCalledTimes(5);
		for (let index = 0; index < 5; index += 1) {
			const write = api.writeExportStreamChunk.mock.calls[index] as [
				string,
				number,
				Uint8Array,
			];
			expect(write[0]).toBe("overlay-rgba");
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
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 1);

		expect(result).toBeNull();
		expect(exporter.nativeStaticLayoutOverlayFailure).toMatchObject({
			stage: "overlay-renderer-frame",
			message: expect.stringContaining("Overlay renderer is not initialized"),
		});
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-rgba", { abort: true });
		expect(mocks.frameRendererDestroy).toHaveBeenCalledTimes(1);
	});

	it("records an overlay-stream-truncated failure stage when the sidecar byte count is short", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		api.closeExportStream.mockResolvedValueOnce({
			success: true,
			tempPath: "C:/Temp/overlay.rgba",
			bytesWritten: FRAME_BYTE_SIZE - 1,
		});

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(result).toBeNull();
		expect(exporter.nativeStaticLayoutOverlayFailure).toMatchObject({
			stage: "overlay-stream-truncated",
			message: expect.stringContaining(`expected ${FRAME_BYTE_SIZE} bytes`),
		});
		expect(api.discardExportedTemp).toHaveBeenCalledWith("C:/Temp/overlay.rgba");
	});

	it("records an overlay-canvas-capture failure stage when canvas readback is unavailable", async () => {
		vi.stubGlobal("VideoFrame", undefined);
		vi.stubGlobal("OffscreenCanvas", undefined);
		const api = createWindowStub();

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 1);

		expect(result).toBeNull();
		expect(exporter.nativeStaticLayoutOverlayFailure).toMatchObject({
			stage: "overlay-canvas-capture",
		});
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-rgba", { abort: true });
	});

	it("prepares a sparse tiled sidecar for a small moving-region overlay", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		frameSource.fill = (frameIndex, buffer) => {
			buffer.fill(0);
			fillRect(
				buffer,
				256,
				256,
				NATIVE_TILED_OVERLAY_TILE_SIZE,
				NATIVE_TILED_OVERLAY_TILE_SIZE,
				frameIndex + 1,
			);
		};
		const api = createWindowStub();

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(0);
		expect(result?.tiledOverlayLayers).toHaveLength(1);
		expect(result?.rawFallbackReason).toBeNull();
		const tileLayer = result?.tiledOverlayLayers[0] as Record<string, unknown>;
		expect(tileLayer.payloadByteLength).toBe(STATIC_TILED_PAYLOAD_BYTES + 29 * TILE_BYTE_SIZE);
		expect(tileLayer.frameDeltas).toHaveLength(29);
		for (let index = 0; index < 29; index += 1) {
			const delta = (
				tileLayer.frameDeltas as Array<{
					frameIndex: number;
					changedTiles: Array<{ tileIndex: number }>;
				}>
			)[index];
			expect(delta.frameIndex).toBe(index + 1);
			expect(delta.changedTiles).toHaveLength(1);
			expect(delta.changedTiles[0]?.tileIndex).toBe(2 * TILE_COLUMNS + 2);
		}
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "tiledrgba" });
		expect(api.discardExportedTemp).toHaveBeenCalledWith("C:/Temp/overlay.rgba");
	});

	it("prepares a static tiled base when the overlay is fully transparent", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		frameSource.values = Array.from({ length: 30 }, () => 0);
		createWindowStub();

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(0);
		expect(result?.tiledOverlayLayers).toHaveLength(1);
		const tileLayer = result?.tiledOverlayLayers[0] as Record<string, unknown>;
		expect(tileLayer.frameDeltas).toHaveLength(0);
		expect(tileLayer.payloadByteLength).toBe(STATIC_TILED_PAYLOAD_BYTES);
		expect(result?.rawFallbackReason).toBeNull();
	});

	it("falls back to raw when a sparse overlay becomes dense mid-timeline", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		frameSource.fill = (frameIndex, buffer) => {
			buffer.fill(0);
			if (frameIndex <= 4) {
				fillRect(
					buffer,
					256,
					256,
					NATIVE_TILED_OVERLAY_TILE_SIZE,
					NATIVE_TILED_OVERLAY_TILE_SIZE,
					frameIndex + 1,
				);
			} else {
				buffer.fill(frameIndex + 1);
			}
		};
		createWindowStub();

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(1);
		expect(result?.tiledOverlayLayers).toHaveLength(0);
		expect(result?.rawFallbackReason).toBe("dense-frame-delta");
		expect(result?.overlayLayers[0]).toMatchObject({
			path: "C:/Temp/overlay.rgba",
			frameCount: 30,
		});
		expect("effectiveFrameCount" in (result?.overlayLayers[0] ?? {})).toBe(false);
	});

	it("discards the raw sidecar and closes streams when the tiled sidecar is chosen", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(result).not.toBeNull();
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "rgba" });
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "tiledrgba" });
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-rgba");
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-tiledrgba");
		expect(api.discardExportedTemp).toHaveBeenCalledWith("C:/Temp/overlay.rgba");
		expect(mocks.frameRendererDestroy).toHaveBeenCalledTimes(1);
	});

	it("routes HEVC Hardware with overlay content to the native CUDA compositor with the tiled sidecar", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
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
		const tiledOverlayLayers = exportCall[0].tiledOverlayLayers as Array<
			Record<string, unknown>
		>;
		expect(overlayLayers ?? []).toHaveLength(0);
		expect(tiledOverlayLayers).toHaveLength(1);
		expect(tiledOverlayLayers[0]).toMatchObject({
			id: "native-effects",
			width: 1920,
			height: 1080,
			frameRate: 30,
			durationSec: 1,
			frameCount: 30,
			tileSize: NATIVE_TILED_OVERLAY_TILE_SIZE,
			pixelFormat: "rgba",
		});
		expect(exportCall[0]).toMatchObject({
			videoCodec: "hevc",
			encoderPreference: "hardware",
		});
	});
});
