import { describe, expect, it } from "vitest";
import {
	DEFAULT_PREVIEW_RENDER_SCALE,
	normalizePreviewRenderScale,
	resolvePreviewRenderResolution,
} from "./previewRenderScale";

describe("preview render scale", () => {
	it("caps auto on high-DPI displays but follows low-DPI ones", () => {
		expect(resolvePreviewRenderResolution("auto", 2)).toBe(1.5);
		expect(resolvePreviewRenderResolution("auto", 1.25)).toBe(1.25);
		expect(resolvePreviewRenderResolution("auto", 1)).toBe(1);
	});

	it("native tracks the display and fixed scales ignore it", () => {
		expect(resolvePreviewRenderResolution("native", 2)).toBe(2);
		expect(resolvePreviewRenderResolution("0.5", 2)).toBe(0.5);
		expect(resolvePreviewRenderResolution("1", 3)).toBe(1);
	});

	it("falls back to 1 for a broken device pixel ratio", () => {
		expect(resolvePreviewRenderResolution("native", 0)).toBe(1);
		expect(resolvePreviewRenderResolution("auto", Number.NaN)).toBe(1);
	});

	it("rejects unknown stored values", () => {
		expect(normalizePreviewRenderScale("0.75")).toBe("0.75");
		expect(normalizePreviewRenderScale("2")).toBe(DEFAULT_PREVIEW_RENDER_SCALE);
		expect(normalizePreviewRenderScale(undefined)).toBe(DEFAULT_PREVIEW_RENDER_SCALE);
	});
});
