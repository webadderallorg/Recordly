import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRegion, SpeedRegion, ZoomRegion } from "@/components/video-editor/types";
import {
	computePaddedLayout,
	scalePreviewBorderRadius,
} from "@/components/video-editor/videoPlayback/layoutUtils";
import { ModernVideoExporter } from "./modernVideoExporter";
import { FrameRenderer } from "./modernFrameRenderer";
import { VideoMuxer } from "./muxer";
import { StreamingVideoDecoder } from "./streamingDecoder";
import { roundNativeStaticLayoutContentSize } from "./nativeStaticLayoutGeometry";
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
		tryExportNativeStaticLayout: (
			videoInfo: DecodedVideoInfo,
			audioPlan: { audioMode: "none" },
			effectiveDuration: number,
			totalFrames: number,
		) => Promise<{ success: boolean } | null>;
		buildNativeAudioPlan: (videoInfo: DecodedVideoInfo) => unknown;
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
		effectiveDurationSec: number;
		getNativeStaticLayoutCursorTelemetry: () => Array<{ cursorType?: string }> | undefined;
		getNativeStaticLayoutZoomTelemetry: (
			layout: {
				centerOffsetX: number;
				centerOffsetY: number;
				croppedDisplayWidth: number;
				croppedDisplayHeight: number;
			},
			totalFrames: number,
			cursorTelemetry: undefined,
		) => Array<{ timeMs: number; scale: number; x: number; y: number }> | undefined;
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ModernVideoExporter native static-layout eligibility", () => {
	it.each(
		[
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
	)("respects forcedSoftware=$forceSoftwareEncoding for complete $name export", async ({
		platform,
		backendPreference,
		experimentalNvidiaCudaExport,
		staticRoute,
		forceSoftwareEncoding,
	}) => {
		vi.stubGlobal("navigator", { platform });
		vi.stubGlobal("window", { electronAPI: {} });
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#000000",
			backendPreference,
			experimentalNvidiaCudaExport,
			forceSoftwareEncoding,
		} as never);
		const operations = exporter as unknown as {
			tryStartNativeVideoExport: () => Promise<boolean>;
			tryExportNativeStaticLayout: () => Promise<{ success: boolean; tempFilePath: string }>;
			loadNativeStaticLayoutVideoInfo: () => Promise<typeof videoInfo>;
			finishNativeVideoExport: () => Promise<{ success: boolean; tempFilePath: string }>;
			initializeEncoder: () => Promise<{
				codec: string;
				hardwareAcceleration: "prefer-software";
			}>;
		};
		try {
			vi.spyOn(StreamingVideoDecoder.prototype, "loadMetadata").mockResolvedValue({
				...videoInfo,
				hasAudio: false,
				audioCodec: undefined,
				audioSampleRate: undefined,
			});
			vi.spyOn(StreamingVideoDecoder.prototype, "getEffectiveDuration").mockReturnValue(0);
			vi.spyOn(StreamingVideoDecoder.prototype, "decodeAll").mockResolvedValue(undefined);
			vi.spyOn(FrameRenderer.prototype, "initialize").mockResolvedValue(undefined);
			vi.spyOn(VideoMuxer.prototype, "initialize").mockResolvedValue(undefined);
			vi.spyOn(VideoMuxer.prototype, "finalize").mockResolvedValue({
				mode: "buffer",
				blob: new Blob([], { type: "video/mp4" }),
			});
			const start = vi.spyOn(operations, "tryStartNativeVideoExport").mockResolvedValue(true);
			const layout = vi
				.spyOn(operations, "tryExportNativeStaticLayout")
				.mockResolvedValue({ success: true, tempFilePath: "/tmp/static.mp4" });
			vi.spyOn(operations, "loadNativeStaticLayoutVideoInfo").mockResolvedValue(videoInfo);
			vi.spyOn(operations, "finishNativeVideoExport").mockResolvedValue({
				success: true,
				tempFilePath: "/tmp/native.mp4",
			});
			const initialize = vi
				.spyOn(operations, "initializeEncoder")
				.mockResolvedValue({
					codec: "avc1.640033",
					hardwareAcceleration: "prefer-software",
				});
			const result = await exporter.export();
			expect(result.success).toBe(true);
			if (forceSoftwareEncoding) {
				expect(start).not.toHaveBeenCalled();
				expect(layout).not.toHaveBeenCalled();
				expect(initialize).toHaveBeenCalledOnce();
			} else {
				expect(layout).toHaveBeenCalledTimes(staticRoute ? 1 : 0);
				expect(start).toHaveBeenCalledTimes(staticRoute ? 0 : 1);
			}
		} finally {
			vi.restoreAllMocks();
		}
	});
	it("does not retry native hardware when forced software encoding is unavailable", async () => {
		vi.stubGlobal("navigator", { platform: "Linux x86_64" });
		vi.stubGlobal("window", { electronAPI: {} });
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
		const operations = exporter as unknown as {
			tryStartNativeVideoExport: () => Promise<boolean>;
			initializeEncoder: () => Promise<never>;
			finishNativeVideoExport: () => Promise<{ success: boolean; tempFilePath: string }>;
		};
		try {
			const start = vi.spyOn(operations, "tryStartNativeVideoExport").mockResolvedValue(true);
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
			expect(start).not.toHaveBeenCalled();
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("uses only software encoder candidates for recovery without changing codec or ordinary preference", () => {
		const preferred = { codec: "avc1.640034", hardwareAcceleration: "prefer-hardware" };
		const config = { codec: preferred.codec, preferredEncoderPath: preferred };
		const ordinary = new ModernVideoExporter(config as never) as unknown as {
			getEncoderCandidates: () => (typeof preferred)[];
		};
		expect(ordinary.getEncoderCandidates()[0]).toEqual(preferred);
		const recovery = new ModernVideoExporter({
			...config,
			forceSoftwareEncoding: true,
		} as never) as unknown as { getEncoderCandidates: () => (typeof preferred)[] };
		const candidates = recovery.getEncoderCandidates();
		expect(candidates.length).toBeGreaterThan(0);
		expect(
			candidates.every((candidate) => candidate.hardwareAcceleration === "prefer-software"),
		).toBe(true);
		expect(candidates[0].codec).toBe(preferred.codec);
	});

	function sampleRenderedCamera(overrides: Record<string, unknown>, timeMs: number) {
		const renderer = new FrameRenderer({
			width: 1920,
			height: 1080,
			wallpaper: "#000000",
			zoomRegions: [],
			showShadow: false,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: 1920,
			videoHeight: 1080,
			...overrides,
		} as never) as unknown as {
			cameraContainer: unknown;
			layoutCache: unknown;
			updateAnimationState: (time: number) => number;
			animationState: { scale: number; focusX: number; focusY: number };
		};
		renderer.cameraContainer = {};
		renderer.layoutCache = {
			stageSize: { width: 1920, height: 1080 },
			maskRect: { x: 0, y: 0, width: 1920, height: 1080 },
		};
		renderer.updateAnimationState(timeMs);
		return renderer.animationState;
	}
	it("projects auto-follow through the source crop in rendered export frames", () => {
		const state = sampleRenderedCamera(
			{
				cropRegion: { x: 0.5, y: 0.2, width: 0.5, height: 0.6 },
				zoomRegions: [
					{
						id: "auto",
						startMs: 0,
						endMs: 4000,
						depth: 6,
						focus: { cx: 0.6, cy: 0.4 },
						mode: "auto",
					},
				],
				cursorTelemetry: [
					{ timeMs: 0, cx: 0.6, cy: 0.4 },
					{ timeMs: 3000, cx: 0.6, cy: 0.4 },
				],
			},
			2000,
		);
		expect(state.focusX).toBeCloseTo(0.2);
		expect(state.focusY).toBeCloseTo(1 / 3);
	});
	it("honors configured zoom connection gaps and duration in rendered export frames", () => {
		const sample = (connectedZoomGapMs: number, connectedZoomDurationMs = 600) =>
			sampleRenderedCamera(
				{
					connectZooms: true,
					connectedZoomGapMs,
					connectedZoomDurationMs,
					zoomClassicMode: true,
					zoomInDurationMs: 100,
					zoomOutDurationMs: 100,
					zoomRegions: [
						{
							id: "first",
							startMs: 0,
							endMs: 1000,
							depth: 2,
							focus: { cx: 0.5, cy: 0.5 },
							mode: "manual",
						},
						{
							id: "second",
							startMs: 2000,
							endMs: 3000,
							depth: 4,
							focus: { cx: 0.5, cy: 0.5 },
							mode: "manual",
						},
					],
				},
				1500,
			).scale;
		expect(sample(3000)).toBeGreaterThan(sample(100));
		expect(sample(3000, 100)).toBeGreaterThan(sample(3000, 1000));
	});

	it("rejects traversal through the live native bundled-background resolver", async () => {
		vi.stubGlobal("window", {
			electronAPI: { getAssetBasePath: vi.fn(async () => "file:///Recordly/resources/") },
		});
		const exporter = new ModernVideoExporter({} as never) as unknown as {
			resolveNativeBundledAssetPath: (path: string) => Promise<string | null>;
		};
		await expect(
			exporter.resolveNativeBundledAssetPath("/wallpapers/known.jpg/../../../../private.png"),
		).resolves.toBeNull();
		await expect(
			exporter.resolveNativeBundledAssetPath("/wallpapers/%2e%2e%5cprivate.png"),
		).resolves.toBeNull();
	});

	it("exports the pixel-glove held click pose through the native exporter", () => {
		const exporter = createExporter({
			showCursor: true,
			cursorStyle: "pixel-hand",
			cursorTelemetry: [
				{
					timeMs: 0,
					cx: 0.5,
					cy: 0.5,
					cursorType: "arrow",
					interactionType: "click",
					mouseButton: 1,
				},
				{ timeMs: 1000, cx: 0.6, cy: 0.5, interactionType: "move" },
				{ timeMs: 2000, cx: 0.6, cy: 0.5, interactionType: "mouseup", mouseButton: 1 },
			],
		});
		exporter.effectiveDurationSec = 3;
		expect(
			exporter
				.getNativeStaticLayoutCursorTelemetry()
				?.some((sample) => sample.cursorType === "closed-hand"),
		).toBe(true);
	});
	it("centers a source click within the cropped native frame", () => {
		const exporter = createExporter({
			cropRegion: { x: 0.5, y: 0.2, width: 0.5, height: 0.6 },
			zoomClassicMode: true,
			zoomInDurationMs: 200,
			zoomOutDurationMs: 300,
			zoomRegions: [
				{
					id: "crop",
					startMs: 0,
					endMs: 4000,
					depth: 6,
					focus: { cx: 0.6, cy: 0.4 },
					mode: "auto",
				},
			],
		});
		const layout = {
			centerOffsetX: 0,
			centerOffsetY: 0,
			croppedDisplayWidth: 1920,
			croppedDisplayHeight: 1080,
		};
		const frame = exporter.getNativeStaticLayoutZoomTelemetry(layout, 91, undefined)![75];
		expect(frame.scale).toBe(5);
		expect(frame.x + 0.2 * 1920 * frame.scale).toBeCloseTo(960);
		expect(frame.y + (1 / 3) * 1080 * frame.scale).toBeCloseTo(540);
	});
	it("honors the configured connection gap between native zoom regions", () => {
		const zoomRegions = [
			{
				id: "first",
				startMs: 0,
				endMs: 1000,
				depth: 2,
				focus: { cx: 0.5, cy: 0.5 },
				mode: "manual",
			},
			{
				id: "second",
				startMs: 2000,
				endMs: 3000,
				depth: 2,
				focus: { cx: 0.5, cy: 0.5 },
				mode: "manual",
			},
		];
		const layout = {
			centerOffsetX: 0,
			centerOffsetY: 0,
			croppedDisplayWidth: 1920,
			croppedDisplayHeight: 1080,
		};
		const common = {
			zoomRegions,
			connectZooms: true,
			zoomClassicMode: true,
			zoomInDurationMs: 100,
			zoomOutDurationMs: 100,
		};
		const joined = createExporter({
			...common,
			connectedZoomGapMs: 3000,
		}).getNativeStaticLayoutZoomTelemetry(layout, 90, undefined)!;
		const separated = createExporter({
			...common,
			connectedZoomGapMs: 100,
		}).getNativeStaticLayoutZoomTelemetry(layout, 90, undefined)!;
		expect(joined[45].scale).toBeGreaterThan(separated[45].scale);
	});
	it("applies configured camera spring tuning to native zooms", () => {
		const zoomRegions = [
			{
				id: "first",
				startMs: 0,
				endMs: 1000,
				depth: 2,
				focus: { cx: 0.3, cy: 0.5 },
				mode: "manual",
			},
			{
				id: "second",
				startMs: 1200,
				endMs: 4000,
				depth: 4,
				focus: { cx: 0.7, cy: 0.5 },
				mode: "manual",
			},
		];
		const layout = {
			centerOffsetX: 0,
			centerOffsetY: 0,
			croppedDisplayWidth: 1920,
			croppedDisplayHeight: 1080,
		};
		const common = { zoomRegions, connectZooms: true, connectedZoomGapMs: 3000 };
		const soft = createExporter({
			...common,
			cameraSpringStiffnessMultiplier: 0.1,
		}).getNativeStaticLayoutZoomTelemetry(layout, 90, undefined)!;
		const firm = createExporter({
			...common,
			cameraSpringStiffnessMultiplier: 5,
		}).getNativeStaticLayoutZoomTelemetry(layout, 90, undefined)!;
		expect(firm[60].scale).toBeGreaterThan(soft[60].scale);
	});

	it.each([
		{ name: "a full frame", sourceWidth: 1920, sourceHeight: 1080, padding: 0 },
		{
			name: "a near-full frame before even rounding",
			sourceWidth: 1919,
			sourceHeight: 1080,
			padding: 0,
		},
		{ name: "a letterboxed video", sourceWidth: 1440, sourceHeight: 1080, padding: 0 },
		{ name: "a padded video", sourceWidth: 1920, sourceHeight: 1080, padding: 20 },
	])("preserves preview corner treatment for $name", async ({
		sourceWidth,
		sourceHeight,
		padding,
	}) => {
		const exporter = createExporter({ borderRadius: 5, padding });
		const nativeExport = vi.mocked(window.electronAPI.nativeStaticLayoutExport);
		nativeExport.mockResolvedValue({ success: true, tempPath: "/tmp/export.mp4" });
		const source = { ...videoInfo, width: sourceWidth, height: sourceHeight };
		const result = await exporter.tryExportNativeStaticLayout(
			source,
			{ audioMode: "none" },
			60,
			1800,
		);
		expect(result?.success).toBe(true);
		expect(nativeExport).toHaveBeenCalledTimes(1);
		const request = nativeExport.mock.calls[0][0];
		const layout = computePaddedLayout({
			width: 1920,
			height: 1080,
			padding,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			videoWidth: sourceWidth,
			videoHeight: sourceHeight,
		});
		const encodedSize = roundNativeStaticLayoutContentSize({
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
		});
		expect({ width: request.contentWidth, height: request.contentHeight }).toEqual(encodedSize);
		const previewRadius = scalePreviewBorderRadius(
			layout.croppedDisplayWidth,
			layout.croppedDisplayHeight,
			5,
			{ width: 1920, height: 1080 },
		);
		if (padding === 0 && sourceWidth >= 1919) {
			expect(previewRadius).toBe(0);
			expect(request.borderRadius).toBe(0);
			if (sourceWidth === 1919) expect(encodedSize).toEqual({ width: 1918, height: 1080 });
		} else {
			expect(previewRadius).toBeGreaterThan(0);
			// The inset radius stays proportional to the even content actually encoded.
			expect(request.borderRadius).toBeCloseTo(
				Math.min(encodedSize.width, encodedSize.height) * 0.05,
			);
		}
	});
	it("uses configured zoom transition durations for native telemetry", () => {
		const zoomRegions: ZoomRegion[] = [
			{
				id: "zoom-1",
				startMs: 0,
				endMs: 4_000,
				depth: 2,
				focus: { cx: 0.5, cy: 0.5 },
				mode: "manual",
			},
		];
		const layout = {
			centerOffsetX: 0,
			centerOffsetY: 0,
			croppedDisplayWidth: 1920,
			croppedDisplayHeight: 1080,
		};
		const fastExporter = createExporter({ zoomRegions, zoomInDurationMs: 100 });
		const slowExporter = createExporter({ zoomRegions, zoomInDurationMs: 2_000 });

		const fastSamples = fastExporter.getNativeStaticLayoutZoomTelemetry(layout, 60, undefined);
		const slowSamples = slowExporter.getNativeStaticLayoutZoomTelemetry(layout, 60, undefined);

		expect(fastSamples?.[30].scale).toBeGreaterThan(slowSamples?.[30].scale ?? 0);
	});

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

	it("preserves the cursor-to-video ratio at every native static-layout size", () => {
		const exporter = createExporter({ cursorSize: 3, cursorStyle: "tahoe" });

		// Native sizing includes texture padding; the visible Golden Gate body
		// occupies 859 of its 958 pixels. Compare visible height with the viewport.
		const bodyFraction = 859 / 958;
		expect(exporter.getNativeStaticLayoutCursorSize(1920) * bodyFraction).toBeCloseTo(84, 6);
		expect(exporter.getNativeStaticLayoutCursorSize(960) * bodyFraction).toBeCloseTo(42, 6);
		expect(exporter.getNativeStaticLayoutCursorSize(480) * bodyFraction).toBeCloseTo(21, 6);
	});

	it("skips native static-layout when cursor click effects are enabled", () => {
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
		).toBe("unsupported-cursor-click-effect");
	});

	it("skips native static-layout when click effects are enabled and cursor is hidden", () => {
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
		).toBe("unsupported-cursor-click-effect");
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
			"unsupported-annotation-overlay",
			"unsupported-caption-overlay",
			"native-webcam-style-mismatch",
			"unsupported-webcam-source",
		]);
	});

	it("reports invalid crop geometry instead of passing native export bad coordinates", () => {
		const exporter = createExporter({
			cropRegion: { x: 0, y: 0, width: 0, height: 1 },
		});

		expect(exporter.getNativeStaticLayoutSkipReason({ audioMode: "none" }, videoInfo, 60)).toBe(
			"invalid-crop-region",
		);
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

	it("uses the shared renderer for slow-speed webcam timelines", () => {
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
		).toBe("native-webcam-style-mismatch");
	});

	it("uses the shared renderer for rectangular webcam overlays", () => {
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
		).toBe("native-webcam-style-mismatch");
	});

	it("uses the shared renderer for native speed timelines with a webcam", () => {
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
		).toBe("native-webcam-style-mismatch");
	});
});
