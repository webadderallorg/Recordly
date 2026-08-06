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
		// Cursor-sprite capture defaults to unavailable so the baked-cursor
		// full-canvas sidecar fallback is the default behavior. Dedicated
		// cursor-sprite tests override these to exercise the sprite success path.
		frameRendererStartCursorSpriteCapture: vi.fn(() => false),
		frameRendererCaptureCursorSpriteFrame: vi.fn(() => ({
			captured: false,
			unavailableReason: "cursor sprite unavailable (mock)",
		})),
		frameRendererFinishCursorSpriteCapture: vi.fn(() => null),
		frameRendererCancelCursorSpriteCapture: vi.fn(() => {}),
	};
});

vi.mock("./modernFrameRenderer", () => ({
	FrameRenderer: vi.fn().mockImplementation(function () {
		return {
			destroy: mocks.frameRendererDestroy,
			getCanvas: mocks.frameRendererGetCanvas,
			initialize: mocks.frameRendererInitialize,
			renderOverlayFrame: mocks.frameRendererRenderOverlayFrame,
			startCursorSpriteCapture: mocks.frameRendererStartCursorSpriteCapture,
			captureCursorSpriteFrame: mocks.frameRendererCaptureCursorSpriteFrame,
			finishCursorSpriteCapture: mocks.frameRendererFinishCursorSpriteCapture,
			cancelCursorSpriteCapture: mocks.frameRendererCancelCursorSpriteCapture,
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
			cursorExcluded?: boolean,
			onPreparationProgress?: (renderProgress: number) => void,
		) => Promise<{
			overlayLayers: Array<Record<string, unknown>>;
			tiledOverlayLayers: Array<Record<string, unknown>>;
			rawFallbackReason: string | null;
		} | null>;
		nativeStaticLayoutOverlayFailure: { stage: string; message: string } | null;
		nativeStaticLayoutSkipReason: string | null;
		nativeStaticLayoutSkipReasons: string[];
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
		// Reset cursor-sprite mock implementations so the default (unavailable)
		// fallback applies unless a test explicitly opts into the sprite path.
		mocks.frameRendererStartCursorSpriteCapture.mockReset();
		mocks.frameRendererCaptureCursorSpriteFrame.mockReset();
		mocks.frameRendererFinishCursorSpriteCapture.mockReset();
		mocks.frameRendererCancelCursorSpriteCapture.mockReset();
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
		// The cursor-sprite path is attempted first (atlas not actually owned) and
		// falls back to the baked sidecar when sprite capture is unavailable, so
		// the overlay renderer is initialized once for the sprite attempt and
		// once for the baked full-canvas sidecar.
		expect(mocks.frameRendererInitialize).toHaveBeenCalledTimes(2);
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
		expect(mocks.frameRendererDestroy).toHaveBeenCalledTimes(2);
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
		// sprite + json export streams (sprite attempt) plus the baked rgba stream.
		expect(api.openExportStream).toHaveBeenCalledTimes(3);
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
		// One renderer for the sprite attempt, one for the baked sidecar.
		expect(mocks.frameRendererDestroy).toHaveBeenCalledTimes(2);
	});

	it("records an overlay-stream-truncated failure stage when the sidecar byte count is short", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		// Only the baked rgba stream finalize returns the truncated byte count;
		// the cursor-sprite abort closes (sprite/json) return their defaults.
		api.closeExportStream.mockImplementation(
			async (streamId: string, options?: { abort?: boolean }) => {
				const tempPath = `C:/Temp/overlay.${String(streamId).replace("overlay-", "")}`;
				if (options?.abort) {
					return { success: true, tempPath, bytesWritten: 0 };
				}
				return {
					success: true,
					tempPath,
					bytesWritten: streamId === "overlay-rgba" ? FRAME_BYTE_SIZE - 1 : 0,
				};
			},
		);

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
		expect(mocks.frameRendererDestroy).toHaveBeenCalledTimes(2);
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

		// Cursor motion blur is a browser-rendered effect, so the cursor is baked
		// into the transparent overlay sidecar (cursor-sidecar) rather than owned
		// natively. This keeps the overlay-content path using existing preparation
		// even when the deterministic no-browser-overlay fast lane is otherwise
		// eligible.
		const exporter = createExporter({ cursorMotionBlur: 1 });
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

	it("returns no overlay sidecar when native CUDA owns the cursor and there are no browser-rendered pixels", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();

		// cursorTelemetry + showCursor are set, but cursor render is excluded from
		// the sidecar (native ownership) and there are no captions/annotations/
		// webcam/frame pixels, so the empty validated representation is correct.
		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30, true);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(0);
		expect(result?.tiledOverlayLayers).toHaveLength(0);
		expect(result?.rawFallbackReason).toBeNull();
		expect(mocks.frameRendererInitialize).not.toHaveBeenCalled();
		expect(mocks.frameRendererRenderOverlayFrame).not.toHaveBeenCalled();
		expect(api.openExportStream).not.toHaveBeenCalled();
		expect(mocks.frameRendererDestroy).not.toHaveBeenCalled();
	});

	it("still prepares the overlay sidecar when browser-rendered pixels coexist with native cursor ownership", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();

		const exporter = createExporter({ frame: { enabled: true, width: 400, height: 300 } });
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30, true);

		expect(result).not.toBeNull();
		expect(mocks.frameRendererInitialize).toHaveBeenCalledTimes(1);
		expect(mocks.frameRendererRenderOverlayFrame).toHaveBeenCalledTimes(30);
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "rgba" });
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "tiledrgba" });
		expect(result?.tiledOverlayLayers).toHaveLength(1);
		expect(result?.rawFallbackReason).toBeNull();
	});

	it("coalesces and throttles preparation progress during tiled sidecar generation", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		createWindowStub();

		const prepProgress: number[] = [];
		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(
			videoInfo,
			1,
			30,
			false,
			false,
			(renderProgress) => prepProgress.push(renderProgress),
		);

		expect(result).not.toBeNull();
		// Every frame is identical, so all 30 frames would emit a raw per-frame
		// update without coalescing. The bounded cadence must stay far below that.
		expect(prepProgress.length).toBeGreaterThan(0);
		expect(prepProgress.length).toBeLessThan(30);
		for (const value of prepProgress) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(100);
		}
	});

	it("records a cancellation failure and aborts the overlay stream when cancelled mid-preparation", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();

		const exporter = createExporter();
		(exporter as unknown as { cancelled: boolean }).cancelled = true;
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		expect(result).toBeNull();
		expect(exporter.nativeStaticLayoutOverlayFailure).toMatchObject({
			stage: "overlay-preparation",
		});
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-rgba", { abort: true });
		// One renderer for the sprite attempt, one for the baked sidecar.
		expect(mocks.frameRendererDestroy).toHaveBeenCalledTimes(2);
	});

	it("reports an initial preparing route progress that identifies the CUDA compositor first", async () => {
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

		const emitted: Array<Record<string, unknown>> = [];
		const exporter = createExporter({
			onProgress: (progress: Record<string, unknown>) => emitted.push(progress),
		});
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toMatchObject({ success: true });
		expect(emitted.length).toBeGreaterThan(0);
		expect(emitted[0]).toMatchObject({
			phase: "preparing",
			currentFrame: 0,
			encoderName: "nvidia-cuda-compositor",
			encodeBackend: "ffmpeg",
		});
	});

	it("discards the produced temp video when the native route cannot preserve zoom motion blur", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		api.nativeStaticLayoutExport.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/hevc-blur-route.mp4",
			videoCodec: "hevc",
			encoderPreference: "auto",
			route: "cuda-overlay",
			encoderName: "nvidia-cuda-compositor",
			metrics: { chunkCount: 1, chunkDurationSec: 120, chunkExecMs: 0, chunks: [] },
		});

		// Spatial zoom motion blur over overlay content requires the generalized
		// CUDA compositor. The FFmpeg effectful overlay route cannot preserve it,
		// so the successful native result is rejected; the produced temp video
		// (potentially GBs for HEVC) must not be left on disk for the session.
		const exporter = createExporter({
			exportEncoderPreference: "auto",
			zoomMotionBlur: 0.35,
		});
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toBeNull();
		expect(exporter.nativeStaticLayoutSkipReason).toBe(
			"unsupported-motion-blur-on-overlay-route",
		);
		expect(exporter.nativeStaticLayoutSkipReasons).toContain(
			"unsupported-motion-blur-on-overlay-route",
		);
		expect(api.discardExportedTemp).toHaveBeenCalledWith("C:/Temp/hevc-blur-route.mp4");
	});

	it("prepares a cursor-sprite overlay layer for a renderer-baked cursor on the CUDA route", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		const width = 32;
		const height = 32;
		const frameCount = 30;
		mocks.frameRendererStartCursorSpriteCapture.mockReturnValue(true);
		mocks.frameRendererCaptureCursorSpriteFrame.mockReturnValue({
			captured: true,
			position: { x: 10, y: 20 },
		});
		mocks.frameRendererFinishCursorSpriteCapture.mockReturnValue({
			width,
			height,
			frameCount,
			frames: new Uint8Array(width * height * 4 * frameCount),
			positions: Array.from({ length: frameCount }, (_, index) => ({
				x: 10 + index,
				y: 20,
			})),
		});

		// Cursor motion blur disables native atlas ownership, so the cursor is a
		// renderer-baked ROI sprite instead of a full transparent canvas sidecar.
		const exporter = createExporter({ cursorMotionBlur: 1 });
		const result = await exporter.prepareNativeStaticLayoutOverlay(
			videoInfo,
			1,
			frameCount,
			false,
		);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(1);
		expect(result?.tiledOverlayLayers).toHaveLength(0);
		expect(result?.rawFallbackReason).toBeNull();
		const layer = result?.overlayLayers[0] as Record<string, unknown>;
		expect(layer).toMatchObject({
			id: "cursor-sprite",
			kind: "cursor-sprite",
			order: 1,
			x: 0,
			y: 0,
			width,
			height,
			frameRate: 30,
			durationSec: 1,
			frameCount,
			pixelFormat: "rgba",
		});
		expect(layer.positions).toHaveLength(frameCount);
		expect(mocks.frameRendererStartCursorSpriteCapture).toHaveBeenCalledTimes(1);
		expect(mocks.frameRendererCaptureCursorSpriteFrame).toHaveBeenCalledTimes(frameCount);
		expect(mocks.frameRendererFinishCursorSpriteCapture).toHaveBeenCalledTimes(1);
		expect(mocks.frameRendererCancelCursorSpriteCapture).toHaveBeenCalledTimes(1);
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "sprite" });
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "json" });
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-sprite");
		expect(api.closeExportStream).toHaveBeenCalledWith("overlay-json");
	});

	it("uses the cursor-sprite path when the native atlas is eligible but not actually owned", async () => {
		vi.stubGlobal("navigator", { platform: "Win32", userAgent: "node" });
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		mocks.frameRendererStartCursorSpriteCapture.mockReturnValue(true);
		mocks.frameRendererCaptureCursorSpriteFrame.mockReturnValue({
			captured: true,
			position: { x: 10, y: 20 },
		});
		mocks.frameRendererFinishCursorSpriteCapture.mockReturnValue({
			width: 32,
			height: 32,
			frameCount: 30,
			frames: new Uint8Array(32 * 32 * 4 * 30),
			positions: Array.from({ length: 30 }, (_, index) => ({ x: 10 + index, y: 20 })),
		});

		// With the Win32 CUDA route the native atlas is *eligible*, but the atlas
		// was not actually built/owned (cursorExcluded === false). The sprite path
		// must run as the pixel-preserving fallback instead of forcing the
		// expensive full-canvas tiled sidecar. Before the fix the atlas-eligibility
		// gate blocked this and baked a full 4K sidecar per frame.
		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30, false);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(1);
		expect(result?.tiledOverlayLayers).toHaveLength(0);
		const layer = result?.overlayLayers[0] as Record<string, unknown>;
		expect(layer).toMatchObject({
			id: "cursor-sprite",
			kind: "cursor-sprite",
			width: 32,
			height: 32,
			frameCount: 30,
		});
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "sprite" });
		expect(api.openExportStream).not.toHaveBeenCalledWith({ extension: "rgba" });
	});

	it("falls back to the baked cursor overlay sidecar when cursor-sprite capture is unavailable", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		// startCursorSpriteCapture defaults to false, so the cursor stays baked in
		// the full transparent canvas sidecar (the preserved golden path).

		const exporter = createExporter({ cursorMotionBlur: 1 });
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30, false);

		expect(result).not.toBeNull();
		expect(result?.tiledOverlayLayers).toHaveLength(1);
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "rgba" });
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "tiledrgba" });
	});

	it("rejects a non-CUDA native route that cannot compose the cursor sprite", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		mocks.frameRendererStartCursorSpriteCapture.mockReturnValue(true);
		mocks.frameRendererCaptureCursorSpriteFrame.mockReturnValue({
			captured: true,
			position: { x: 1, y: 1 },
		});
		mocks.frameRendererFinishCursorSpriteCapture.mockReturnValue({
			width: 32,
			height: 32,
			frameCount: 30,
			frames: new Uint8Array(32 * 32 * 4 * 30),
			positions: Array.from({ length: 30 }, () => ({ x: 1, y: 1 })),
		});
		api.nativeStaticLayoutExport.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/hevc.mp4",
			videoCodec: "hevc",
			encoderPreference: "auto",
			route: "cuda-overlay",
			metrics: { chunkCount: 1, chunkDurationSec: 120, chunkExecMs: 0, chunks: [] },
		});

		const exporter = createExporter({ cursorMotionBlur: 1, exportEncoderPreference: "auto" });
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toBeNull();
		expect(exporter.nativeStaticLayoutSkipReason).toBe("unsupported-cursor-sprite-route");
		expect(exporter.nativeStaticLayoutSkipReasons).toContain("unsupported-cursor-sprite-route");
	});

	it("uses the cursor-sprite ROI for a cursor-only H.264 CUDA export instead of baking a full 4K sidecar", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		mocks.frameRendererStartCursorSpriteCapture.mockReturnValue(true);
		mocks.frameRendererCaptureCursorSpriteFrame.mockReturnValue({
			captured: true,
			position: { x: 10, y: 20 },
		});
		mocks.frameRendererFinishCursorSpriteCapture.mockReturnValue({
			width: 32,
			height: 32,
			frameCount: 30,
			frames: new Uint8Array(32 * 32 * 4 * 30),
			positions: Array.from({ length: 30 }, (_, index) => ({ x: 10 + index, y: 20 })),
		});

		// H.264 CUDA-opt-in export with a cursor-only overlay (no browser pixels
		// and no native atlas ownership). The generalized NVIDIA CUDA compositor
		// consumes the cursor-sprite contract regardless of output codec, so the
		// cheap ROI strip must be selected instead of baking the cursor into a full
		// transparent 4K canvas per frame. Regression: the sprite path was gated on
		// the HEVC-only canUseNativeGpuStaticLayout(), forcing H.264 CUDA cursor
		// exports onto the ~1 minute full-canvas tiled sidecar this case reproduced.
		const exporter = createExporter({
			exportVideoCodec: "h264",
			exportEncoderPreference: "hardware",
		});
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30, false);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(1);
		expect(result?.tiledOverlayLayers).toHaveLength(0);
		const layer = result?.overlayLayers[0] as Record<string, unknown>;
		expect(layer).toMatchObject({
			id: "cursor-sprite",
			kind: "cursor-sprite",
			width: 32,
			height: 32,
			frameCount: 30,
		});
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "sprite" });
		expect(api.openExportStream).not.toHaveBeenCalledWith({ extension: "rgba" });
	});

	it("coalesces a long identical raw overlay run into bounded contiguous IPC writes", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		// 29 identical frames followed by one different frame produce a 29-frame
		// identical middle run that must be coalesced into bounded contiguous IPC
		// chunks instead of one writeExportStreamChunk call per frame.
		frameSource.fill = (frameIndex: number, buffer: Uint8Array | Uint8ClampedArray) => {
			buffer.fill(frameIndex >= 29 ? 0x11 : 0xaa);
		};
		const api = createWindowStub();

		const exporter = createExporter();
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30);

		// The dense full-frame delta on the last frame keeps this on the raw sidecar.
		expect(result?.overlayLayers).toHaveLength(1);
		expect(result?.rawFallbackReason).toBe("dense-frame-delta");
		const rgbaWrites = api.writeExportStreamChunk.mock.calls.filter(
			(call: [string, number, Uint8Array]) => call[0] === "overlay-rgba",
		) as Array<[string, number, Uint8Array]>;
		// The 29 identical frames are coalesced; strictly fewer IPC calls than the
		// 30 frames they represent.
		expect(rgbaWrites.length).toBeLessThan(30);
		// The coalesced batches must cover every overlay frame byte exactly once,
		// preserving offsets and content (no dropped or duplicated pixels).
		const totalBytes = rgbaWrites.reduce((sum, call) => sum + call[2].byteLength, 0);
		expect(totalBytes).toBe(30 * FRAME_BYTE_SIZE);
		let cursor = 0;
		for (const [, offset, chunk] of rgbaWrites) {
			expect(offset % FRAME_BYTE_SIZE).toBe(0);
			expect(chunk.byteLength % FRAME_BYTE_SIZE).toBe(0);
			expect(offset).toBe(cursor);
			cursor += chunk.byteLength;
		}
		// The final (different) frame is present at the correct byte offset with the
		// correct value.
		expect(rgbaWrites[rgbaWrites.length - 1]?.[1]).toBe(29 * FRAME_BYTE_SIZE);
		expect(rgbaWrites[rgbaWrites.length - 1]?.[2][0]).toBe(0x11);
	});

	it("uses the cursor-sprite ROI for the exact HEVC Hardware cursor-only CUDA case instead of a tiled sidecar", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		mocks.frameRendererStartCursorSpriteCapture.mockReturnValue(true);
		mocks.frameRendererCaptureCursorSpriteFrame.mockReturnValue({
			captured: true,
			position: { x: 10, y: 20 },
		});
		mocks.frameRendererFinishCursorSpriteCapture.mockReturnValue({
			width: 32,
			height: 32,
			frameCount: 30,
			frames: new Uint8Array(32 * 32 * 4 * 30),
			positions: Array.from({ length: 30 }, (_, index) => ({ x: 10 + index, y: 20 })),
		});

		// The user's reported case: HEVC Hardware with a cursor-only overlay (zoom
		// is native, so it is not browser pixel content) on the CUDA route. The
		// cursor-sprite ROI strip must be selected instead of baking a full
		// transparent 4K canvas sidecar (which surfaces as tiledOverlayLayers: 1).
		const exporter = createExporter({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
		});
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30, false);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(1);
		expect(result?.tiledOverlayLayers).toHaveLength(0);
		const layer = result?.overlayLayers[0] as Record<string, unknown>;
		expect(layer).toMatchObject({
			id: "cursor-sprite",
			kind: "cursor-sprite",
			width: 32,
			height: 32,
			frameCount: 30,
		});
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "sprite" });
		expect(api.openExportStream).not.toHaveBeenCalledWith({ extension: "rgba" });
		expect(api.openExportStream).not.toHaveBeenCalledWith({ extension: "tiledrgba" });
	});

	it("emits one-shot preparation stage diagnostics (overlay + IPC handoff) with codec/preference/route and elapsedMs", async () => {
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

		const infoMessages: Array<{ message: string; payload: Record<string, unknown> }> = [];
		const infoSpy = vi
			.spyOn(console, "info")
			.mockImplementation((first?: unknown, second?: unknown, third?: unknown) => {
				const text = String(second ?? "");
				if (text.includes("Native static layout preparation stage")) {
					infoMessages.push({
						message: text,
						payload: (third ?? {}) as Record<string, unknown>,
					});
				}
			});

		const exporter = createExporter();
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toMatchObject({ success: true });
		const overlayStage = infoMessages.find((entry) => entry.payload.stage === "overlay");
		const ipcStage = infoMessages.find((entry) => entry.payload.stage === "ipc-handoff");
		expect(overlayStage).toBeDefined();
		expect(ipcStage).toBeDefined();
		expect(overlayStage?.payload).toMatchObject({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			route: "nvidia-cuda-compositor",
		});
		expect(typeof overlayStage?.payload.elapsedMs).toBe("number");
		expect((overlayStage?.payload.elapsedMs as number) ?? 0).toBeGreaterThanOrEqual(0);
		expect(ipcStage?.payload).toMatchObject({
			route: "nvidia-cuda-compositor",
			success: true,
		});
		infoSpy.mockRestore();
	});

	it("makes the tiled route reason explicit when browser-rendered pixels coexist with the cursor", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		createWindowStub();

		const infoPayloads: Array<Record<string, unknown>> = [];
		const infoSpy = vi
			.spyOn(console, "info")
			.mockImplementation((message?: unknown, payload?: unknown) => {
				if (String(message ?? "").includes("Cursor-sprite overlay path skipped")) {
					infoPayloads.push((payload ?? {}) as Record<string, unknown>);
				}
			});

		// Native cursor ownership is active (Win32 CUDA route, no cursor effects)
		// but a browser-rendered frame forces the baked full-canvas sidecar, which
		// resolves to the tiled representation. This is necessary, not a sprite
		// failure, and must be surfaced explicitly.
		const exporter = createExporter({ frame: { enabled: true, width: 400, height: 300 } });
		const result = await exporter.prepareNativeStaticLayoutOverlay(videoInfo, 1, 30, true);

		expect(result).not.toBeNull();
		expect(result?.tiledOverlayLayers).toHaveLength(1);
		expect(infoPayloads).toHaveLength(1);
		expect(infoPayloads[0]).toMatchObject({
			reason: "browser-overlay-pixels",
			bakedSidecarRequired: true,
			browserPixelSources: ["frame"],
		});
		infoSpy.mockRestore();
	});

	it("returns no overlay sidecar when the CUDA compositor owns a webcam-only overlay (webcam+zoom fast path)", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();

		// HEVC Hardware CUDA route with the webcam as the ONLY browser-rendered
		// pixel (zoom is native, cursor is atlas-owned). The webcam is excluded
		// from the renderer sidecar and the CUDA compositor draws it from
		// webcamInputPath, so the sidecar is provably empty and must not render or
		// read back a full 4K canvas per frame.
		const exporter = createExporter({
			webcam: { enabled: true, sourcePath: "C:/webcam.mp4" },
		});
		const result = await exporter.prepareNativeStaticLayoutOverlay(
			videoInfo,
			1,
			30,
			true,
			true,
		);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(0);
		expect(result?.tiledOverlayLayers).toHaveLength(0);
		expect(result?.rawFallbackReason).toBeNull();
		expect(mocks.frameRendererInitialize).not.toHaveBeenCalled();
		expect(mocks.frameRendererRenderOverlayFrame).not.toHaveBeenCalled();
		expect(api.openExportStream).not.toHaveBeenCalled();
		expect(mocks.frameRendererDestroy).not.toHaveBeenCalled();
	});

	it("still renders the baked webcam sidecar when captions coexist with the webcam (mixed overlay fallback)", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();

		// Captions are browser-rendered pixels, so the webcam cannot be owned
		// natively: the existing baked full-canvas sidecar path must run unchanged
		// (webcam stays in the sidecar; webcamInputPath is never sent alongside
		// baked pixels, which prevents double-draw).
		const exporter = createExporter({
			webcam: { enabled: true, sourcePath: "C:/webcam.mp4" },
			autoCaptions: [{ startMs: 0, endMs: 1000, text: "Hi", lang: "en" }],
		});
		const result = await exporter.prepareNativeStaticLayoutOverlay(
			videoInfo,
			1,
			30,
			true,
			false,
		);

		expect(result).not.toBeNull();
		expect(mocks.frameRendererInitialize).toHaveBeenCalledTimes(1);
		expect(mocks.frameRendererRenderOverlayFrame).toHaveBeenCalledTimes(30);
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "rgba" });
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "tiledrgba" });
		expect(result?.tiledOverlayLayers).toHaveLength(1);
		expect(result?.rawFallbackReason).toBeNull();
	});

	it("keeps the webcam baked when a webcam shadow would be lost on the CUDA route", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();

		// The CUDA compositor webcam overlay has no shadow support, so a shadowed
		// webcam must stay on the baked sidecar path even when it is the only
		// browser pixel.
		const exporter = createExporter({
			webcam: { enabled: true, sourcePath: "C:/webcam.mp4", shadow: 0.5 },
		});
		const result = await exporter.prepareNativeStaticLayoutOverlay(
			videoInfo,
			1,
			30,
			true,
			false,
		);

		expect(result).not.toBeNull();
		expect(mocks.frameRendererInitialize).toHaveBeenCalledTimes(1);
		expect(mocks.frameRendererRenderOverlayFrame).toHaveBeenCalledTimes(30);
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "rgba" });
	});

	it("uses the cursor-sprite ROI for a webcam-native export and never bakes the webcam into the sidecar", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		mocks.frameRendererStartCursorSpriteCapture.mockReturnValue(true);
		mocks.frameRendererCaptureCursorSpriteFrame.mockReturnValue({
			captured: true,
			position: { x: 10, y: 20 },
		});
		mocks.frameRendererFinishCursorSpriteCapture.mockReturnValue({
			width: 32,
			height: 32,
			frameCount: 30,
			frames: new Uint8Array(32 * 32 * 4 * 30),
			positions: Array.from({ length: 30 }, (_, index) => ({ x: 10 + index, y: 20 })),
		});

		// Webcam-only browser pixels with a renderer-baked cursor: the webcam is
		// excluded from the sidecar (native CUDA ownership) and the cursor is
		// captured as the cheap ROI sprite, so no full 4K canvas is rendered per
		// frame and the webcam is never double-drawn.
		const exporter = createExporter({
			webcam: { enabled: true, sourcePath: "C:/webcam.mp4" },
		});
		const result = await exporter.prepareNativeStaticLayoutOverlay(
			videoInfo,
			1,
			30,
			false,
			true,
		);

		expect(result).not.toBeNull();
		expect(result?.overlayLayers).toHaveLength(1);
		expect(result?.tiledOverlayLayers).toHaveLength(0);
		const layer = result?.overlayLayers[0] as Record<string, unknown>;
		expect(layer).toMatchObject({
			id: "cursor-sprite",
			kind: "cursor-sprite",
			width: 32,
			height: 32,
			frameCount: 30,
		});
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "sprite" });
		expect(api.openExportStream).not.toHaveBeenCalledWith({ extension: "rgba" });
		expect(api.openExportStream).not.toHaveBeenCalledWith({ extension: "tiledrgba" });
	});

	it("passes webcamInputPath and webcamNativeOwned for a webcam+zoom HEVC Hardware CUDA export", async () => {
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
			metrics: { chunkCount: 1, chunkDurationSec: 120, chunkExecMs: 0, chunks: [] },
		});

		// Webcam is the only browser pixel and the cursor is disabled, so the
		// deterministic fast lane selects an empty sidecar while the CUDA
		// compositor owns the webcam natively: no renderer init, no per-frame
		// canvas readback, and the webcam must reach the CUDA wrapper.
		const exporter = createExporter({
			showCursor: false,
			webcam: { enabled: true, sourcePath: "C:/webcam.mp4" },
		});
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toMatchObject({ success: true });
		const exportCall = api.nativeStaticLayoutExport.mock.calls[0] as [Record<string, unknown>];
		expect(exportCall[0].overlayLayers).toBeUndefined();
		expect(exportCall[0].tiledOverlayLayers).toBeUndefined();
		expect(exportCall[0].webcamInputPath).toBe("C:/webcam.mp4");
		expect(exportCall[0].webcamNativeOwned).toBe(true);
		expect(mocks.frameRendererInitialize).not.toHaveBeenCalled();
		expect(mocks.frameRendererRenderOverlayFrame).not.toHaveBeenCalled();
		expect(api.openExportStream).not.toHaveBeenCalled();
	});

	it("passes webcamInputPath alongside a cursor-sprite overlay without double-drawing the webcam", async () => {
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
			metrics: { chunkCount: 1, chunkDurationSec: 120, chunkExecMs: 0, chunks: [] },
		});
		mocks.frameRendererStartCursorSpriteCapture.mockReturnValue(true);
		mocks.frameRendererCaptureCursorSpriteFrame.mockReturnValue({
			captured: true,
			position: { x: 10, y: 20 },
		});
		mocks.frameRendererFinishCursorSpriteCapture.mockReturnValue({
			width: 32,
			height: 32,
			frameCount: 30,
			frames: new Uint8Array(32 * 32 * 4 * 30),
			positions: Array.from({ length: 30 }, (_, index) => ({ x: 10 + index, y: 20 })),
		});

		// Webcam native ownership + a renderer-baked cursor: the sidecar holds
		// only the cursor-sprite ROI and the webcam still reaches the CUDA
		// compositor, so the webcam is drawn exactly once (never also baked).
		const exporter = createExporter({
			webcam: { enabled: true, sourcePath: "C:/webcam.mp4" },
		});
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toMatchObject({ success: true });
		const exportCall = api.nativeStaticLayoutExport.mock.calls[0] as [Record<string, unknown>];
		expect(exportCall[0].overlayLayers).toHaveLength(1);
		expect((exportCall[0].overlayLayers as Array<Record<string, unknown>>)[0]).toMatchObject({
			id: "cursor-sprite",
			kind: "cursor-sprite",
		});
		expect(exportCall[0].webcamInputPath).toBe("C:/webcam.mp4");
		expect(exportCall[0].webcamNativeOwned).toBe(true);
	});

	it("keeps webcamNativeOwned undefined and webcamInputPath null when captions coexist (baked path)", async () => {
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
			metrics: { chunkCount: 1, chunkDurationSec: 120, chunkExecMs: 0, chunks: [] },
		});

		// Captions are browser-rendered pixels, so the webcam stays baked in the
		// sidecar and webcamInputPath must NOT be sent: sending it would make the
		// CUDA compositor draw the webcam a second time (double-draw).
		const exporter = createExporter({
			webcam: { enabled: true, sourcePath: "C:/webcam.mp4" },
			autoCaptions: [{ startMs: 0, endMs: 1000, text: "Hi", lang: "en" }],
		});
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toMatchObject({ success: true });
		const exportCall = api.nativeStaticLayoutExport.mock.calls[0] as [Record<string, unknown>];
		expect(exportCall[0].webcamInputPath).toBeNull();
		expect(exportCall[0].webcamNativeOwned).toBeUndefined();
		// The baked sidecar resolves to the tiled representation for static
		// content: overlayLayers stays undefined and tiledOverlayLayers carries
		// the sidecar pixels (cursor + captions + webcam baked together).
		expect(exportCall[0].overlayLayers).toBeUndefined();
		expect(Array.isArray(exportCall[0].tiledOverlayLayers)).toBe(true);
		expect((exportCall[0].tiledOverlayLayers as unknown[]).length).toBeGreaterThan(0);
		expect(mocks.frameRendererInitialize).toHaveBeenCalled();
		expect(mocks.frameRendererRenderOverlayFrame).toHaveBeenCalledTimes(30);
	});

	it("keeps the webcam baked for HEVC Auto (non-strict) even when it is the only browser pixel", async () => {
		vi.stubGlobal("VideoFrame", FakeVideoFrame);
		vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
		const api = createWindowStub();
		api.nativeStaticLayoutExport.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/hevc-auto.mp4",
			videoCodec: "hevc",
			encoderPreference: "auto",
			route: "nvidia-cuda-compositor",
			encoderName: "nvidia-cuda-compositor",
			metrics: { chunkCount: 1, chunkDurationSec: 120, chunkExecMs: 0, chunks: [] },
		});

		// HEVC Auto is not the strict CUDA-only route: a fallback could still
		// render the webcam from the baked sidecar, so the webcam stays baked and
		// is never excluded from the sidecar.
		const exporter = createExporter({
			showCursor: false,
			exportEncoderPreference: "auto",
			webcam: { enabled: true, sourcePath: "C:/webcam.mp4" },
		});
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toMatchObject({ success: true });
		const exportCall = api.nativeStaticLayoutExport.mock.calls[0] as [Record<string, unknown>];
		expect(exportCall[0].webcamNativeOwned).toBeUndefined();
		expect(exportCall[0].webcamInputPath).toBeNull();
		expect(api.openExportStream).toHaveBeenCalled();
		expect(mocks.frameRendererInitialize).toHaveBeenCalled();
	});
});
