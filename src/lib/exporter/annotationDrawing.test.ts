import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULT_ANNOTATION_STYLE, type AnnotationRegion } from "@/components/video-editor/types";
import { getAnnotationTextLayout, renderText } from "./annotationDrawing";
import { renderAnnotationToCanvas } from "./annotationRenderer";

function annotation(content: string): AnnotationRegion {
	return {
		id: "text",
		type: "text",
		content,
		startMs: 0,
		endMs: 1000,
		position: { x: 10, y: 10 },
		size: { width: 30, height: 5 },
		style: { ...DEFAULT_ANNOTATION_STYLE, fontSize: 20 },
		zIndex: 1,
	};
}
function context() {
	return {
		save: vi.fn(),
		restore: vi.fn(),
		beginPath: vi.fn(),
		rect: vi.fn(),
		clip: vi.fn(),
		fillText: vi.fn((_text: string, _x: number, _y: number) => undefined),
		measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
		font: "",
		textBaseline: "",
		textAlign: "",
	};
}
afterEach(() => vi.unstubAllGlobals());

describe("text annotation overflow", () => {
	it("wraps narrow bounds at the same font size and paints below a short authored box", () => {
		const ctx = context();
		const text = annotation("first second third");
		const wide = getAnnotationTextLayout(
			ctx as unknown as CanvasRenderingContext2D,
			text,
			300,
			30,
			1,
		);
		const narrow = getAnnotationTextLayout(
			ctx as unknown as CanvasRenderingContext2D,
			text,
			110,
			30,
			1,
		);
		expect(wide.lines).toHaveLength(1);
		expect(narrow.lines).toEqual(["first ", "second ", "third"]);
		expect(narrow.scaledFontSize).toBe(wide.scaledFontSize);
		expect(narrow.height).toBeGreaterThan(30);
		renderText(ctx as unknown as CanvasRenderingContext2D, text, 10, 50, 110, 30, 1);
		expect(ctx.clip).not.toHaveBeenCalled();
		expect(ctx.fillText).toHaveBeenCalledTimes(3);
		expect(ctx.fillText.mock.calls[2][2]).toBeGreaterThan(80);
	});

	it("breaks long identifiers at grapheme boundaries within the text width", () => {
		const ctx = context();
		const layout = getAnnotationTextLayout(
			ctx as unknown as CanvasRenderingContext2D,
			annotation("ABCDEFGHIJKLMN"),
			84,
			30,
			1,
		);
		expect(layout.lines.join("")).toBe("ABCDEFGHIJKLMN");
		expect(layout.lines.length).toBeGreaterThan(1);
		for (const line of layout.lines)
			expect(ctx.measureText(line).width).toBeLessThanOrEqual(60);
		const emoji = getAnnotationTextLayout(
			ctx as unknown as CanvasRenderingContext2D,
			annotation("👩‍💻👩‍💻"),
			84,
			30,
			1,
		);
		expect(emoji.lines).toEqual(["👩‍💻", "👩‍💻"]);
	});

	it("rasterizes the same full text height for modern export sprites", async () => {
		const ctx = context();
		const canvas = { width: 0, height: 0, getContext: () => ctx };
		vi.stubGlobal("document", { createElement: () => canvas });
		const text = annotation("first\nsecond\nthird");
		const expected = getAnnotationTextLayout(
			ctx as unknown as CanvasRenderingContext2D,
			text,
			110,
			30,
			1,
		);
		const result = await renderAnnotationToCanvas(text, 110, 30, 1);
		expect(result).toBe(canvas);
		expect(canvas.width).toBe(110);
		expect(canvas.height).toBe(Math.ceil(expected.height));
		expect(ctx.fillText.mock.calls[0][2]).toBe(expected.startY);
		expect(ctx.fillText.mock.calls[2][2]).toBeLessThan(canvas.height);
	});
});
