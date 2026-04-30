import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyNativeFastVideoExportPlan } from "./nativeFastVideoExporter";

const baseConfig = {
	videoUrl: "file:///C:/Users/meiiie/Videos/source.mp4",
	sourceWidth: 1920,
	sourceHeight: 1080,
	sourceDurationMs: 60_000,
	width: 1920,
	height: 1080,
	frameRate: 30,
	bitrate: 20_000_000,
	encodingMode: "balanced" as const,
	wallpaper: "#000000",
	zoomRegions: [],
	trimRegions: [],
	speedRegions: [],
	showShadow: false,
	shadowIntensity: 0,
	backgroundBlur: 0,
	borderRadius: 0,
	padding: 0,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	webcam: { enabled: false, sourcePath: null },
	webcamUrl: null,
	annotationRegions: [],
	autoCaptions: [],
	cursorTelemetry: [],
	showCursor: false,
	frame: null,
	audioRegions: [],
	sourceAudioFallbackPaths: [],
};

describe("classifyNativeFastVideoExportPlan", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("allows source-only exports to bypass composed rendering", () => {
		vi.stubGlobal("window", {
			electronAPI: { nativeFastVideoExport: vi.fn() },
		});

		expect(classifyNativeFastVideoExportPlan(baseConfig)).toMatchObject({
			eligible: true,
			reason: "source-only timeline can bypass renderer",
		});
	});

	it("rejects scene styling that must be rendered by the compositor", () => {
		vi.stubGlobal("window", {
			electronAPI: { nativeFastVideoExport: vi.fn() },
		});

		expect(
			classifyNativeFastVideoExportPlan({
				...baseConfig,
				padding: { top: 20, right: 20, bottom: 20, left: 20 },
			}),
		).toMatchObject({
			eligible: false,
			reason: "scene styling requires composed rendering",
		});
	});

	it("allows one contiguous kept trim segment", () => {
		vi.stubGlobal("window", {
			electronAPI: { nativeFastVideoExport: vi.fn() },
		});

		expect(
			classifyNativeFastVideoExportPlan({
				...baseConfig,
				trimRegions: [{ id: "trim-start", startMs: 0, endMs: 10_000 }],
			}),
		).toMatchObject({
			eligible: true,
			segments: [{ startMs: 10_000, endMs: 60_000 }],
		});
	});

	it("rejects split timelines because they need full timeline composition", () => {
		vi.stubGlobal("window", {
			electronAPI: { nativeFastVideoExport: vi.fn() },
		});

		expect(
			classifyNativeFastVideoExportPlan({
				...baseConfig,
				trimRegions: [{ id: "trim-middle", startMs: 10_000, endMs: 20_000 }],
			}),
		).toMatchObject({
			eligible: false,
			reason: "multiple kept trim segments need composed export",
		});
	});
});
