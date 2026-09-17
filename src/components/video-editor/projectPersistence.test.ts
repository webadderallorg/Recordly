import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getDefaultBorderRadiusPercent,
	legacyBorderRadiusPixelsToPercent,
	normalizeProjectEditor,
	resolveVideoUrl,
} from "./projectPersistence";
import { ADVANCED_VERTICAL_PADDING_MAX } from "./types";

afterEach(() => vi.unstubAllGlobals());

describe("resolveVideoUrl", () => {
	it("does not send an already renderable URL through the local-path IPC", async () => {
		const getLocalMediaUrl = vi.fn();
		vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });

		await expect(resolveVideoUrl("http://127.0.0.1:1234/video?path=test")).resolves.toBe(
			"http://127.0.0.1:1234/video?path=test",
		);
		expect(getLocalMediaUrl).not.toHaveBeenCalled();
	});

	it("normalizes a file URL before requesting a local media URL", async () => {
		const getLocalMediaUrl = vi.fn().mockResolvedValue({
			success: true,
			url: "http://127.0.0.1:1234/video?path=clip",
		});
		vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });

		await resolveVideoUrl("file:///Users/demo/My%20Clip.mp4");
		expect(getLocalMediaUrl).toHaveBeenCalledWith("/Users/demo/My Clip.mp4");
	});
});

describe("normalizeProjectEditor", () => {
	it("ignores retired temporal blur fields when opening an older project", () => {
		const savedEditor = {
			zoomMotionBlur: 0.6,
			zoomTemporalMotionBlur: 0.35,
			zoomMotionBlurSampleCount: 13,
			zoomMotionBlurShutterFraction: 0.94,
		};
		const normalized = normalizeProjectEditor(savedEditor);
		expect(normalized.zoomMotionBlur).toBe(0.6);
		for (const field of ["zoomTemporalMotionBlur", "zoomMotionBlurSampleCount", "zoomMotionBlurShutterFraction"]) {
			expect(normalized).not.toHaveProperty(field);
		}
	});
	it("defaults to 8% on macOS and square corners elsewhere", () => {
		expect(getDefaultBorderRadiusPercent("MacIntel")).toBe(8);
		expect(getDefaultBorderRadiusPercent("Win32")).toBe(0);
		expect(getDefaultBorderRadiusPercent("Linux x86_64")).toBe(0);
	});

	it("clamps radius percentages", () => {
		expect(normalizeProjectEditor({ borderRadius: 75 }).borderRadius).toBe(50);
	});

	it("converts legacy 1080p-relative radius pixels to percentages", () => {
		expect(legacyBorderRadiusPixelsToPercent(54)).toBe(5);
	});

	it("preserves the extended advanced vertical padding range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: 240,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 22,
				right: 22,
				linked: false,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 240,
			bottom: ADVANCED_VERTICAL_PADDING_MAX,
			left: 22,
			right: 22,
			linked: false,
		});
	});

	it("keeps linked padding clamped to the original range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: ADVANCED_VERTICAL_PADDING_MAX,
				right: ADVANCED_VERTICAL_PADDING_MAX,
				linked: true,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 100,
			bottom: 100,
			left: 100,
			right: 100,
			linked: true,
		});
	});

	it("migrates legacy webcam radius pixels to percentage roundness", () => {
		const editor = normalizeProjectEditor({
			webcam: {
				cornerRadius: 90,
				width: 40,
				height: 40,
			} as never,
		});

		expect(editor.webcam.roundness).toBeCloseTo(17.36, 1);
		expect(editor.webcam.cornerRadius).toBeUndefined();
	});

	it("uses the legacy webcam size when migrating radius pixels", () => {
		const editor = normalizeProjectEditor({
			webcam: {
				cornerRadius: 90,
				size: 80,
			} as never,
		});

		expect(editor.webcam.width).toBe(80);
		expect(editor.webcam.height).toBe(80);
		expect(editor.webcam.roundness).toBeCloseTo(4.34, 1);
	});
});

describe("normalizeProjectEditor spotlight annotations", () => {
	const baseRegion = {
		id: "annotation-1",
		startMs: 1000,
		endMs: 2000,
		content: "",
		position: { x: 10, y: 10 },
		size: { width: 30, height: 20 },
		zIndex: 1,
	};

	it("keeps the spotlight type and clamps its opacity", () => {
		const editor = normalizeProjectEditor({
			annotationRegions: [
				{ ...baseRegion, type: "spotlight", spotlightOpacity: 140, disabled: true },
			],
		} as never);
		const [region] = editor.annotationRegions;
		expect(region.type).toBe("spotlight");
		expect(region.spotlightOpacity).toBe(100);
		expect(region.disabled).toBe(true);
	});

	it("defaults a spotlight without opacity to 50 and leaves it enabled", () => {
		const editor = normalizeProjectEditor({
			annotationRegions: [{ ...baseRegion, type: "spotlight" }],
		} as never);
		const [region] = editor.annotationRegions;
		expect(region.spotlightOpacity).toBe(50);
		expect(region.disabled).toBeUndefined();
	});

	it("does not add spotlight fields to other annotation types", () => {
		const editor = normalizeProjectEditor({
			annotationRegions: [{ ...baseRegion, type: "blur" }],
		} as never);
		const [region] = editor.annotationRegions;
		expect(region.spotlightOpacity).toBeUndefined();
		expect(region.disabled).toBeUndefined();
	});
});
