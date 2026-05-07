import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRegion, SpeedRegion } from "@/components/video-editor/types";
import { ModernVideoExporter } from "./modernVideoExporter";
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
		resolveNativeStaticLayoutBackground: () => Promise<unknown>;
		createNativeStaticLayoutGradient: (
			ctx: CanvasRenderingContext2D,
			wallpaper: string,
		) => CanvasGradient | null;
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
		).toEqual({
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
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

	it("reports frame overlays as the remaining native overlay blocker", () => {
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
		).toBe("unsupported-frame-overlay");
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

	it("uses speed timeline duration during native static-layout preflight", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({ speedRegions });

		expect(exporter.getNativeStaticLayoutEffectiveDuration(videoInfo)).toBeCloseTo(59, 3);
	});

	it("allows native speed timelines when audio needs offline rendering", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({ speedRegions });

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

	it("rejects native static-layout when speed edits do not have a native timeline map", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 3 },
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

	it("allows speed-only native static-layout when audio and video share filtergraph segments", () => {
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

	it("allows slow-speed native static-layout when a timeline map is available", () => {
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

	it("allows slow-speed native timelines with webcam when audio renders offline", () => {
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
		).toBeNull();
	});

	it("allows native speed timelines with a resolvable webcam source", () => {
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
		).toBeNull();
	});
});
