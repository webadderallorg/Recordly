import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRegion, SpeedRegion } from "@/components/video-editor/types";
import {
	ModernVideoExporter,
	shouldRejectNativeStaticLayoutResultForEffectPreservation,
	shouldSkipForMissingCursorAtlas,
} from "./modernVideoExporter";
import type { DecodedVideoInfo } from "./streamingDecoder";

const videoInfo: DecodedVideoInfo = {
	width: 1920,
	height: 1080,
	duration: 60,
	streamDuration: 60,
	frameRate: 30,
	codec: "h264",
	hasAudio: true,
	audioCodec: "aac",
	audioSampleRate: 48_000,
};

function createExporter(overrides: Record<string, unknown> = {}) {
	vi.stubGlobal("window", {
		electronAPI: {
			nativeStaticLayoutExport: vi.fn(),
			nativeStaticLayoutExportCancel: vi.fn(),
			discardExportedTemp: vi.fn(async () => ({ success: true })),
		},
	});

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
		...overrides,
	} as never) as unknown as {
		buildNativeAudioPlan: (videoInfo: DecodedVideoInfo) => unknown;
		tryExportNativeStaticLayout: (
			videoInfo: DecodedVideoInfo,
			audioPlan: unknown,
			effectiveDurationSec: number,
			totalFrames: number,
		) => Promise<unknown>;
		buildNativeStaticLayoutVideoTimelineSegments: (videoInfo: DecodedVideoInfo) => Array<{
			sourceStartMs: number;
			sourceEndMs: number;
			outputStartMs: number;
			outputEndMs: number;
			speed: number;
		}>;
		getNativeStaticLayoutEffectiveDuration: (videoInfo: DecodedVideoInfo) => number;
		getNativeStaticLayoutSkipReason: (
			audioPlan: unknown,
			videoInfo: DecodedVideoInfo,
			effectiveDurationSec: number,
		) => string | null;
		getNativeStaticLayoutSkipReasons: (
			audioPlan: unknown,
			videoInfo: DecodedVideoInfo,
			effectiveDurationSec: number,
		) => string[];
		shouldForceNativeRawFrame: () => boolean;
		requiresStrictNativeCudaRoute: () => boolean;
		buildStrictNativeCudaHardwareError: (reason: string) => Error;
		getNativeStaticLayoutSourceCrop: (videoInfo: DecodedVideoInfo) => {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		resolveNativeStaticLayoutBackground: () => Promise<unknown>;
		createNativeStaticLayoutGradient: (
			ctx: CanvasRenderingContext2D,
			wallpaper: string,
		) => CanvasGradient | null;
		getNativeStaticLayoutCursorSize: (contentWidth: number) => number;
		getNativeStaticLayoutZoomTelemetry: (
			layout: {
				centerOffsetX: number;
				centerOffsetY: number;
				croppedDisplayWidth: number;
				croppedDisplayHeight: number;
			},
			totalFrames: number,
			cursorTelemetry?: unknown,
		) =>
			| Array<{
					timeMs: number;
					scale: number;
					x: number;
					y: number;
					blurStrength: number;
					blurCenterX: number;
					blurCenterY: number;
			  }>
			| undefined;
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ModernVideoExporter native static-layout eligibility", () => {
	it("allows native static-layout eligibility for VP9/WebM sources so main can proxy them", () => {
		const exporter = createExporter();

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{ audioMode: "none" },
				{
					...videoInfo,
					codec: "vp9 (Profile 0)",
					audioCodec: "opus",
				},
				60,
			),
		).toBeNull();
	});

	it("carries embedded audio codec into native mux options", () => {
		const exporter = createExporter();

		expect(
			exporter.buildNativeAudioPlan({
				...videoInfo,
				codec: "vp9 (Profile 0)",
				audioCodec: "opus",
			}),
		).toMatchObject({
			audioMode: "copy-source",
			audioSourceCodec: "opus",
		});
	});

	it("passes HEVC codec and encoder preference to native static-layout", async () => {
		const exporter = createExporter({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			experimentalNvidiaCudaExport: true,
		});
		const nativeStaticLayoutExport = window.electronAPI.nativeStaticLayoutExport;
		vi.mocked(nativeStaticLayoutExport).mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/hevc-static.mp4",
			videoCodec: "hevc",
			encoderPreference: "hardware",
			route: "nvidia-cuda-compositor",
		});

		await expect(
			exporter.tryExportNativeStaticLayout(videoInfo, { audioMode: "none" }, 60, 1_800),
		).resolves.toMatchObject({ success: true, tempFilePath: "C:/Temp/hevc-static.mp4" });
		expect(nativeStaticLayoutExport).toHaveBeenCalledWith(
			expect.objectContaining({
				videoCodec: "hevc",
				encoderPreference: "hardware",
			}),
		);
	});

	it.each([
		"cuda-overlay",
		"cuda-scale-cpu-pad",
		"cuda-static-composite",
	] as const)("accepts the FFmpeg CUDA HEVC route %s", async (route) => {
		const exporter = createExporter({
			exportVideoCodec: "hevc",
			experimentalNvidiaCudaExport: true,
		});
		vi.mocked(window.electronAPI.nativeStaticLayoutExport).mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/hevc-cuda.mp4",
			videoCodec: "hevc",
			encoderPreference: "auto",
			route,
		});

		await expect(
			exporter.tryExportNativeStaticLayout(videoInfo, { audioMode: "none" }, 60, 1_800),
		).resolves.toMatchObject({ success: true, tempFilePath: "C:/Temp/hevc-cuda.mp4" });
	});

	it("rejects FFmpeg CUDA routes for strict HEVC Hardware", async () => {
		const exporter = createExporter({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			experimentalNvidiaCudaExport: true,
		});
		vi.mocked(window.electronAPI.nativeStaticLayoutExport).mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/hevc-cuda.mp4",
			videoCodec: "hevc",
			encoderPreference: "hardware",
			route: "cuda-overlay",
		});

		await expect(
			exporter.tryExportNativeStaticLayout(videoInfo, { audioMode: "none" }, 60, 1_800),
		).resolves.toBeNull();
		// The produced temp video must not stay on disk for the session when the
		// native result is rejected because it cannot satisfy the strict route.
		expect(window.electronAPI.discardExportedTemp).toHaveBeenCalledWith(
			"C:/Temp/hevc-cuda.mp4",
		);
	});

	it("rejects the H.264-only Windows GPU route for HEVC", async () => {
		const exporter = createExporter({
			exportVideoCodec: "hevc",
			experimentalNvidiaCudaExport: true,
		});
		vi.mocked(window.electronAPI.nativeStaticLayoutExport).mockResolvedValue({
			success: true,
			tempPath: "C:/Temp/hevc-windows-gpu.mp4",
			videoCodec: "hevc",
			encoderPreference: "auto",
			route: "windows-d3d11-compositor",
		});

		await expect(
			exporter.tryExportNativeStaticLayout(videoInfo, { audioMode: "none" }, 60, 1_800),
		).resolves.toBeNull();
		// The produced temp video must not stay on disk for the session when the
		// native result is rejected because it cannot satisfy the requested codec.
		expect(window.electronAPI.discardExportedTemp).toHaveBeenCalledWith(
			"C:/Temp/hevc-windows-gpu.mp4",
		);
	});

	it("allows native static-layout for H.264 source metadata", () => {
		const exporter = createExporter();

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{ audioMode: "none" },
				{ ...videoInfo, codec: "avc1.640034" },
				60,
			),
		).toBeNull();
	});

	it("uses FFmpeg filtergraph audio for speed edits with a single external source track", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({
			speedRegions,
			sourceAudioFallbackPaths: ["C:\\recordly\\recording.system.wav"],
		});

		expect(
			exporter.buildNativeAudioPlan({
				...videoInfo,
				hasAudio: false,
				audioCodec: undefined,
				audioSampleRate: undefined,
			}),
		).toMatchObject({
			audioMode: "edited-track",
			strategy: "filtergraph-fast-path",
			audioSourcePath: "C:\\recordly\\recording.system.wav",
			audioSourceSampleRate: 48_000,
			editedTrackSegments: [
				{ startMs: 0, endMs: 1_000, speed: 1 },
				{ startMs: 1_000, endMs: 4_000, speed: 1.5 },
				{ startMs: 4_000, endMs: 60_000, speed: 1 },
			],
		});
	});

	it("mixes companion sidecar audio when the source MP4 also has an audio track", () => {
		const videoPath = "C:\\recordly\\recording.mp4";
		const micPath = "C:\\recordly\\recording.mic.wav";
		const exporter = createExporter({
			videoUrl: `file:///${videoPath.replace(/\\/g, "/")}`,
			sourceAudioFallbackPaths: [micPath],
		});

		expect(exporter.buildNativeAudioPlan(videoInfo)).toMatchObject({
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
			sourceAudioFallbackPaths: [expect.stringMatching(/recording\.mp4$/), micPath],
		});
	});

	it("keeps timed companion audio on the offline render path", () => {
		const audioPath = "C:\\recordly\\recording.system.wav";
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({
			speedRegions,
			sourceAudioFallbackPaths: [audioPath],
			sourceAudioFallbackStartDelayMsByPath: { [audioPath]: 250 },
		});

		expect(
			exporter.buildNativeAudioPlan({
				...videoInfo,
				hasAudio: false,
				audioCodec: undefined,
				audioSampleRate: undefined,
			}),
		).toMatchObject({
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
			sourceAudioFallbackPaths: [audioPath],
		});
	});

	it("allows native video when only the audio track needs offline editing", () => {
		const audioRegions: AudioRegion[] = [
			{
				id: "audio-1",
				audioPath: "file:///overlay.wav",
				startMs: 1_000,
				endMs: 4_000,
				volume: 0.85,
			},
		];
		const exporter = createExporter({ audioRegions });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				60,
			),
		).toBeNull();
	});

	it("allows cursor overlay native static-layout without the experimental native flag", () => {
		const exporter = createExporter({
			experimentalNativeExport: false,
			showCursor: true,
			cursorTelemetry: [
				{ timeMs: 0, cx: 0.25, cy: 0.35 },
				{ timeMs: 1_000, cx: 0.5, cy: 0.55 },
			],
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "copy-source",
					audioSourcePath: "recording.mp4",
				},
				videoInfo,
				60,
			),
		).toBeNull();
	});

	it("scales native static-layout cursor size with a minimum visible floor", () => {
		const exporter = createExporter({ cursorSize: 3, cursorStyle: "tahoe" });

		expect(exporter.getNativeStaticLayoutCursorSize(1920)).toBeCloseTo(84, 6);
		expect(exporter.getNativeStaticLayoutCursorSize(960)).toBeCloseTo(46.2, 6);
		expect(exporter.getNativeStaticLayoutCursorSize(480)).toBeCloseTo(46.2, 6);
	});

	it("allows native static-layout when cursor click effects are enabled", () => {
		const exporter = createExporter({
			showCursor: true,
			cursorClickEffect: "echo",
			cursorTelemetry: [
				{ timeMs: 0, cx: 0.25, cy: 0.35 },
				{ timeMs: 1_000, cx: 0.5, cy: 0.55, interactionType: "click" },
			],
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "copy-source",
					audioSourcePath: "recording.mp4",
				},
				videoInfo,
				60,
			),
		).toBeNull();
	});

	it("does not require a cursor overlay when click effects are enabled but cursor is hidden", () => {
		const exporter = createExporter({
			showCursor: false,
			cursorClickEffect: "echo",
			cursorTelemetry: [
				{ timeMs: 0, cx: 0.25, cy: 0.35 },
				{ timeMs: 1_000, cx: 0.5, cy: 0.55, interactionType: "click" },
			],
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "copy-source",
					audioSourcePath: "recording.mp4",
				},
				videoInfo,
				60,
			),
		).toBeNull();
	});

	it("allows native static-layout with a frame overlay", () => {
		const exporter = createExporter({ frame: "macbook" });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "copy-source",
					audioSourcePath: "recording.mp4",
				},
				videoInfo,
				60,
			),
		).toBeNull();
	});

	it("allows native static-layout with background blur", () => {
		const exporter = createExporter({ backgroundBlur: 12 });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "copy-source",
					audioSourcePath: "recording.mp4",
				},
				videoInfo,
				60,
			),
		).toBeNull();
	});

	it("allows non-default crop when native source crop coordinates are valid", () => {
		const exporter = createExporter({
			cropRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "copy-source",
					audioSourcePath: "recording.mp4",
				},
				videoInfo,
				60,
			),
		).toBeNull();
		expect(exporter.getNativeStaticLayoutSourceCrop(videoInfo)).toEqual({
			x: 192,
			y: 108,
			width: 1536,
			height: 864,
		});
	});

	it("uses the default wallpaper for native static-layout when the project has no wallpaper", async () => {
		const exporter = createExporter({ wallpaper: "" });
		const electronAPI = window.electronAPI as typeof window.electronAPI & {
			getAssetBasePath: () => Promise<string>;
			listAssetDirectory: () => Promise<{ success: true; files: string[] }>;
		};
		electronAPI.getAssetBasePath = vi.fn(async () => "file:///C:/Recordly/resources/");
		electronAPI.listAssetDirectory = vi.fn(async () => ({
			success: true,
			files: ["tahoe-light.jpg"],
		}));

		await expect(exporter.resolveNativeStaticLayoutBackground()).resolves.toEqual({
			backgroundColor: "#101010",
			backgroundImagePath: "C:/Recordly/resources/wallpapers/tahoe-light.jpg",
		});
	});

	it("reports video backgrounds while speed can use native timeline maps", () => {
		const exporter = createExporter({
			wallpaper: "file:///C:/Recordly/background.webm",
			speedRegions: [{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 }],
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				59,
			),
		).toBe("unsupported-background-video");
	});

	it("collects every native static-layout blocker for beta diagnostics", () => {
		const exporter = createExporter({
			width: 1921,
			wallpaper: "file:///C:/Recordly/background.webm",
			speedRegions: [{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 }],
			annotationRegions: [{ id: "annotation-1", startMs: 0, endMs: 1_000 }],
			autoCaptions: [{ id: "caption-1", text: "hello", startMs: 0, endMs: 1_000 }],
			webcam: { enabled: true },
			frame: "macbook",
			cropRegion: { x: 0.1, y: 0, width: 0.9, height: 1 },
		});

		expect(
			exporter.getNativeStaticLayoutSkipReasons(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				59,
			),
		).toEqual([
			"odd-output-dimensions",
			"unsupported-background-video",
			"overlay-layers-do-not-support-native-timeline",
			"unsupported-webcam-source",
		]);
	});

	it("routes spatial zoom motion blur to the native CUDA path instead of skipping", () => {
		const exporter = createExporter({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			experimentalNvidiaCudaExport: true,
			zoomMotionBlur: 0.35,
		});

		const reasons = exporter.getNativeStaticLayoutSkipReasons(
			{ audioMode: "copy-source" },
			videoInfo,
			60,
		);

		expect(reasons).not.toContain("unsupported-motion-blur");
	});

	it("allows spatial zoom motion blur over overlay sidecars because the CUDA route composites both", () => {
		const exporter = createExporter({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			experimentalNvidiaCudaExport: true,
			zoomMotionBlur: 0.35,
			annotationRegions: [{ id: "annotation-1", startMs: 0, endMs: 1_000 }],
		});

		const reasons = exporter.getNativeStaticLayoutSkipReasons(
			{ audioMode: "copy-source" },
			videoInfo,
			60,
		);

		// The generalized CUDA compositor applies the spatial zoom blur and then
		// alpha-composites the transparent overlay sidecar, so the renderer no
		// longer skips the whole static-layout attempt. Non-CUDA result routes are
		// rejected after the export instead of dropping the effect silently.
		expect(reasons).not.toContain("unsupported-motion-blur");
	});

	it("routes temporal zoom motion blur to the CUDA compositor when enabled", () => {
		const exporter = createExporter({
			exportVideoCodec: "hevc",
			exportEncoderPreference: "hardware",
			experimentalNvidiaCudaExport: true,
			zoomTemporalMotionBlur: 0.5,
			zoomMotionBlurSampleCount: 5,
			zoomMotionBlurShutterFraction: 0.5,
		});

		const reasons = exporter.getNativeStaticLayoutSkipReasons(
			{ audioMode: "copy-source" },
			videoInfo,
			60,
		);

		// The generalized CUDA compositor implements the temporal sample plan
		// natively, so the static-layout route is no longer skipped for it.
		expect(reasons).not.toContain("unsupported-temporal-motion-blur");
	});

	it("keeps temporal zoom motion blur an explicit faithful fallback without the CUDA route", () => {
		const exporter = createExporter({
			zoomTemporalMotionBlur: 0.5,
			zoomMotionBlurSampleCount: 5,
			zoomMotionBlurShutterFraction: 0.5,
		});

		const reasons = exporter.getNativeStaticLayoutSkipReasons(
			{ audioMode: "copy-source" },
			videoInfo,
			60,
		);

		expect(reasons).toContain("unsupported-temporal-motion-blur");
		// The reason must not be duplicated by other checks and must not share the
		// spatial-blur reason string.
		expect(
			reasons.filter((reason) => reason === "unsupported-temporal-motion-blur"),
		).toHaveLength(1);
		expect(reasons).not.toContain("unsupported-motion-blur");
	});

	it("rejects non-CUDA result routes when zoom blur and overlay sidecars must both be preserved", () => {
		expect(
			shouldRejectNativeStaticLayoutResultForEffectPreservation({
				hasSpatialZoomMotionBlur: true,
				hasTemporalMotionBlur: false,
				hasOverlayContent: true,
				route: "cuda-overlay",
			}),
		).toBe(true);
		expect(
			shouldRejectNativeStaticLayoutResultForEffectPreservation({
				hasSpatialZoomMotionBlur: true,
				hasTemporalMotionBlur: false,
				hasOverlayContent: true,
				route: "windows-d3d11-compositor",
			}),
		).toBe(true);
	});

	it("rejects non-CUDA routes when temporal zoom motion blur is configured", () => {
		expect(
			shouldRejectNativeStaticLayoutResultForEffectPreservation({
				hasSpatialZoomMotionBlur: false,
				hasTemporalMotionBlur: true,
				hasOverlayContent: false,
				route: "cuda-scale-cpu-pad",
			}),
		).toBe(true);
		expect(
			shouldRejectNativeStaticLayoutResultForEffectPreservation({
				hasSpatialZoomMotionBlur: false,
				hasTemporalMotionBlur: true,
				hasOverlayContent: false,
				route: "nvidia-cuda-compositor",
			}),
		).toBe(false);
	});

	it("accepts the generalized CUDA route for zoom blur over overlay sidecars", () => {
		expect(
			shouldRejectNativeStaticLayoutResultForEffectPreservation({
				hasSpatialZoomMotionBlur: true,
				hasTemporalMotionBlur: false,
				hasOverlayContent: true,
				route: "nvidia-cuda-compositor",
			}),
		).toBe(false);
	});

	it("does not reject overlay results without spatial zoom motion blur", () => {
		expect(
			shouldRejectNativeStaticLayoutResultForEffectPreservation({
				hasSpatialZoomMotionBlur: false,
				hasTemporalMotionBlur: false,
				hasOverlayContent: true,
				route: "cuda-overlay",
			}),
		).toBe(false);
	});

	it("emits renderer-equivalent zoom blur telemetry for the native compositor", () => {
		const exporter = createExporter({
			zoomRegions: [
				{
					id: "zoom-1",
					startMs: 0,
					endMs: 2_000,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
					mode: "manual",
				},
			],
			zoomMotionBlur: 0.35,
		});

		const telemetry = exporter.getNativeStaticLayoutZoomTelemetry(
			{
				centerOffsetX: 0,
				centerOffsetY: 0,
				croppedDisplayWidth: 1920,
				croppedDisplayHeight: 1080,
			},
			60,
			undefined,
		);

		expect(telemetry).toBeDefined();
		expect(telemetry?.length).toBe(60);
		expect(telemetry?.[0].blurStrength).toBe(0);
		const activeBlurSamples = (telemetry ?? []).filter(
			(sample) => sample.blurStrength > 0.0005,
		);
		expect(activeBlurSamples.length).toBeGreaterThan(0);
		for (const sample of telemetry ?? []) {
			expect(Number.isFinite(sample.blurCenterX)).toBe(true);
			expect(Number.isFinite(sample.blurCenterY)).toBe(true);
			expect(sample.blurStrength).toBeGreaterThanOrEqual(0);
		}
	});

	it("reports invalid crop geometry instead of passing native export bad coordinates", () => {
		const exporter = createExporter({
			cropRegion: { x: 0, y: 0, width: 0, height: 1 },
		});

		expect(exporter.getNativeStaticLayoutSkipReason({ audioMode: "none" }, videoInfo, 60)).toBe(
			"invalid-crop-region",
		);
	});

	it("does not require a native cursor atlas when the cursor is baked into the overlay sidecar", () => {
		// Regression: the previous guard skipped the whole native static-layout
		// route with "cursor-atlas-unavailable" for every cursor export (the atlas
		// was intentionally null when overlay layers are used), forcing the slow
		// renderer raw path. With overlay layers the cursor is baked into the
		// sidecar so a missing atlas must not skip.
		expect(
			shouldSkipForMissingCursorAtlas({
				needsOverlayLayers: true,
				hasCursorTelemetry: true,
				hasCursorAtlas: false,
			}),
		).toBe(false);
		expect(
			shouldSkipForMissingCursorAtlas({
				needsOverlayLayers: false,
				hasCursorTelemetry: true,
				hasCursorAtlas: false,
			}),
		).toBe(true);
		expect(
			shouldSkipForMissingCursorAtlas({
				needsOverlayLayers: false,
				hasCursorTelemetry: true,
				hasCursorAtlas: true,
			}),
		).toBe(false);
	});

	describe("strict HEVC Hardware CUDA policy", () => {
		it("never forces the renderer raw frame path for HEVC Hardware", () => {
			const exporter = createExporter({
				exportVideoCodec: "hevc",
				exportEncoderPreference: "hardware",
			});

			expect(exporter.requiresStrictNativeCudaRoute()).toBe(true);
			// Even without the CUDA eligibility flags, the raw fallback must not be
			// selected; the export hard-fails instead.
			expect(exporter.shouldForceNativeRawFrame()).toBe(false);
		});

		it("keeps HEVC Auto and H.264 Auto free of the strict raw-frame ban", () => {
			const hevcAuto = createExporter({
				exportVideoCodec: "hevc",
				exportEncoderPreference: "auto",
			});
			expect(hevcAuto.requiresStrictNativeCudaRoute()).toBe(false);

			const h264Auto = createExporter({
				exportVideoCodec: "h264",
				exportEncoderPreference: "auto",
			});
			expect(h264Auto.requiresStrictNativeCudaRoute()).toBe(false);
		});

		it("builds a hard-fail error with the first skip reason and noCpuFallback", () => {
			const exporter = createExporter({
				exportVideoCodec: "hevc",
				exportEncoderPreference: "hardware",
			});

			const error = exporter.buildStrictNativeCudaHardwareError("cursor-atlas-unavailable");
			expect(error.message).toContain("cursor-atlas-unavailable");
			expect(error.message).toContain("noCpuFallback:true");
			expect(error.message).toContain("requires the NVIDIA CUDA compositor");
			// The message must be actionable and must not point users at a hidden
			// "experimental" toggle that no longer gates the mandatory route.
			expect(error.message).toContain("switch the encoder preference to Auto");
			expect(error.message).not.toContain("experimental");
			expect((error as Error & { noCpuFallback?: boolean }).noCpuFallback).toBe(true);
		});

		it("surfaces the precise overlay preparation stage in the strict hard-fail error", () => {
			const exporter = createExporter({
				exportVideoCodec: "hevc",
				exportEncoderPreference: "hardware",
			}) as unknown as {
				buildStrictNativeCudaHardwareError: (reason: string) => Error;
				nativeStaticLayoutOverlayFailure: { stage: string; message: string } | null;
			};
			exporter.nativeStaticLayoutOverlayFailure = {
				stage: "overlay-renderer-frame",
				message: "overlay-renderer-frame: Overlay renderer is not initialized",
			};

			const error = exporter.buildStrictNativeCudaHardwareError(
				"native-overlay-preparation-failed",
			);
			expect(error.message).toContain("native-overlay-preparation-failed");
			expect(error.message).toContain("overlay-renderer-frame");
			expect(error.message).toContain("Overlay renderer is not initialized");
			expect(error.message).toContain("noCpuFallback:true");
		});
	});

	it("materializes uploaded data-url image backgrounds for native static-layout", async () => {
		const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
		const dataUrl = `data:image/jpeg;base64,${Buffer.from(jpegBytes).toString("base64")}`;
		const exporter = createExporter({ wallpaper: dataUrl });
		const electronAPI = window.electronAPI as typeof window.electronAPI & {
			openExportStream: ReturnType<typeof vi.fn>;
			writeExportStreamChunk: ReturnType<typeof vi.fn>;
			closeExportStream: ReturnType<typeof vi.fn>;
		};
		electronAPI.openExportStream = vi.fn(async () => ({
			success: true,
			streamId: "background-stream",
			tempPath: "C:/Temp/unused.jpg",
		}));
		electronAPI.writeExportStreamChunk = vi.fn(async () => ({ success: true }));
		electronAPI.closeExportStream = vi.fn(async () => ({
			success: true,
			tempPath: "C:/Temp/recordly-background.jpg",
			bytesWritten: jpegBytes.byteLength,
		}));

		await expect(exporter.resolveNativeStaticLayoutBackground()).resolves.toEqual({
			backgroundColor: "#101010",
			backgroundImagePath: "C:/Temp/recordly-background.jpg",
			temporaryPath: "C:/Temp/recordly-background.jpg",
		});
		expect(electronAPI.openExportStream).toHaveBeenCalledWith({ extension: "jpg" });
		expect(electronAPI.writeExportStreamChunk).toHaveBeenCalledTimes(1);
		const [, position, chunk] = electronAPI.writeExportStreamChunk.mock.calls[0];
		expect(position).toBe(0);
		expect(Array.from(chunk as Uint8Array)).toEqual(Array.from(jpegBytes));
		expect(electronAPI.closeExportStream).toHaveBeenCalledWith("background-stream");
	});

	it("parses rgba color stops in native gradient backgrounds", () => {
		const exporter = createExporter();
		const gradient = { addColorStop: vi.fn() };
		const ctx = {
			createLinearGradient: vi.fn(() => gradient),
			createRadialGradient: vi.fn(() => gradient),
		} as unknown as CanvasRenderingContext2D;

		const result = exporter.createNativeStaticLayoutGradient(
			ctx,
			"linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(249,202,86,1) 86.3% )",
		);

		expect(result).toBe(gradient);
		expect(gradient.addColorStop).toHaveBeenCalledTimes(3);
		expect(gradient.addColorStop).toHaveBeenNthCalledWith(1, 0, "rgba(114,167,232,1)");
		expect(gradient.addColorStop).toHaveBeenNthCalledWith(2, 0.5, "rgba(253,129,82,1)");
		expect(gradient.addColorStop).toHaveBeenNthCalledWith(3, 1, "rgba(249,202,86,1)");
	});

	it("allows non-tail trim timelines with native static-layout", () => {
		const exporter = createExporter({
			trimRegions: [{ id: "trim-1", startMs: 10_000, endMs: 12_000 }],
		});
		const effectiveDuration = exporter.getNativeStaticLayoutEffectiveDuration(videoInfo);

		expect(effectiveDuration).toBeCloseTo(58, 3);
		expect(exporter.buildNativeStaticLayoutVideoTimelineSegments(videoInfo)).toEqual([
			{
				sourceStartMs: 0,
				sourceEndMs: 10_000,
				outputStartMs: 0,
				outputEndMs: 10_000,
				speed: 1,
			},
			{
				sourceStartMs: 12_000,
				sourceEndMs: 60_000,
				outputStartMs: 10_000,
				outputEndMs: 58_000,
				speed: 1,
			},
		]);
		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "trim-source",
					audioSourcePath: "recording.mp4",
					trimSegments: [
						{ startMs: 0, endMs: 10_000 },
						{ startMs: 12_000, endMs: 60_000 },
					],
				},
				videoInfo,
				effectiveDuration,
			),
		).toBeNull();
	});

	it("requires the Windows GPU compositor for non-tail trim timelines", () => {
		const exporter = createExporter({
			experimentalNativeExport: false,
			trimRegions: [{ id: "trim-1", startMs: 10_000, endMs: 12_000 }],
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "trim-source",
					audioSourcePath: "recording.mp4",
					trimSegments: [
						{ startMs: 0, endMs: 10_000 },
						{ startMs: 12_000, endMs: 60_000 },
					],
				},
				videoInfo,
				58,
			),
		).toBe("native-timeline-requires-windows-gpu");
	});

	it("requires the Windows GPU compositor for speed timelines", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({ experimentalNativeExport: false, speedRegions });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				59,
			),
		).toBe("native-timeline-requires-windows-gpu");
	});

	it("uses speed timeline duration during native static-layout preflight", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({ speedRegions });

		expect(exporter.getNativeStaticLayoutEffectiveDuration(videoInfo)).toBeCloseTo(59, 3);
	});

	it("builds native timeline maps for the editor speed range endpoints", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 2_000, speed: 0.25 },
			{ id: "speed-2", startMs: 4_000, endMs: 5_000, speed: 30 },
		];
		const exporter = createExporter({ speedRegions });

		expect(
			exporter
				.buildNativeStaticLayoutVideoTimelineSegments(videoInfo)
				.map((segment) => segment.speed),
		).toEqual([1, 0.25, 1, 30, 1]);
		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				63.033,
			),
		).toBeNull();
	});

	it("allows native speed timelines through the Windows GPU timeline map", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({ speedRegions });

		expect(exporter.buildNativeStaticLayoutVideoTimelineSegments(videoInfo)).toEqual([
			{
				sourceStartMs: 0,
				sourceEndMs: 1_000,
				outputStartMs: 0,
				outputEndMs: 1_000,
				speed: 1,
			},
			{
				sourceStartMs: 1_000,
				sourceEndMs: 4_000,
				outputStartMs: 1_000,
				outputEndMs: 3_000,
				speed: 1.5,
			},
			{
				sourceStartMs: 4_000,
				sourceEndMs: 60_000,
				outputStartMs: 3_000,
				outputEndMs: 59_000,
				speed: 1,
			},
		]);
		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				60,
			),
		).toBeNull();
	});

	it("rejects native static-layout when speed edits are outside the editor speed range", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 31 },
		];
		const exporter = createExporter({ speedRegions });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				58,
			),
		).toBe("unsupported-native-speed-timeline");
	});

	it("allows speed-only projects when audio and video share filtergraph segments", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({ speedRegions });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "filtergraph-fast-path",
					audioSourcePath: "recording.mp4",
					audioSourceSampleRate: 48_000,
					editedTrackSegments: [
						{ startMs: 0, endMs: 1_000, speed: 1 },
						{ startMs: 1_000, endMs: 4_000, speed: 1.5 },
						{ startMs: 4_000, endMs: 60_000, speed: 1 },
					],
				},
				videoInfo,
				59,
			),
		).toBeNull();
	});

	it("allows slow-speed timelines through native frame duplication", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 0.5 },
		];
		const exporter = createExporter({ speedRegions });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "filtergraph-fast-path",
					audioSourcePath: "recording.mp4",
					audioSourceSampleRate: 48_000,
					editedTrackSegments: [
						{ startMs: 0, endMs: 1_000, speed: 1 },
						{ startMs: 1_000, endMs: 4_000, speed: 0.5 },
						{ startMs: 4_000, endMs: 60_000, speed: 1 },
					],
				},
				videoInfo,
				63,
			),
		).toBeNull();
	});

	it("falls back for slow-speed webcam timelines with overlay layers", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 0.5 },
		];
		const exporter = createExporter({
			speedRegions,
			webcam: {
				enabled: true,
				sourcePath: "C:\\recordly\\webcam.mp4",
			},
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				63,
			),
		).toBe("overlay-layers-do-not-support-native-timeline");
	});

	it("allows native static layout for rectangular webcam overlays", () => {
		const exporter = createExporter({
			webcam: {
				enabled: true,
				sourcePath: "C:\\recordly\\webcam.mp4",
				width: 60,
				height: 35,
			},
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				60,
			),
		).toBeNull();
	});

	it("falls back for native speed timelines with overlay layers", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({
			speedRegions,
			webcam: {
				enabled: true,
				sourcePath: "C:\\recordly\\webcam.mp4",
			},
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "filtergraph-fast-path",
					audioSourcePath: "recording.mp4",
					audioSourceSampleRate: 48_000,
					editedTrackSegments: [
						{ startMs: 0, endMs: 1_000, speed: 1 },
						{ startMs: 1_000, endMs: 4_000, speed: 1.5 },
						{ startMs: 4_000, endMs: 60_000, speed: 1 },
					],
				},
				videoInfo,
				59,
			),
		).toBe("overlay-layers-do-not-support-native-timeline");
	});
});
