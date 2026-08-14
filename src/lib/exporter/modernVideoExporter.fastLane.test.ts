import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	getNativeStaticLayoutFastLaneEligibility,
	type ModernVideoExporter as ModernVideoExporterClass,
} from "./modernVideoExporter";
import type { DecodedVideoInfo } from "./streamingDecoder";

const mocks = vi.hoisted(() => {
	const rendererCanvas = { width: 1920, height: 1080 };

	return {
		frameRendererDestroy: vi.fn(),
		frameRendererGetCanvas: vi.fn(() => rendererCanvas),
		frameRendererInitialize: vi.fn(async () => {}),
		frameRendererRenderOverlayFrame: vi.fn(async () => {}),
		buildNativeCursorAtlas: vi.fn(async () => ({
			width: 128,
			height: 128,
			entries: [],
			dataUrl: "data:image/png;base64,AA==",
		})),
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

vi.mock("@/components/video-editor/videoPlayback/cursorRenderer", () => ({
	buildNativeCursorAtlas: mocks.buildNativeCursorAtlas,
	DEFAULT_CURSOR_CONFIG: { dotRadius: 28 },
	interpolateCursorPosition: vi.fn(() => ({ cx: 0.25, cy: 0.35 })),
}));

vi.mock("./audioEncoder", () => ({
	AudioProcessor: vi.fn().mockImplementation(function () {
		return {
			setOnProgress: vi.fn(),
			renderEditedAudioTrack: vi.fn(
				async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }),
			),
			cancel: vi.fn(),
		};
	}),
	isAacAudioEncodingSupported: vi.fn(async () => false),
}));

class FakeVideoFrame {
	constructor(
		public readonly source: unknown,
		public readonly init: { timestamp?: number } = {},
	) {}

	async copyTo(): Promise<void> {
		// no-op readback for non-fast-lane overlay preparation tests
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
				const data = new Uint8ClampedArray(1920 * 1080 * 4);
				data.fill(0);
				return { data };
			},
		};
	}
}

function createWindowStub() {
	const electronAPI = {
		openExportStream: vi.fn(async ({ extension }: { extension?: string }) => ({
			success: true,
			streamId: `overlay-${extension ?? "rgba"}`,
			tempPath: `C:/Temp/overlay.${extension ?? "rgba"}`,
		})),
		writeExportStreamChunk: vi.fn(async () => ({ success: true })),
		closeExportStream: vi.fn(async (streamId: string, options?: { abort?: boolean }) => ({
			success: true,
			tempPath: `C:/Temp/overlay.${String(streamId).replace("overlay-", "")}`,
			bytesWritten: options?.abort ? 0 : 0,
		})),
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

describe("ModernVideoExporter deterministic no-browser-overlay fast lane", () => {
	beforeAll(async () => {
		({ ModernVideoExporter } = await import("./modernVideoExporter"));
	}, 30_000);

	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	describe("getNativeStaticLayoutFastLaneEligibility predicate", () => {
		const valid = {
			canUseNativeGpuStaticLayout: true,
			hasBrowserOverlayPixels: false,
			cursorDisabled: false,
			cursorNativeOwnershipActive: true,
			requiresEditedAudioRender: false,
			hasAuthoritativeNativeSource: true,
		};

		it("is eligible when the cursor is disabled and there are no browser pixels", () => {
			const result = getNativeStaticLayoutFastLaneEligibility({
				...valid,
				cursorDisabled: true,
				cursorNativeOwnershipActive: false,
			});
			expect(result.eligible).toBe(true);
			expect(result.skipReasons).toEqual([]);
		});

		it("is eligible when the native CUDA compositor owns the cursor and there are no browser pixels", () => {
			const result = getNativeStaticLayoutFastLaneEligibility(valid);
			expect(result.eligible).toBe(true);
			expect(result.skipReasons).toEqual([]);
		});

		it("skips when the native CUDA route is not selected", () => {
			const result = getNativeStaticLayoutFastLaneEligibility({
				...valid,
				canUseNativeGpuStaticLayout: false,
			});
			expect(result.eligible).toBe(false);
			expect(result.skipReasons).toEqual(["not-native-cuda-route"]);
		});

		it("skips when browser-rendered overlay pixels are present (captions/annotations/webcam/frame)", () => {
			const result = getNativeStaticLayoutFastLaneEligibility({
				...valid,
				hasBrowserOverlayPixels: true,
			});
			expect(result.eligible).toBe(false);
			expect(result.skipReasons).toEqual(["browser-overlay-pixels-present"]);
		});

		it("skips when the cursor must be baked into the overlay sidecar", () => {
			const result = getNativeStaticLayoutFastLaneEligibility({
				...valid,
				cursorDisabled: false,
				cursorNativeOwnershipActive: false,
			});
			expect(result.eligible).toBe(false);
			expect(result.skipReasons).toEqual(["cursor-sidecar-required"]);
		});

		it("skips when edited-audio rendering is required", () => {
			const result = getNativeStaticLayoutFastLaneEligibility({
				...valid,
				requiresEditedAudioRender: true,
			});
			expect(result.eligible).toBe(false);
			expect(result.skipReasons).toEqual(["edited-audio-render-required"]);
		});

		it("skips when the native source is not authoritative", () => {
			const result = getNativeStaticLayoutFastLaneEligibility({
				...valid,
				hasAuthoritativeNativeSource: false,
			});
			expect(result.eligible).toBe(false);
			expect(result.skipReasons).toEqual(["native-source-not-authoritative"]);
		});

		it("returns every skip reason when multiple gates fail", () => {
			const result = getNativeStaticLayoutFastLaneEligibility({
				...valid,
				canUseNativeGpuStaticLayout: false,
				hasBrowserOverlayPixels: true,
				cursorNativeOwnershipActive: false,
				cursorDisabled: false,
				requiresEditedAudioRender: true,
				hasAuthoritativeNativeSource: false,
			});
			expect(result.eligible).toBe(false);
			expect(result.skipReasons).toEqual([
				"not-native-cuda-route",
				"browser-overlay-pixels-present",
				"cursor-sidecar-required",
				"edited-audio-render-required",
				"native-source-not-authoritative",
			]);
		});
	});

	describe("tryExportNativeStaticLayout fast-lane behavior", () => {
		it("starts native export early without overlay sidecar or cursor atlas when the cursor is disabled", async () => {
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

			const exporter = createExporter({ showCursor: false });
			const result = await exporter.tryExportNativeStaticLayout(
				videoInfo,
				{ audioMode: "none" },
				1,
				30,
			);

			expect(result).toMatchObject({ success: true });
			const exportCall = api.nativeStaticLayoutExport.mock.calls[0] as [
				Record<string, unknown>,
			];
			expect(exportCall[0].overlayLayers).toBeUndefined();
			expect(exportCall[0].tiledOverlayLayers).toBeUndefined();
			expect(exportCall[0].cursorAtlasPngDataUrl).toBeNull();
			expect(exportCall[0].cursorTelemetry).toBeUndefined();
			expect(exportCall[0].cursorAtlasOwned).toBeUndefined();
			// The overlay preparation (renderer init / canvas capture / sidecar) is
			// bypassed entirely.
			expect(mocks.frameRendererInitialize).not.toHaveBeenCalled();
			expect(mocks.frameRendererRenderOverlayFrame).not.toHaveBeenCalled();
			expect(api.openExportStream).not.toHaveBeenCalled();
		});

		it("does not use the fast lane when the native atlas is eligible but failed to build", async () => {
			vi.stubGlobal("navigator", { platform: "Win32", userAgent: "node" });
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
			// Track written bytes so the baked sidecar's finalize byte check passes.
			const streamBytes: Record<string, number> = {};
			(api.writeExportStreamChunk as ReturnType<typeof vi.fn>).mockImplementation(
				async (streamId: string, offset: number, chunk: Uint8Array) => {
					streamBytes[streamId] = Math.max(
						streamBytes[streamId] ?? 0,
						offset + chunk.byteLength,
					);
					return { success: true };
				},
			);
			(api.closeExportStream as ReturnType<typeof vi.fn>).mockImplementation(
				async (streamId: string, options?: { abort?: boolean }) => {
					const tempPath = `C:/Temp/overlay.${String(streamId).replace("overlay-", "")}`;
					if (options?.abort) {
						return { success: true, tempPath, bytesWritten: 0 };
					}
					return { success: true, tempPath, bytesWritten: streamBytes[streamId] ?? 0 };
				},
			);
			// The CUDA route is eligible (Win32 + experimental flags) but the atlas
			// build fails, so the cursor is NOT actually owned by the compositor.
			// The fast lane must not select the empty sidecar (which would silently
			// drop the cursor): the cursor-sprite ROI path is the only allowed
			// renderer preparation for a cursor-only export. This mock renderer does
			// not implement the sprite capture API, so preparation fails
			// deterministically and the native attempt is skipped (a cursor-only
			// export NEVER falls back to the full-canvas bake).
			mocks.buildNativeCursorAtlas.mockRejectedValueOnce(new Error("atlas build failed"));

			const exporter = createExporter();
			const result = await exporter.tryExportNativeStaticLayout(
				videoInfo,
				{ audioMode: "none" },
				1,
				30,
			);

			expect(result).toBeNull();
			expect(mocks.frameRendererInitialize).toHaveBeenCalled();
			expect(mocks.frameRendererRenderOverlayFrame).not.toHaveBeenCalled();
			// The streaming cursor-sprite path launches the native IPC concurrently
			// with the bake; this mock renderer lacks the sprite capture API, so the
			// bake fails deterministically and the native attempt is skipped (a
			// cursor-only export NEVER falls back to the full-canvas bake).
			expect(api.nativeStaticLayoutExport).toHaveBeenCalledTimes(1);
			expect(exporter.nativeStaticLayoutSkipReason).toBe("native-overlay-preparation-failed");
			expect(exporter.nativeStaticLayoutSkipReasons).toContain(
				"overlay-stage:cursor-sprite-streaming-preparation",
			);
		});

		it("starts native export early with a native-owned cursor atlas but no overlay sidecar", async () => {
			vi.stubGlobal("navigator", { platform: "Win32", userAgent: "node" });
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

			const exporter = createExporter();
			const result = await exporter.tryExportNativeStaticLayout(
				videoInfo,
				{ audioMode: "none" },
				1,
				30,
			);

			expect(result).toMatchObject({ success: true });
			const exportCall = api.nativeStaticLayoutExport.mock.calls[0] as [
				Record<string, unknown>,
			];
			expect(exportCall[0].overlayLayers).toBeUndefined();
			expect(exportCall[0].tiledOverlayLayers).toBeUndefined();
			// Native cursor ownership is active: the cursor atlas rides through but
			// no browser-rendered overlay sidecar is produced.
			expect(exportCall[0].cursorAtlasOwned).toBe(true);
			expect(exportCall[0].cursorAtlasPngDataUrl).not.toBeNull();
			expect(Array.isArray(exportCall[0].cursorTelemetry)).toBe(true);
			expect(mocks.frameRendererInitialize).not.toHaveBeenCalled();
			expect(mocks.frameRendererRenderOverlayFrame).not.toHaveBeenCalled();
			expect(api.openExportStream).not.toHaveBeenCalled();
		});

		it("starts the cursor atlas build in parallel with background resolution, not after it", async () => {
			vi.stubGlobal("navigator", { platform: "Win32", userAgent: "node" });
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

			const exporter = createExporter() as unknown as {
				tryExportNativeStaticLayout: (
					videoInfo: DecodedVideoInfo,
					audioPlan: unknown,
					effectiveDurationSec: number,
					totalFrames: number,
				) => Promise<{ success: boolean; tempFilePath?: string; error?: string } | null>;
				resolveNativeStaticLayoutBackground: () => Promise<unknown>;
			};
			// Gate the background promise; the atlas build must already be in flight
			// while the background is unresolved. Before the parallelization the
			// atlas awaited the background serially and could not have started yet.
			let releaseBackground!: () => void;
			const backgroundGate = new Promise<void>((resolve) => {
				releaseBackground = resolve;
			});
			const backgroundSpy = vi
				.spyOn(exporter, "resolveNativeStaticLayoutBackground")
				.mockImplementation(async () => {
					await backgroundGate;
					return { backgroundColor: "#101010", backgroundImagePath: null };
				});

			const exportPromise = exporter.tryExportNativeStaticLayout(
				videoInfo,
				{ audioMode: "none" },
				1,
				30,
			);
			await Promise.resolve();

			// The background is still gated, yet the independent atlas build has
			// already started: audio + background + atlas wall time is max(...), not
			// the serialized sum.
			expect(mocks.buildNativeCursorAtlas).toHaveBeenCalled();
			expect(backgroundSpy).toHaveBeenCalled();

			releaseBackground();
			const result = await exportPromise;
			expect(result).toMatchObject({ success: true });
			const exportCall = api.nativeStaticLayoutExport.mock.calls[0] as [
				Record<string, unknown>,
			];
			expect(exportCall[0].cursorAtlasOwned).toBe(true);
		});

		it("still prepares the overlay sidecar when browser-rendered pixels are present", async () => {
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

			const exporter = createExporter({
				autoCaptions: [{ startMs: 0, endMs: 1000, text: "Hi", lang: "en" }],
			});
			await exporter.tryExportNativeStaticLayout(videoInfo, { audioMode: "none" }, 1, 30);

			// Captions are browser-rendered pixels, so the deterministic fast lane
			// must NOT bypass the browser: existing overlay preparation runs (sidecar
			// stream opened, renderer initialized, per-frame overlay rendered). The
			// overall tryExport may still fall back if the minimal test harness cannot
			// complete the truncated raw sidecar; the point is that the overlay-preparation
			// path is entered at all.
			expect(api.openExportStream).toHaveBeenCalled();
			expect(mocks.frameRendererInitialize).toHaveBeenCalledTimes(1);
			expect(mocks.frameRendererRenderOverlayFrame).toHaveBeenCalledTimes(30);
		});

		it("keeps the fast lane eligible for edited-track audio by deferring the render behind the compositor", async () => {
			vi.stubGlobal("navigator", { platform: "Win32", userAgent: "node" });
			vi.stubGlobal("VideoFrame", FakeVideoFrame);
			vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
			const api = createWindowStub();
			// Track written bytes so the deferred audio stream finalizes with a
			// non-zero payload (the renderer checks bytesWritten > 0 on close).
			const streamBytes: Record<string, number> = {};
			(api.writeExportStreamChunk as ReturnType<typeof vi.fn>).mockImplementation(
				async (streamId: string, offset: number, chunk: Uint8Array) => {
					streamBytes[streamId] = Math.max(
						streamBytes[streamId] ?? 0,
						offset + chunk.byteLength,
					);
					return { success: true };
				},
			);
			(api.closeExportStream as ReturnType<typeof vi.fn>).mockImplementation(
				async (streamId: string, options?: { abort?: boolean }) => {
					const tempPath = `C:/Temp/overlay.${String(streamId).replace("overlay-", "")}`;
					if (options?.abort) {
						return { success: true, tempPath, bytesWritten: 0 };
					}
					return { success: true, tempPath, bytesWritten: streamBytes[streamId] ?? 0 };
				},
			);
			api.nativeStaticLayoutExport.mockResolvedValue({
				success: true,
				tempPath: "C:/Temp/hevc-static.mp4",
				videoCodec: "hevc",
				encoderPreference: "hardware",
				route: "nvidia-cuda-compositor",
				encoderName: "nvidia-cuda-compositor",
				metrics: { chunkCount: 1, chunkDurationSec: 120, chunkExecMs: 0, chunks: [] },
			});

			const exporter = createExporter();
			const result = await exporter.tryExportNativeStaticLayout(
				videoInfo,
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
					sourceAudioFallbackPaths: [],
				},
				1,
				30,
			);

			// The edited-track render is deferred to an export stream, so the
			// no-browser-overlay fast lane stays eligible and the compositor launches
			// immediately with the audio stream id riding in the IPC options.
			expect(result).toMatchObject({ success: true });
			const exportCall = api.nativeStaticLayoutExport.mock.calls[0] as [
				Record<string, unknown>,
			];
			const audioOptions = exportCall[0].audioOptions as Record<string, unknown>;
			expect(audioOptions.editedAudioStreamId).toBe("overlay-wav");
			expect(audioOptions.editedAudioDeferred).toBe(true);
			expect(api.openExportStream).toHaveBeenCalledWith({ extension: "wav" });
			// The compositor launches without waiting for the audio render to finish:
			// the native IPC is in flight while the WAV render runs concurrently.
			expect(api.nativeStaticLayoutExport).toHaveBeenCalledTimes(1);
		});
	});
});
