import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModernVideoExporter as ModernVideoExporterClass } from "./modernVideoExporter";
import type { DecodedVideoInfo } from "./streamingDecoder";

const FRAME_BYTE_SIZE = 1920 * 1080 * 4;
const DEFAULT_FRAME_VALUE = 0xaa;

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

	return {
		rendererCanvas,
		frameRendererDestroy: vi.fn(),
		frameRendererGetCanvas: vi.fn(() => rendererCanvas),
		frameRendererInitialize: vi.fn(async () => {}),
		frameRendererRenderOverlayFrame: vi.fn(async () => {}),
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
		closeExportStream: vi.fn(async (streamId: string) => {
			const tempPath = `C:/Temp/overlay.${String(streamId).replace("overlay-", "")}`;
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
		experimentalNativeExport: true,
		experimentalNvidiaCudaExport: true,
		...overrides,
	} as never) as unknown as {
		tryExportNativeStaticLayout: (
			videoInfo: DecodedVideoInfo,
			audioPlan: unknown,
			effectiveDurationSec: number,
			totalFrames: number,
		) => Promise<{ success: boolean; tempFilePath?: string; error?: string } | null>;
		nativeStaticLayoutSkipReason: string | null;
		nativeStaticLayoutSkipReasons: string[];
		canUseNativeWebcamOwnership: () => boolean;
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

describe("ModernVideoExporter native static-layout route rejection cleanup", () => {
	beforeAll(async () => {
		({ ModernVideoExporter } = await import("./modernVideoExporter"));
	}, 30_000);

	afterEach(() => {
		frameSource.values = [];
		frameSource.videoFrameCall = 0;
		frameSource.readbackCall = 0;
		vi.clearAllMocks();
		// Reset cursor-sprite mock implementations so the default (unavailable)
		// fallback applies unless a test explicitly opts into the sprite path.
		mocks.frameRendererStartCursorSpriteCapture.mockReset();
		mocks.frameRendererCaptureCursorSpriteFrame.mockReset();
		mocks.frameRendererFinishCursorSpriteCapture.mockReset();
		mocks.frameRendererCancelCursorSpriteCapture.mockReset();
		vi.unstubAllGlobals();
	});

	it("discards the produced temp video when the native route cannot compose the cursor sprite", async () => {
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
		api.nativeStaticLayoutExport.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/h264-cursor-sprite.mp4",
			videoCodec: "h264",
			encoderPreference: "auto",
			route: "cuda-overlay",
			encoderName: "nvidia-cuda-compositor",
			metrics: { chunkCount: 1, chunkDurationSec: 120, chunkExecMs: 0, chunks: [] },
		});

		// Cursor motion blur disables native atlas ownership, so the cursor is
		// prepared as a cursor-sprite ROI layer. A non-CUDA result route cannot
		// compose that contract, so the successful native result is rejected; the
		// produced temp video (potentially GBs) must not be left on disk for the
		// session.
		const exporter = createExporter({
			showCursor: true,
			cursorMotionBlur: 1,
			cursorTelemetry: [
				{ timeMs: 0, cx: 0.25, cy: 0.35 },
				{ timeMs: 500, cx: 0.4, cy: 0.45 },
			],
		});
		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toBeNull();
		expect(exporter.nativeStaticLayoutSkipReason).toBe("unsupported-cursor-sprite-route");
		expect(exporter.nativeStaticLayoutSkipReasons).toContain("unsupported-cursor-sprite-route");
		expect(api.discardExportedTemp).toHaveBeenCalledWith("C:/Temp/h264-cursor-sprite.mp4");
	});

	it("discards the produced temp video when the native route cannot draw the native-owned webcam", async () => {
		const api = createWindowStub();
		api.nativeStaticLayoutExport.mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/h264-webcam-route.mp4",
			videoCodec: "h264",
			encoderPreference: "auto",
			route: "cuda-overlay",
			encoderName: "nvidia-cuda-compositor",
			metrics: { chunkCount: 1, chunkDurationSec: 120, chunkExecMs: 0, chunks: [] },
		});

		const exporter = createExporter();
		// The public strict-HEVC policy already refuses non-CUDA routes earlier,
		// so force native webcam ownership here to exercise the explicit
		// webcam-route invariant on a codec/preference combination that reaches it.
		exporter.canUseNativeWebcamOwnership = () => true;

		const result = await exporter.tryExportNativeStaticLayout(
			videoInfo,
			{ audioMode: "none" },
			1,
			30,
		);

		expect(result).toBeNull();
		expect(exporter.nativeStaticLayoutSkipReason).toBe("unsupported-native-webcam-route");
		expect(exporter.nativeStaticLayoutSkipReasons).toContain("unsupported-native-webcam-route");
		expect(api.discardExportedTemp).toHaveBeenCalledWith("C:/Temp/h264-webcam-route.mp4");
	});
});
