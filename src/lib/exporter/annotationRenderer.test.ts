import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationRegion } from "@/components/video-editor/types";

class CanvasStub {
	private backingWidth = 300;
	private backingHeight = 150;
	readonly context = {
		canvas: this,
		save: vi.fn(),
		restore: vi.fn(),
		beginPath: vi.fn(),
		rect: vi.fn(),
		clip: vi.fn(),
		fillRect: vi.fn(),
		filter: "none",
		fillStyle: "",
		drawImage: vi.fn((source: CanvasStub) => {
			if (source.width === 0 || source.height === 0) {
				throw new Error(
					"The image argument is a canvas element with a width or height of 0.",
				);
			}
		}),
	};

	get width() {
		return this.backingWidth;
	}
	set width(value: number) {
		// Canvas dimension attributes truncate fractional values to integers.
		this.backingWidth = Math.trunc(value);
	}
	get height() {
		return this.backingHeight;
	}
	set height(value: number) {
		this.backingHeight = Math.trunc(value);
	}
	getContext() {
		return this.context;
	}
}

function blurAnnotation(overrides: Partial<AnnotationRegion> = {}): AnnotationRegion {
	return {
		id: "blur",
		type: "blur",
		content: "",
		startMs: 0,
		endMs: 10_000,
		position: { x: 50, y: 50 },
		size: { width: 10, height: 10 },
		blurIntensity: 20,
		style: {
			color: "#ffffff",
			backgroundColor: "transparent",
			fontSize: 32,
			fontFamily: "sans-serif",
			fontWeight: "normal",
			fontStyle: "normal",
			textDecoration: "none",
			textAlign: "center",
			borderRadius: 0,
		},
		zIndex: 1,
		...overrides,
	};
}

describe("blur annotation sampling at canvas edges", () => {
	let renderAnnotations: typeof import("./annotationRenderer").renderAnnotations;
	let scratch: CanvasStub[];
	let target: CanvasStub;

	beforeEach(async () => {
		vi.resetModules();
		scratch = [];
		target = new CanvasStub();
		target.width = 100;
		target.height = 100;
		vi.stubGlobal("document", {
			createElement: () => {
				const canvas = new CanvasStub();
				scratch.push(canvas);
				return canvas;
			},
		});
		({ renderAnnotations } = await import("./annotationRenderer"));
	});
	afterEach(() => vi.unstubAllGlobals());

	it("keeps the padded sample drawable when a zoom moves it across the bottom-right edge", async () => {
		await expect(
			renderAnnotations(
				target.context as unknown as CanvasRenderingContext2D,
				[blurAnnotation()],
				100,
				100,
				1000,
				1,
				undefined,
				{ scale: 2, x: 79.75, y: 79.75 },
			),
		).resolves.toBeUndefined();

		expect(target.context.save).toHaveBeenCalledTimes(1);
		expect(target.context.restore).toHaveBeenCalledTimes(1);
		expect(scratch[0].width).toBe(1);
		expect(scratch[0].height).toBe(1);
		expect(scratch[0].context.drawImage).toHaveBeenCalledWith(target, 99, 99, 1, 1, 0, 0, 1, 1);
		expect(target.context.drawImage).toHaveBeenCalledWith(scratch[0], 99, 99);
		expect(target.context.rect).toHaveBeenCalledWith(179.75, 179.75, 20, 20);
	});

	it("still composites a visible subpixel annotation instead of discarding the edge sliver", async () => {
		await renderAnnotations(
			target.context as unknown as CanvasRenderingContext2D,
			[blurAnnotation({ position: { x: 99.75, y: 99.75 }, blurIntensity: 0 })],
			100,
			100,
			1000,
		);

		expect(target.context.save).toHaveBeenCalledTimes(1);
		expect(target.context.restore).toHaveBeenCalledTimes(1);
		expect(target.context.rect).toHaveBeenCalledWith(99.75, 99.75, 10, 10);
		expect(target.context.drawImage).toHaveBeenCalledWith(scratch[0], 99, 99);
		expect(scratch[0].width).toBe(1);
		expect(scratch[0].height).toBe(1);
	});

	it("clips the padded sample to its actual right and bottom bounds when it starts offscreen", async () => {
		await renderAnnotations(
			target.context as unknown as CanvasRenderingContext2D,
			[
				blurAnnotation({
					position: { x: -10, y: -10 },
					size: { width: 15, height: 15 },
					blurIntensity: 2,
				}),
			],
			100,
			100,
			1000,
		);

		expect(target.context.save).toHaveBeenCalledTimes(1);
		expect(target.context.restore).toHaveBeenCalledTimes(1);
		expect(scratch[0].context.drawImage).toHaveBeenCalledWith(target, 0, 0, 9, 9, 0, 0, 9, 9);
		expect(target.context.drawImage).toHaveBeenCalledWith(scratch[0], 0, 0);
	});

	it("calibrates final redaction blur from recording width instead of wallpaper/output scale", async () => {
		target.width = 1920;
		target.height = 1080;
		let appliedFilter = "";
		target.context.drawImage.mockImplementationOnce(() => {
			appliedFilter = target.context.filter;
		});
		await renderAnnotations(
			target.context as unknown as CanvasRenderingContext2D,
			[blurAnnotation()],
			1920,
			1080,
			1000,
			4,
			undefined,
			{ scale: 2, x: 0, y: 0 },
			{ x: 100, y: 100, width: 960, height: 540 },
		);
		expect(appliedFilter).toBe("blur(20px)");
		expect(target.context.restore).toHaveBeenCalledTimes(1);
	});
});
