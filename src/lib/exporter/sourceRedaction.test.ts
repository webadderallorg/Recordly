import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AnnotationRegion, DEFAULT_ANNOTATION_STYLE } from "@/components/video-editor/types";
import { SourceRedactionCanvas } from "./sourceRedaction";

class CanvasStub {
	width = 300;
	height = 150;
	readonly draws: { filter: string; operation: string }[] = [];
	readonly fills: { filter: string; color: string }[] = [];
	private states: { filter: string; operation: GlobalCompositeOperation; fill: string }[] = [];
	readonly context = {
		canvas: this,
		filter: "none",
		globalCompositeOperation: "source-over" as GlobalCompositeOperation,
		fillStyle: "#000000",
		imageSmoothingEnabled: false,
		imageSmoothingQuality: "low",
		clearRect: vi.fn(),
		beginPath: vi.fn(),
		rect: vi.fn(),
		clip: vi.fn(),
		save: () =>
			this.states.push({
				filter: this.context.filter,
				operation: this.context.globalCompositeOperation,
				fill: this.context.fillStyle,
			}),
		restore: () => {
			const state = this.states.pop()!;
			this.context.filter = state.filter;
			this.context.globalCompositeOperation = state.operation;
			this.context.fillStyle = state.fill;
		},
		drawImage: vi.fn(() =>
			this.draws.push({
				filter: this.context.filter,
				operation: this.context.globalCompositeOperation,
			}),
		),
		fillRect: vi.fn(() =>
			this.fills.push({ filter: this.context.filter, color: this.context.fillStyle }),
		),
	};
	getContext() {
		return this.context;
	}
}
function annotation(overrides: Partial<AnnotationRegion> = {}): AnnotationRegion {
	return {
		id: "private",
		type: "blur",
		startMs: 100,
		endMs: 1000,
		content: "",
		position: { x: 20, y: 25 },
		size: { width: 40, height: 20 },
		style: DEFAULT_ANNOTATION_STYLE,
		zIndex: 1,
		blurIntensity: 20,
		...overrides,
	};
}
const options = {
	width: 1920,
	height: 1080,
	timeMs: 200,
	cropRegion: { x: 0.25, y: 0.2, width: 0.5, height: 0.6 },
};

describe("source redaction before decorative scene effects", () => {
	let canvases: CanvasStub[];
	beforeEach(() => {
		canvases = [];
		vi.stubGlobal("document", {
			createElement: () => {
				const canvas = new CanvasStub();
				canvases.push(canvas);
				return canvas;
			},
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it("leaves inactive frames on the original path without allocating a canvas", () => {
		const owner = new SourceRedactionCanvas();
		expect(
			owner.render({} as VideoFrame, { ...options, annotations: [annotation()], timeMs: 50 }),
		).toBeNull();
		expect(canvases).toHaveLength(0);
	});
	it("maps cropped recording percentages to source pixels and scales the radius before zoom", () => {
		new SourceRedactionCanvas().render({} as VideoFrame, {
			...options,
			annotations: [annotation()],
		});
		expect(canvases[0].context.rect).toHaveBeenCalledWith(672, 378, 384, 130);
		expect(canvases[0].draws).toEqual([
			{ filter: "none", operation: "source-over" },
			{ filter: "blur(10px)", operation: "copy" },
		]);
	});
	it("reuses bounded mask buffers and redraws changed annotations at the same timestamp", () => {
		const owner = new SourceRedactionCanvas();
		const first = owner.render({} as VideoFrame, { ...options, annotations: [annotation()] });
		for (let frame = 0; frame < 100; frame++)
			expect(
				owner.render({} as VideoFrame, { ...options, annotations: [annotation()] }),
			).toBe(first);
		expect(canvases).toHaveLength(2);
		expect(
			canvases.every(
				(canvas) => canvas.width <= options.width && canvas.height <= options.height,
			),
		).toBe(true);
		owner.render({} as VideoFrame, {
			...options,
			annotations: [annotation({ blurColor: "#ffffff" })],
		});
		expect(canvases[0].fills[canvases[0].fills.length - 1]?.color).toBe("#ffffff");
		owner.dispose();
		expect(first?.width).toBe(1920);
		expect(first?.height).toBe(1080);
	});
	it.each([
		"rgba(0, 0, 0, 0.2)",
		"#00000000",
	])("keeps blur underneath a partially transparent persisted tint %s", (blurColor) => {
		new SourceRedactionCanvas().render({} as VideoFrame, {
			...options,
			annotations: [annotation({ blurColor })],
		});
		expect(
			canvases[0].draws.some(
				(draw) => draw.filter === "blur(10px)" && draw.operation === "copy",
			),
		).toBe(true);
		expect(canvases[0].fills).toEqual([{ color: blurColor, filter: "none" }]);
	});
	it("can replace private pixels directly for a proven opaque solid fill", () => {
		new SourceRedactionCanvas().render({} as VideoFrame, {
			...options,
			annotations: [annotation({ blurColor: "#000000" })],
		});
		expect(canvases).toHaveLength(1);
		expect(canvases[0].fills).toEqual([{ color: "#000000", filter: "none" }]);
	});
	it("fails closed for active redactions if a context is unavailable", () => {
		vi.stubGlobal("document", {
			createElement: () => ({ width: 0, height: 0, getContext: () => null }),
		});
		expect(() =>
			new SourceRedactionCanvas().render({} as VideoFrame, {
				...options,
				annotations: [annotation()],
			}),
		).toThrow("redaction canvas is unavailable");
	});
	it("does not allocate an empty scratch canvas for a fully offscreen or fractional edge region", () => {
		new SourceRedactionCanvas().render({} as VideoFrame, {
			...options,
			annotations: [annotation({ position: { x: 200, y: 200 } })],
		});
		expect(canvases).toHaveLength(1);
		expect(canvases[0].context.rect).not.toHaveBeenCalled();
	});
});
