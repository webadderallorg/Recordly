import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ANNOTATION_STYLE, type AnnotationRegion } from "../types";
import { preloadProjectHoverFonts } from "./projectHoverFonts";

const text = (overrides: Partial<AnnotationRegion> = {}): AnnotationRegion => ({
	id: "later-text",
	type: "text",
	startMs: 1000,
	endMs: 6000,
	content: "Later words",
	position: { x: 50, y: 50 },
	size: { width: 50, height: 20 },
	style: { ...DEFAULT_ANNOTATION_STYLE, fontFamily: '"DM Sans"', fontStyle: "italic" },
	zIndex: 1,
	...overrides,
});

describe("hover annotation font readiness", () => {
	it("waits for a future text overlay's actual face before the first reveal", async () => {
		let resolve!: () => void;
		const pending = new Promise<FontFace[]>((done) => {
			resolve = () => done([]);
		});
		const load = vi.fn(() => pending);
		let ready = false;
		const preload = preloadProjectHoverFonts([text()], { load }).then(() => {
			ready = true;
		});
		await Promise.resolve();
		expect(load).toHaveBeenCalledWith('italic bold 16px "DM Sans"', "Later words");
		expect(ready).toBe(false);
		resolve();
		await preload;
		expect(ready).toBe(true);
	});

	it("loads every needed glyph for a shared face and ignores overlays outside the hover", async () => {
		const load = vi.fn(async () => []);
		await preloadProjectHoverFonts(
			[
				text({ content: "Latin" }),
				text({ content: "漢字" }),
				text({ startMs: 5000, content: "After hover" }),
				text({ endMs: 0, content: "Before hover" }),
				text({ type: "image", content: "data:image/png;base64,fixture" }),
			],
			{ load },
		);
		expect(load).toHaveBeenCalledOnce();
		expect(load).toHaveBeenCalledWith('italic bold 16px "DM Sans"', "Latin漢字");
	});

	it("uses preview-specific loads even while unrelated document fonts are loading", async () => {
		const load = vi.fn(async () => []);
		const fonts = { status: "loading", load };
		await expect(preloadProjectHoverFonts([text()], fonts)).resolves.toBeUndefined();
		expect(fonts.status).toBe("loading");
	});

	it("reports a required font failure rather than revealing fallback text", async () => {
		const error = new Error("Required face failed");
		await expect(
			preloadProjectHoverFonts([text()], {
				load: vi.fn(async () => {
					throw error;
				}),
			}),
		).rejects.toBe(error);
	});

	it("does not depend on font loading support when there are no text faces", async () => {
		await expect(preloadProjectHoverFonts([], undefined)).resolves.toBeUndefined();
		const load = vi.fn(async () => []);
		await preloadProjectHoverFonts([], { load });
		expect(load).not.toHaveBeenCalled();
	});
});
