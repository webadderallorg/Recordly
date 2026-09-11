import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModernVideoExporter as ModernVideoExporterClass } from "./modernVideoExporter";

const WEBGPU_CRASH = new Error("Cannot read properties of undefined (reading '_resourceType')");

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
		frameRendererDestroy: vi.fn(),
		frameRendererGetBackend: vi.fn(() => "webgl"),
		frameRendererInitialize: vi.fn(async () => {}),
		frameRendererRenderFrame: vi.fn(async () => {}),
		streamingDecoderDestroy: vi.fn(),
		streamingDecoderCancel: vi.fn(),
		streamingDecoderDecodeAll: vi.fn(async () => {}),
		streamingDecoderGetDemuxer: vi.fn(() => null),
		streamingDecoderGetEffectiveDuration: vi.fn(() => 1),
		streamingDecoderLoadMetadata: vi.fn(async () => videoInfo),
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
			renderFrame: mocks.frameRendererRenderFrame,
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

type ExportResultShape = {
	success: boolean;
	blob?: Blob;
	error?: string;
	metrics?: { renderBackend?: string; renderFallbackUsed?: boolean };
};

function stubLinuxNavigator() {
	vi.stubGlobal("navigator", { platform: "Linux x86_64" });
}

function stubLinuxWindow(envBackend?: string) {
	vi.stubGlobal("window", {
		electronAPI:
			envBackend === undefined
				? {}
				: { getLinuxRenderBackendEnv: vi.fn(async () => envBackend) },
	});
}

// The decode loop hands each frame to the exporter callback; making the
// callback run reproduces the real crash site (renderer.renderFrame inside
// decodeAll), not an error fabricated at an arbitrary stage.
function decodeAllInvokesCallbackOnce() {
	mocks.streamingDecoderDecodeAll.mockImplementationOnce(
		async (_frameRate, _trimRegions, _speedRegions, callback) => {
			await callback({} as never, 0, 0, 0);
		},
	);
}

describe("ModernVideoExporter Linux webgpu → webgl fallback", () => {
	let ModernVideoExporter: typeof ModernVideoExporterClass;
	let FrameRenderer: (...args: unknown[]) => unknown;
	let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

	beforeAll(async () => {
		({ ModernVideoExporter } = await import("./modernVideoExporter"));
		({ FrameRenderer } = await import("./modernFrameRenderer"));
	}, 30_000);

	const createLinuxExporter = () =>
		new ModernVideoExporter({
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
			export: () => Promise<ExportResultShape>;
			initializeEncoder: () => Promise<unknown>;
		};

	// restoreAllMocks would wipe the vi.mock factory implementations, so the
	// console spies are restored individually instead.
	beforeEach(() => {
		consoleSpies = [
			vi.spyOn(console, "error").mockImplementation(() => {}),
			vi.spyOn(console, "warn").mockImplementation(() => {}),
			vi.spyOn(console, "log").mockImplementation(() => {}),
		];
	});

	afterEach(() => {
		for (const spy of consoleSpies) {
			spy.mockRestore();
		}
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it("retries the export once from scratch with webgl when the webgpu renderer crashes mid-export", async () => {
		stubLinuxNavigator();
		stubLinuxWindow();

		const exporter = createLinuxExporter();
		vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		// Attempt 1: webgpu initializes, then the first render crashes.
		mocks.frameRendererGetBackend.mockReturnValueOnce("webgpu").mockReturnValueOnce("webgl");
		mocks.frameRendererRenderFrame.mockRejectedValueOnce(WEBGPU_CRASH);
		decodeAllInvokesCallbackOnce();

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(result.blob).toBeInstanceOf(Blob);
		expect(FrameRenderer).toHaveBeenCalledTimes(2);
		expect(FrameRenderer).toHaveBeenCalledWith(
			expect.objectContaining({ preferredRenderBackend: "webgpu" }),
		);
		expect(FrameRenderer).toHaveBeenCalledWith(
			expect.objectContaining({ preferredRenderBackend: "webgl" }),
		);
		expect(mocks.streamingDecoderLoadMetadata).toHaveBeenCalledTimes(2);
		expect(mocks.muxerFinalize).toHaveBeenCalledTimes(1);
		expect(result.metrics?.renderBackend).toBe("webgl");
		expect(result.metrics?.renderFallbackUsed).toBe(true);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("retrying with webgl fallback"),
			expect.any(Error),
		);
	}, 15_000);

	it("does not retry and propagates the error when RECORDLY_LINUX_RENDER_BACKEND=webgpu forced the backend", async () => {
		stubLinuxNavigator();
		stubLinuxWindow("webgpu");

		const exporter = createLinuxExporter();
		vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		mocks.frameRendererGetBackend.mockReturnValue("webgpu");
		mocks.frameRendererRenderFrame.mockRejectedValueOnce(WEBGPU_CRASH);
		decodeAllInvokesCallbackOnce();

		const result = await exporter.export();

		expect(result.success).toBe(false);
		expect(result.error).toContain("_resourceType");
		expect(FrameRenderer).toHaveBeenCalledTimes(1);
		expect(mocks.streamingDecoderLoadMetadata).toHaveBeenCalledTimes(1);
		expect(console.error).not.toHaveBeenCalledWith(
			expect.stringContaining("retrying with webgl fallback"),
			expect.any(Error),
		);
	}, 15_000);

	it("retries at most once when the webgl fallback attempt also fails", async () => {
		stubLinuxNavigator();
		stubLinuxWindow();

		const exporter = createLinuxExporter();
		vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		mocks.frameRendererGetBackend.mockReturnValueOnce("webgpu").mockReturnValueOnce("webgl");
		mocks.frameRendererRenderFrame.mockRejectedValue(WEBGPU_CRASH);
		mocks.streamingDecoderDecodeAll.mockImplementation(
			async (_frameRate, _trimRegions, _speedRegions, callback) => {
				await callback({} as never, 0, 0, 0);
			},
		);

		const result = await exporter.export();

		expect(result.success).toBe(false);
		expect(FrameRenderer).toHaveBeenCalledTimes(2);
		expect(mocks.streamingDecoderLoadMetadata).toHaveBeenCalledTimes(2);
	}, 15_000);
});
