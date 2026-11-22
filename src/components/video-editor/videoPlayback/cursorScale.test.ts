import { describe, expect, it } from "vitest";
import { getCursorViewportScale } from "./cursorScale";

describe("cursor preview/export scale", () => {
	it("preserves the same cursor-to-video ratio at preview and export sizes", () => {
		const baseCursorHeight = 28 * 2.5;
		const previewWidth = 720;
		const exportWidth = 2940;
		const previewCursorHeight = baseCursorHeight * getCursorViewportScale(previewWidth);
		const exportCursorHeight = baseCursorHeight * getCursorViewportScale(exportWidth);

		expect(previewCursorHeight / previewWidth).toBeCloseTo(exportCursorHeight / exportWidth, 8);
	});
});
