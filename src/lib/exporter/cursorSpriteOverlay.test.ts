import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { renderTextureCreatesMock } = vi.hoisted(() => ({
	renderTextureCreatesMock: [] as Array<{
		width: number;
		height: number;
		destroy: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("pixi.js", () => ({
	Matrix: class {
		a: number;
		b: number;
		c: number;
		d: number;
		tx: number;
		ty: number;

		constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
			this.a = a;
			this.b = b;
			this.c = c;
			this.d = d;
			this.tx = tx;
			this.ty = ty;
		}
	},
	RenderTexture: {
		create: vi.fn((options: { width: number; height: number }) => {
			const instance = {
				width: options.width,
				height: options.height,
				destroy: vi.fn(),
			};
			renderTextureCreatesMock.push(instance);
			return instance;
		}),
	},
	Container: class {},
}));

import {
	buildCursorSpriteRenderTransform,
	type CursorRect,
	CursorSpriteCapturer,
	type CursorSpriteRenderer,
	clampCursorRoiToCanvas,
	DEFAULT_CURSOR_SPRITE_EXPANSION,
	expandCursorBounds,
	isValidCursorBounds,
	resolveCursorRoi,
} from "./cursorSpriteOverlay";

const TEST_EXPANSION = {
	filterBlurPadding: 4,
	rotationSwayPadding: 2,
	clickRingPadding: 6,
	motionBlurPadding: 8,
};

function createMockRenderer(overrides: Partial<CursorSpriteRenderer> = {}): CursorSpriteRenderer {
	return {
		render: vi.fn(),
		extract: {
			pixels: vi.fn(),
		},
		...overrides,
	} as unknown as CursorSpriteRenderer;
}

describe("resolveCursorRoi geometry", () => {
	it("expands cursor bounds by all effect paddings and clamps safely", () => {
		const bounds: CursorRect = { x: 100, y: 100, width: 10, height: 10 };
		const result = resolveCursorRoi(bounds, 200, 200, TEST_EXPANSION);

		expect(result.available).toBe(true);
		if (!result.available) return;
		// total pad = 4 + 2 + 6 + 8 = 20; expanded x=80,y=80,w=50,h=50; fully inside canvas.
		expect(result.roi).toEqual({ x: 80, y: 80, width: 50, height: 50 });
	});

	it("aligns expanded bounds to whole pixels", () => {
		const bounds: CursorRect = { x: 100.4, y: 100.6, width: 10.2, height: 10.9 };
		const expanded = expandCursorBounds(bounds, TEST_EXPANSION);
		expect(expanded.x).toBe(Math.floor(100.4 - 20));
		expect(expanded.y).toBe(Math.floor(100.6 - 20));
		expect(expanded.width).toBe(Math.ceil(10.2 + 40));
		expect(expanded.height).toBe(Math.ceil(10.9 + 40));
	});

	it("uses a fixed default expansion by default (SSOT base)", () => {
		const total = DEFAULT_CURSOR_SPRITE_EXPANSION;
		expect(total.filterBlurPadding).toBeGreaterThan(0);
		expect(total.rotationSwayPadding).toBeGreaterThan(0);
		expect(total.clickRingPadding).toBeGreaterThan(0);
		expect(total.motionBlurPadding).toBeGreaterThan(0);
	});

	it("clamps a cursor near the right/bottom edge without clipping content", () => {
		const bounds: CursorRect = { x: 195, y: 195, width: 10, height: 10 };
		const result = resolveCursorRoi(bounds, 200, 200, TEST_EXPANSION);

		expect(result.available).toBe(true);
		if (!result.available) return;
		expect(result.roi.x).toBe(175);
		expect(result.roi.y).toBe(175);
		expect(result.roi.width).toBe(25);
		expect(result.roi.height).toBe(25);
	});

	it("clamps a cursor partially off the left/top edge to the canvas origin", () => {
		const bounds: CursorRect = { x: -50, y: -50, width: 10, height: 10 };
		const result = resolveCursorRoi(bounds, 200, 200, TEST_EXPANSION);

		expect(result.available).toBe(true);
		if (!result.available) return;
		expect(result.roi.x).toBe(0);
		expect(result.roi.y).toBe(0);
		expect(result.roi.width).toBeGreaterThan(0);
		expect(result.roi.height).toBeGreaterThan(0);
	});

	it("reports unavailable for malformed (non-finite) bounds", () => {
		const malformed: CursorRect[] = [
			{ x: Number.NaN, y: 0, width: 10, height: 10 },
			{ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 },
			{ x: 0, y: 0, width: -5, height: 10 },
			{ x: 0, y: 0, width: 0, height: 0 },
		];
		for (const bounds of malformed) {
			const result = resolveCursorRoi(bounds, 200, 200, TEST_EXPANSION);
			expect(result.available).toBe(false);
		}
	});

	it("reports unavailable for malformed output canvas", () => {
		const result = resolveCursorRoi(
			{ x: 0, y: 0, width: 10, height: 10 },
			0,
			200,
			TEST_EXPANSION,
		);
		expect(result.available).toBe(false);
	});

	it("isEmpty/invalid detection rejects empty bounds", () => {
		expect(isValidCursorBounds({ x: 0, y: 0, width: 0, height: 0 })).toBe(false);
		expect(isValidCursorBounds({ x: 0, y: 0, width: 10, height: 10 })).toBe(true);
	});

	it("clamps a ROI helper directly to the canvas", () => {
		expect(clampCursorRoiToCanvas({ x: -10, y: -10, width: 30, height: 30 }, 100, 100)).toEqual(
			{
				x: 0,
				y: 0,
				width: 20,
				height: 20,
			},
		);
	});
});

describe("buildCursorSpriteRenderTransform", () => {
	it("shifts the world transform translation by the ROI origin", () => {
		const world = { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 50 };
		const transform = buildCursorSpriteRenderTransform(world as never, 10, 20);
		expect(transform.tx).toBe(90);
		expect(transform.ty).toBe(30);
		expect(transform.a).toBe(2);
		expect(transform.d).toBe(2);
	});
});

describe("CursorSpriteCapturer", () => {
	let renderer: CursorSpriteRenderer;
	let container: {
		visible: boolean;
		worldTransform: { a: number; b: number; c: number; d: number; tx: number; ty: number };
	};

	beforeEach(() => {
		renderTextureCreatesMock.length = 0;
		renderer = createMockRenderer();
		container = {
			visible: true,
			worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	function makeCapturer() {
		return new CursorSpriteCapturer({
			renderer,
			cursorContainer: container as never,
			outputWidth: 200,
			outputHeight: 200,
			expansion: TEST_EXPANSION,
		});
	}

	it("captures a sprite-sized readback and records its top-left position", () => {
		const capturer = makeCapturer();
		const bounds: CursorRect = { x: 100, y: 100, width: 10, height: 10 };
		const pixels = new Uint8ClampedArray(50 * 50 * 4);
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockReturnValue(pixels);

		const result = capturer.capture(bounds);

		expect(result.captured).toBe(true);
		expect(result.position).toEqual({ x: 80, y: 80 });
		// The cursor is rendered into the bounded target (clear: true) then read back.
		expect(renderer.render).toHaveBeenCalledTimes(1);
		expect(renderer.extract.pixels).toHaveBeenCalledTimes(1);
		const renderCall = (renderer.render as unknown as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(renderCall.container).toBe(container);
		expect(renderCall.clear).toBe(true);
		expect(renderCall.transform.tx).toBe(-80);
		expect(renderCall.transform.ty).toBe(-80);

		const strip = capturer.finish();
		expect(strip).not.toBeNull();
		if (!strip) return;
		expect(strip.width).toBe(50);
		expect(strip.height).toBe(50);
		expect(strip.frameCount).toBe(1);
		expect(strip.frames.length).toBe(50 * 50 * 4);
		expect(strip.positions).toEqual([{ x: 80, y: 80 }]);
		capturer.destroy();
	});

	it("reuses the previous frame when content signature and ROI are unchanged", () => {
		const capturer = makeCapturer();
		const bounds: CursorRect = { x: 100, y: 100, width: 10, height: 10 };
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockReturnValue(
			new Uint8ClampedArray(50 * 50 * 4),
		);

		const first = capturer.capture(bounds, "sig-v1");
		expect(first.captured).toBe(true);
		expect(renderer.render).toHaveBeenCalledTimes(1);
		expect(renderer.extract.pixels).toHaveBeenCalledTimes(1);

		// Identical signature + identical ROI: no re-render, no readback, but the
		// frame is still recorded (fixed strip must stay aligned per output frame).
		const second = capturer.capture(bounds, "sig-v1");
		expect(second.captured).toBe(true);
		expect(second.position).toEqual({ x: 80, y: 80 });
		expect(renderer.render).toHaveBeenCalledTimes(1);
		expect(renderer.extract.pixels).toHaveBeenCalledTimes(1);

		const strip = capturer.finish();
		expect(strip?.frameCount).toBe(2);
		// Both frames share the identical bytes.
		const frame = 50 * 50 * 4;
		expect(
			strip?.frames.subarray(0, frame).every((value, index) => {
				return strip.frames.subarray(frame, frame * 2)[index] === value;
			}),
		).toBe(true);
		capturer.destroy();
	});

	it("re-renders when the content signature changes despite an identical ROI", () => {
		const capturer = makeCapturer();
		const bounds: CursorRect = { x: 100, y: 100, width: 10, height: 10 };
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockReturnValue(
			new Uint8ClampedArray(50 * 50 * 4),
		);

		capturer.capture(bounds, "sig-v1");
		const second = capturer.capture(bounds, "sig-v2");

		expect(second.captured).toBe(true);
		expect(renderer.render).toHaveBeenCalledTimes(2);
		expect(renderer.extract.pixels).toHaveBeenCalledTimes(2);
		capturer.destroy();
	});

	it("re-renders when the ROI moves even with an unchanged signature", () => {
		const capturer = makeCapturer();
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockReturnValue(
			new Uint8ClampedArray(50 * 50 * 4),
		);

		capturer.capture({ x: 100, y: 100, width: 10, height: 10 }, "sig-v1");
		capturer.capture({ x: 120, y: 100, width: 10, height: 10 }, "sig-v1");

		expect(renderer.render).toHaveBeenCalledTimes(2);
		expect(renderer.extract.pixels).toHaveBeenCalledTimes(2);
		capturer.destroy();
	});

	it("grows the fixed strip to the max ROI without clipping previous frames", () => {
		const capturer = makeCapturer();
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockImplementation(
			(rt: { width: number; height: number }) =>
				new Uint8ClampedArray(rt.width * rt.height * 4),
		);

		capturer.capture({ x: 100, y: 100, width: 10, height: 10 });
		capturer.capture({ x: 50, y: 50, width: 60, height: 60 });

		expect(renderTextureCreatesMock.length).toBe(2);
		const strip = capturer.finish();
		expect(strip).not.toBeNull();
		if (!strip) return;
		// second frame expanded: x=30,y=30,w=100,h=100 (pad 20).
		expect(strip.width).toBe(100);
		expect(strip.height).toBe(100);
		expect(strip.frameCount).toBe(2);
		expect(strip.frames.length).toBe(2 * 100 * 100 * 4);
		expect(strip.positions).toEqual([
			{ x: 80, y: 80 },
			{ x: 30, y: 30 },
		]);
		capturer.destroy();
	});

	it("reuses an existing render texture when the ROI fits (no per-frame allocation)", () => {
		const capturer = makeCapturer();
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockImplementation(
			(rt: { width: number; height: number }) =>
				new Uint8ClampedArray(rt.width * rt.height * 4),
		);

		capturer.capture({ x: 100, y: 100, width: 10, height: 10 });
		capturer.capture({ x: 120, y: 120, width: 10, height: 10 });
		// Same ROI size -> single render texture reused across both captures.
		expect(renderTextureCreatesMock.length).toBe(1);
		capturer.destroy();
	});

	it("renders a transparent placeholder frame when the cursor is hidden", () => {
		const capturer = makeCapturer();
		container.visible = false;
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockReturnValue(
			new Uint8ClampedArray(50 * 50 * 4),
		);

		const result = capturer.capture({ x: 100, y: 100, width: 10, height: 10 });

		expect(result.captured).toBe(true);
		expect(capturer.isCursorVisible).toBe(false);
		// No render or readback for a hidden cursor; transparent zero placeholder.
		expect(renderer.extract.pixels).not.toHaveBeenCalled();
		expect(renderer.render).not.toHaveBeenCalled();
		expect(capturer.finish()?.frameCount).toBe(1);
		capturer.destroy();
	});

	it("returns unavailable for malformed per-frame bounds", () => {
		const capturer = makeCapturer();
		const result = capturer.capture({
			x: Number.NaN,
			y: 0,
			width: 10,
			height: 10,
		});

		expect(result.captured).toBe(false);
		expect(result.unavailableReason).toBeTruthy();
		expect(renderer.render).not.toHaveBeenCalled();
		capturer.destroy();
	});

	it("cancel discards captured frames and releases the render target", () => {
		const capturer = makeCapturer();
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockReturnValue(
			new Uint8ClampedArray(50 * 50 * 4),
		);

		capturer.capture({ x: 100, y: 100, width: 10, height: 10 });
		expect(renderTextureCreatesMock).toHaveLength(1);
		const rt = renderTextureCreatesMock[0];

		capturer.cancel();

		expect(capturer.isClosed).toBe(true);
		expect(rt.destroy).toHaveBeenCalledWith(true);
		expect(capturer.finish()).toBeNull();
		// Further captures are refused once closed.
		expect(capturer.capture({ x: 100, y: 100, width: 10, height: 10 }).captured).toBe(false);
	});

	it("destroy also releases the render target and closes the session", () => {
		const capturer = makeCapturer();
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockReturnValue(
			new Uint8ClampedArray(50 * 50 * 4),
		);

		capturer.capture({ x: 100, y: 100, width: 10, height: 10 });
		const rt = renderTextureCreatesMock[0];

		capturer.destroy();

		expect(capturer.isClosed).toBe(true);
		expect(rt.destroy).toHaveBeenCalledWith(true);
	});

	it("supports precomputed fixed sprite dimensions via options", () => {
		renderer = createMockRenderer();
		const fixed = new CursorSpriteCapturer({
			renderer,
			cursorContainer: container as never,
			outputWidth: 200,
			outputHeight: 200,
			expansion: TEST_EXPANSION,
			maxSpriteWidth: 120,
			maxSpriteHeight: 120,
		});
		(renderer.extract.pixels as ReturnType<typeof vi.fn>).mockImplementation(
			(rt: { width: number; height: number }) =>
				new Uint8ClampedArray(rt.width * rt.height * 4),
		);

		fixed.capture({ x: 100, y: 100, width: 10, height: 10 });

		const strip = fixed.finish();
		expect(strip).not.toBeNull();
		if (!strip) return;
		expect(strip.width).toBe(120);
		expect(strip.height).toBe(120);
		expect(strip.frameCount).toBe(1);
		expect(strip.frames.length).toBe(120 * 120 * 4);
		fixed.destroy();
	});
});
