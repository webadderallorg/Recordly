import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationRegion } from "@/components/video-editor/types";
import { DEFAULT_ANNOTATION_STYLE } from "@/components/video-editor/types";
import { computePaddedLayout } from "@/components/video-editor/videoPlayback/layoutUtils";
import {
	getAnnotationScaleFactor,
	placeAnnotation,
	renderAnnotations,
	renderAnnotationToCanvas,
} from "./annotationRenderer";

vi.mock("pixi.js", () => ({
	Application: class {},
	Graphics: class {},
	Sprite: class {},
}));

function textAnnotation(space?: "frame" | "screen"): AnnotationRegion {
	return {
		id: "a",
		startMs: 0,
		endMs: 1000,
		type: "text",
		content: "Title",
		textContent: "Title",
		position: { x: 10, y: 20 },
		size: { width: 50, height: 10 },
		style: { ...DEFAULT_ANNOTATION_STYLE },
		zIndex: 1,
		space,
	};
}

async function clipRect(annotation: AnnotationRegion) {
	const rects: number[][] = [];
	const ctx = new Proxy(
		{ measureText: () => ({ width: 10 }) },
		{
			get: (target, key) =>
				key in target
					? (target as never)[key]
					: key === "rect"
						? (...args: number[]) => rects.push(args)
						: () => undefined,
			set: () => true,
		},
	) as unknown as CanvasRenderingContext2D;
	await renderAnnotations(
		ctx,
		[annotation],
		1000,
		500,
		0,
		1,
		undefined,
		{ scale: 2, x: -300, y: -100 },
		{ x: 50, y: 25, width: 900, height: 450 },
	);
	return rects[0];
}

describe("renderAnnotations space", () => {
	it("frame follows the zoom and the recording rect", async () => {
		expect(await clipRect(textAnnotation())).toEqual([
			(50 + 90) * 2 - 300,
			(25 + 90) * 2 - 100,
			900,
			90,
		]);
	});

	it("screen ignores the zoom and the recording rect", async () => {
		expect(await clipRect(textAnnotation("screen"))).toEqual([100, 100, 500, 50]);
	});
});

const GLYPH_WIDTH_RATIO = 0.5;

type RasterState = {
	fillStyle: string;
	strokeStyle: string;
	globalAlpha: number;
	filter: string;
	globalCompositeOperation: string;
	font: string;
	textAlign: CanvasTextAlign;
	textBaseline: CanvasTextBaseline;
	clip: { x: number; y: number; width: number; height: number };
};

function toRgb(color: string): [number, number, number] {
	const hex = color.replace("#", "");
	const full =
		hex.length === 3 ? [...hex].map((channel) => channel + channel).join("") : hex.slice(0, 6);
	return [
		Number.parseInt(full.slice(0, 2), 16) || 0,
		Number.parseInt(full.slice(2, 4), 16) || 0,
		Number.parseInt(full.slice(4, 6), 16) || 0,
	];
}

function createRasterCanvas(width: number, height: number) {
	const pixels = new Uint8ClampedArray(width * height * 4);
	const paints: Array<{ alpha: number; filter: string; composite: string }> = [];
	let state: RasterState = {
		fillStyle: "#000000",
		strokeStyle: "#000000",
		globalAlpha: 1,
		filter: "none",
		globalCompositeOperation: "source-over",
		font: "10px sans-serif",
		textAlign: "start",
		textBaseline: "alphabetic",
		clip: { x: 0, y: 0, width, height },
	};
	const stack: RasterState[] = [];
	const texts: Array<{ text: string; left: number; top: number; width: number; height: number }> =
		[];
	let pending = { x: 0, y: 0, width: 0, height: 0 };

	const fontSize = () => Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? "10");
	const measure = (text: string) => text.length * fontSize() * GLYPH_WIDTH_RATIO;

	function paint(x: number, y: number, w: number, h: number, color: string) {
		paints.push({
			alpha: state.globalAlpha,
			filter: state.filter,
			composite: state.globalCompositeOperation,
		});
		const [r, g, b] = toRgb(color);
		const alpha = state.globalAlpha;
		const left = Math.max(0, Math.round(Math.max(x, state.clip.x)));
		const top = Math.max(0, Math.round(Math.max(y, state.clip.y)));
		const right = Math.min(width, Math.round(Math.min(x + w, state.clip.x + state.clip.width)));
		const bottom = Math.min(
			height,
			Math.round(Math.min(y + h, state.clip.y + state.clip.height)),
		);
		for (let py = top; py < bottom; py++) {
			for (let px = left; px < right; px++) {
				const index = (py * width + px) * 4;
				pixels[index] = r * alpha + pixels[index] * (1 - alpha);
				pixels[index + 1] = g * alpha + pixels[index + 1] * (1 - alpha);
				pixels[index + 2] = b * alpha + pixels[index + 2] * (1 - alpha);
				pixels[index + 3] = 255 * alpha + pixels[index + 3] * (1 - alpha);
			}
		}
	}

	const ctx = {
		canvas: { width, height },
		get fillStyle() {
			return state.fillStyle;
		},
		set fillStyle(value: string) {
			state.fillStyle = value;
		},
		get strokeStyle() {
			return state.strokeStyle;
		},
		set strokeStyle(value: string) {
			state.strokeStyle = value;
		},
		get globalAlpha() {
			return state.globalAlpha;
		},
		set globalAlpha(value: number) {
			state.globalAlpha = value;
		},
		get filter() {
			return state.filter;
		},
		set filter(value: string) {
			state.filter = value;
		},
		get globalCompositeOperation() {
			return state.globalCompositeOperation;
		},
		set globalCompositeOperation(value: string) {
			state.globalCompositeOperation = value;
		},
		get font() {
			return state.font;
		},
		set font(value: string) {
			state.font = value;
		},
		get textAlign() {
			return state.textAlign;
		},
		set textAlign(value: CanvasTextAlign) {
			state.textAlign = value;
		},
		get textBaseline() {
			return state.textBaseline;
		},
		set textBaseline(value: CanvasTextBaseline) {
			state.textBaseline = value;
		},
		lineWidth: 1,
		lineCap: "butt",
		lineJoin: "miter",
		imageSmoothingEnabled: true,
		imageSmoothingQuality: "high",
		shadowColor: "transparent",
		shadowBlur: 0,
		shadowOffsetX: 0,
		shadowOffsetY: 0,
		measureText: (text: string) => ({ width: measure(text) }),
		save: () => {
			stack.push({ ...state, clip: { ...state.clip } });
		},
		restore: () => {
			const previous = stack.pop();
			if (previous) state = previous;
		},
		beginPath: () => undefined,
		closePath: () => undefined,
		moveTo: () => undefined,
		lineTo: () => undefined,
		stroke: () => undefined,
		translate: () => undefined,
		scale: () => undefined,
		rect: (x: number, y: number, w: number, h: number) => {
			pending = { x, y, width: w, height: h };
		},
		roundRect: (x: number, y: number, w: number, h: number) => {
			pending = { x, y, width: w, height: h };
		},
		clip: () => {
			const x = Math.max(state.clip.x, pending.x);
			const y = Math.max(state.clip.y, pending.y);
			state.clip = {
				x,
				y,
				width: Math.min(state.clip.x + state.clip.width, pending.x + pending.width) - x,
				height: Math.min(state.clip.y + state.clip.height, pending.y + pending.height) - y,
			};
		},
		fill: () => paint(pending.x, pending.y, pending.width, pending.height, state.fillStyle),
		fillRect: (x: number, y: number, w: number, h: number) =>
			paint(x, y, w, h, state.fillStyle),
		clearRect: (x: number, y: number, w: number, h: number) => paint(x, y, w, h, "#000000"),
		drawImage: (source: { color?: string }, x = 0, y = 0, w = width, h = height) =>
			paint(x, y, w, h, source.color ?? "#000000"),
		fillText: (text: string, x: number, y: number) => {
			const size = fontSize();
			const runWidth = measure(text);
			const left =
				state.textAlign === "center"
					? x - runWidth / 2
					: state.textAlign === "right"
						? x - runWidth
						: x;
			const top = state.textBaseline === "middle" ? y - size / 2 : y - size;
			texts.push({ text, left, top, width: runWidth, height: size });
			paint(left, top, runWidth, size, state.fillStyle);
		},
	};

	return {
		ctx: ctx as unknown as CanvasRenderingContext2D,
		texts,
		paints,
		paintedBounds: () => {
			let left = width;
			let top = height;
			let right = 0;
			let bottom = 0;
			for (let py = 0; py < height; py++) {
				for (let px = 0; px < width; px++) {
					if (pixels[(py * width + px) * 4 + 3] === 0) continue;
					if (px < left) left = px;
					if (py < top) top = py;
					if (px + 1 > right) right = px + 1;
					if (py + 1 > bottom) bottom = py + 1;
				}
			}
			return { left, top, right, bottom };
		},
		pixelAt: (x: number, y: number) => {
			const index = (Math.round(y) * width + Math.round(x)) * 4;
			return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
		},
	};
}

const TILE_WIDTH = 1280;
const TILE_HEIGHT = 720;
const SCENE_SCALE_FACTOR = (TILE_WIDTH / 1920 + TILE_HEIGHT / 1080) / 2;
const WALLPAPER = "#102030";
const PICTURE = "#405060";

function titleAnnotation(space: "frame" | "screen"): AnnotationRegion {
	return {
		id: "title",
		startMs: 113000,
		endMs: 115600,
		type: "text",
		content: "Entries · Payroll",
		textContent: "Entries · Payroll",
		position: { x: 10, y: 40 },
		size: { width: 80, height: 20 },
		style: { ...DEFAULT_ANNOTATION_STYLE, fontSize: 64, color: "#FFFFFF" },
		zIndex: 1,
		space,
	};
}

const ZOOM = { scale: 2, x: -1000, y: -500 };
const MASK_RECT = { x: 64, y: 36, width: TILE_WIDTH - 128, height: TILE_HEIGHT - 72 };

async function rasterizeTitle(space: "frame" | "screen", annotationsFirst = false) {
	const raster = createRasterCanvas(TILE_WIDTH, TILE_HEIGHT);
	const { ctx } = raster;
	const drawScene = () => {
		ctx.fillStyle = WALLPAPER;
		ctx.fillRect(0, 0, TILE_WIDTH, TILE_HEIGHT);
		ctx.fillStyle = PICTURE;
		ctx.fillRect(MASK_RECT.x, MASK_RECT.y, MASK_RECT.width, MASK_RECT.height);
	};
	if (!annotationsFirst) drawScene();
	const beforeAnnotations = raster.paints.length;
	await renderAnnotations(
		ctx,
		[titleAnnotation(space)],
		TILE_WIDTH,
		TILE_HEIGHT,
		114800,
		SCENE_SCALE_FACTOR,
		undefined,
		ZOOM,
		MASK_RECT,
	);
	const annotationPaints = raster.paints.slice(beforeAnnotations);
	if (annotationsFirst) drawScene();
	return { ...raster, annotationPaints };
}

describe("renderAnnotations pixels over a zoomed scene", () => {
	it("paints a screen-space title opaquely on top of the picture", async () => {
		const { pixelAt, annotationPaints } = await rasterizeTitle("screen");
		expect(annotationPaints.length).toBeGreaterThan(0);
		expect(pixelAt(640, 360)).toEqual([255, 255, 255, 255]);
		expect(pixelAt(200, 360)).toEqual(toRgb(PICTURE).concat(255));
	});

	it("leaves no alpha, filter or blend state that could dim the title", async () => {
		const { annotationPaints } = await rasterizeTitle("screen");
		for (const entry of annotationPaints) {
			expect(entry).toEqual({ alpha: 1, filter: "none", composite: "source-over" });
		}
	});

	it("would lose the title if the overlay were painted into the scene layer", async () => {
		const { pixelAt } = await rasterizeTitle("screen", true);
		expect(pixelAt(640, 360)).toEqual(toRgb(PICTURE).concat(255));
	});

	it("keeps the same title in frame space pinned to the zoomed picture instead", async () => {
		const { pixelAt } = await rasterizeTitle("frame");
		expect(pixelAt(280, 220)).toEqual([255, 255, 255, 255]);
		expect(pixelAt(640, 360)).toEqual(toRgb(PICTURE).concat(255));
	});
});

const EDITOR_CANVAS = { previewWidth: 860, previewHeight: 484 };
const LOOK = {
	padding: 20,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	videoWidth: 2560,
	videoHeight: 1440,
};
const NO_ZOOM = { scale: 1, x: 0, y: 0 };

function lookConfig(width: number, height: number) {
	return { width, height, ...EDITOR_CANVAS, ...LOOK };
}

type LookConfig = ReturnType<typeof lookConfig>;

function frameRectFor(config: LookConfig) {
	const layout = computePaddedLayout({
		width: config.width,
		height: config.height,
		padding: config.padding,
		frameInsets: null,
		cropRegion: config.cropRegion,
		videoWidth: config.videoWidth,
		videoHeight: config.videoHeight,
	});
	return {
		x: layout.centerOffsetX,
		y: layout.centerOffsetY,
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
	};
}

function normalised(
	bounds: { left: number; top: number; right: number; bottom: number },
	config: LookConfig,
) {
	return {
		left: bounds.left / config.width,
		top: bounds.top / config.height,
		width: (bounds.right - bounds.left) / config.width,
		height: (bounds.bottom - bounds.top) / config.height,
	};
}

async function previewPathRect(space: "frame" | "screen", config: LookConfig) {
	const raster = createRasterCanvas(config.width, config.height);
	await renderAnnotations(
		raster.ctx,
		[titleAnnotation(space)],
		config.width,
		config.height,
		114800,
		getAnnotationScaleFactor(config),
		undefined,
		NO_ZOOM,
		frameRectFor(config),
	);
	return normalised(raster.paintedBounds(), config);
}

function createRasterElement() {
	let raster: ReturnType<typeof createRasterCanvas> | null = null;
	const element = {
		width: 1,
		height: 1,
		getContext: () => {
			raster ??= createRasterCanvas(element.width, element.height);
			return raster.ctx;
		},
		sprite: () => raster,
	};
	return element;
}

async function exportPathRect(space: "frame" | "screen", config: LookConfig) {
	const annotation = titleAnnotation(space);
	const placement = placeAnnotation(
		annotation,
		config,
		frameRectFor(config),
		getAnnotationScaleFactor(config),
	);
	const element = createRasterElement();
	vi.stubGlobal("document", { createElement: () => element });
	try {
		await renderAnnotationToCanvas(
			annotation,
			placement.width,
			placement.height,
			placement.scaleFactor,
		);
	} finally {
		vi.unstubAllGlobals();
	}
	const sprite = element.sprite();
	if (!sprite) throw new Error("the export sprite rasterized no pixels");
	const bounds = sprite.paintedBounds();
	return normalised(
		{
			left: bounds.left + placement.x,
			top: bounds.top + placement.y,
			right: bounds.right + placement.x,
			bottom: bounds.bottom + placement.y,
		},
		config,
	);
}

describe("render_preview and export_video place annotations identically", () => {
	for (const space of ["frame", "screen"] as const) {
		it(`agrees on the normalised rect of a ${space}-space title`, async () => {
			const preview = await previewPathRect(space, lookConfig(1280, 720));
			const exported = await exportPathRect(space, lookConfig(1920, 1080));
			expect(preview.left).toBeCloseTo(exported.left, 2);
			expect(preview.top).toBeCloseTo(exported.top, 2);
			expect(preview.width).toBeCloseTo(exported.width, 2);
			expect(preview.height).toBeCloseTo(exported.height, 2);
		});
	}

	it("gives a fontSize the same share of the frame height at any output size", async () => {
		const small = await exportPathRect("frame", lookConfig(960, 540));
		const large = await exportPathRect("frame", lookConfig(3840, 2160));
		expect(small.height).toBeCloseTo(large.height, 2);
		expect(small.top).toBeCloseTo(large.top, 2);
	});

	it("keeps a frame-space title inside the padded picture, not the whole canvas", async () => {
		const config = lookConfig(1920, 1080);
		const picture = frameRectFor(config);
		const exported = await exportPathRect("frame", config);
		expect(picture.x).toBeGreaterThan(0);
		expect(exported.left * config.width).toBeGreaterThanOrEqual(picture.x);
		expect(exported.left * config.width + exported.width * config.width).toBeLessThanOrEqual(
			picture.x + picture.width,
		);
	});
});

describe("both renderers read annotation geometry from one place", () => {
	const source = (file: string) =>
		readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

	it.each([
		"./frameRenderer.ts",
		"./modernFrameRenderer.ts",
	])("%s derives the scale factor and the picture rect from the shared helpers", (file) => {
		const text = source(file);
		expect(text).toContain("getAnnotationScaleFactor(this.config)");
		expect(text).toContain("getAnnotationFrameRect(this.config)");
		expect(text).not.toContain("BASE_PREVIEW_WIDTH");
		expect(text).not.toContain("BASE_PREVIEW_HEIGHT");
	});
});

function highlightAnnotation(): AnnotationRegion {
	return {
		id: "spot",
		startMs: 0,
		endMs: 1000,
		type: "highlight",
		content: "",
		position: { x: 40, y: 40 },
		size: { width: 20, height: 20 },
		style: { ...DEFAULT_ANNOTATION_STYLE },
		zIndex: 1,
		highlightDim: 0.5,
	};
}

expect.extend({
	toBeWithin(received: number, expected: number) {
		return {
			pass: Math.abs(received - expected) <= 1,
			message: () => `expected ${received} to be within 1 of ${expected}`,
		};
	},
});

declare module "vitest" {
	interface Assertion {
		toBeWithin(expected: number): void;
	}
}

describe("highlight spotlight", () => {
	const config = lookConfig(1280, 720);

	async function dimmed(dim: number | undefined, transform = NO_ZOOM) {
		const raster = createRasterCanvas(config.width, config.height);
		raster.ctx.fillStyle = "#FFFFFF";
		raster.ctx.fillRect(0, 0, config.width, config.height);
		await renderAnnotations(
			raster.ctx,
			[{ ...highlightAnnotation(), highlightDim: dim }],
			config.width,
			config.height,
			500,
			getAnnotationScaleFactor(config),
			undefined,
			transform,
			frameRectFor(config),
		);
		return raster;
	}

	it("darkens everything but the rectangle", async () => {
		const frame = frameRectFor(config);
		const { pixelAt } = await dimmed(0.5);
		const inside = [frame.x + frame.width * 0.5, frame.y + frame.height * 0.5];
		expect(pixelAt(inside[0], inside[1])).toEqual([255, 255, 255, 255]);
		expect(pixelAt(2, 2)[0]).toBeWithin(127.5);
		expect(pixelAt(frame.x + frame.width * 0.9, inside[1])[0]).toBeWithin(127.5);
		expect(pixelAt(inside[0], frame.y + frame.height * 0.9)[0]).toBeWithin(127.5);
	});

	it("scales darkness with dim and defaults when unset", async () => {
		expect((await dimmed(0.9)).pixelAt(2, 2)[0]).toBeWithin(25.5);
		expect((await dimmed(undefined)).pixelAt(2, 2)[0]).toBeWithin(102);
	});

	it("follows the zoom and never paints outside the canvas", async () => {
		const { pixelAt } = await dimmed(0.5, { scale: 2, x: -400, y: -200 });
		const frame = frameRectFor(config);
		const cx = (frame.x + frame.width * 0.5) * 2 - 400;
		const cy = (frame.y + frame.height * 0.5) * 2 - 200;
		expect(pixelAt(cx, cy)).toEqual([255, 255, 255, 255]);
		expect(pixelAt(cx + frame.width * 0.4, cy)[0]).toBeWithin(127.5);
	});

	it("dims the whole canvas when the zoom pushes the rectangle out of view", async () => {
		const { pixelAt } = await dimmed(0.5, { scale: 4, x: -5000, y: -5000 });
		expect(pixelAt(640, 360)[0]).toBeWithin(127.5);
	});

	it("is not rasterized as a sprite, so the export path composites it like a blur", async () => {
		vi.stubGlobal("document", { createElement: createRasterElement });
		try {
			expect(await renderAnnotationToCanvas(highlightAnnotation(), 100, 100)).toBeNull();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("draws with a blur at the same moment without disturbing either", async () => {
		const raster = createRasterCanvas(config.width, config.height);
		await renderAnnotations(
			raster.ctx,
			[
				highlightAnnotation(),
				{ ...highlightAnnotation(), id: "b", type: "blur", zIndex: 2, blurIntensity: 5 },
			],
			config.width,
			config.height,
			500,
			1,
			undefined,
			NO_ZOOM,
			frameRectFor(config),
		);
		expect(raster.pixelAt(2, 2)[3]).toBeGreaterThan(0);
	});
});

describe("fillBox backs a card with one solid plate", () => {
	const plated = (fillBox: boolean): AnnotationRegion => ({
		id: "card-title",
		startMs: 0,
		endMs: 2000,
		type: "text",
		content: "Entries",
		textContent: "Entries",
		position: { x: 0, y: 0 },
		size: { width: 100, height: 100 },
		style: {
			...DEFAULT_ANNOTATION_STYLE,
			fontSize: 64,
			color: "#FFFFFF",
			backgroundColor: "#000000",
			...(fillBox ? { fillBox: true } : {}),
		},
		zIndex: 1,
		space: "screen",
	});

	const paint = async (fillBox: boolean) => {
		const raster = createRasterCanvas(TILE_WIDTH, TILE_HEIGHT);
		raster.ctx.fillStyle = PICTURE;
		raster.ctx.fillRect(0, 0, TILE_WIDTH, TILE_HEIGHT);
		await renderAnnotations(
			raster.ctx,
			[plated(fillBox)],
			TILE_WIDTH,
			TILE_HEIGHT,
			1000,
			SCENE_SCALE_FACTOR,
			undefined,
			undefined,
			MASK_RECT,
		);
		return raster;
	};

	it("fills the whole annotation box, so a card hides the frame behind it", async () => {
		const { pixelAt } = await paint(true);
		expect(pixelAt(4, 4)).toEqual([0, 0, 0, 255]);
		expect(pixelAt(TILE_WIDTH - 4, TILE_HEIGHT - 4)).toEqual([0, 0, 0, 255]);
	});

	it("leaves the corners of the box alone without it, which is why a card needs it", async () => {
		const { pixelAt } = await paint(false);
		expect(pixelAt(4, 4)).toEqual(toRgb(PICTURE).concat(255));
	});
});

describe("a card's words fit the box they are given", () => {
	const CARD = { width: 1920, height: 1080, previewWidth: 860, previewHeight: 484 };
	const HEADING = { position: { x: 10, y: 30 }, size: { width: 80, height: 26 } };
	const SUBTITLE = { position: { x: 15, y: 57 }, size: { width: 70, height: 12 } };

	const wordsOf = (
		content: string,
		fontSize: number,
		box: { position: { x: number; y: number }; size: { width: number; height: number } },
	): AnnotationRegion => ({
		id: "card-words",
		startMs: 0,
		endMs: 2000,
		type: "text",
		content,
		textContent: content,
		...box,
		style: { ...DEFAULT_ANNOTATION_STYLE, fontSize, color: "#FFFFFF" },
		zIndex: 2,
		space: "screen",
	});

	async function rasterizeWords(annotation: AnnotationRegion) {
		const placement = placeAnnotation(
			annotation,
			CARD,
			{ x: 0, y: 0, width: CARD.width, height: CARD.height },
			getAnnotationScaleFactor(CARD),
		);
		const element = createRasterElement();
		vi.stubGlobal("document", { createElement: () => element });
		try {
			await renderAnnotationToCanvas(
				annotation,
				placement.width,
				placement.height,
				placement.scaleFactor,
			);
		} finally {
			vi.unstubAllGlobals();
		}
		const sprite = element.sprite();
		if (!sprite) throw new Error("the card words rasterized no canvas");
		return { words: sprite.texts, box: { width: element.width, height: element.height } };
	}

	it.each([
		["one word", "Entries"],
		["a heading that must wrap", "Payroll, end to end"],
		[
			"a heading of sixty characters",
			"Filing a timesheet, approving it and posting the payroll",
		],
		["a heading with nowhere to wrap", "Payroll,end-to-end,start-to-finish"],
		["the longest heading a card accepts", "Payroll ".repeat(25)],
	])("keeps %s inside the heading box", async (_label, text) => {
		const { words, box } = await rasterizeWords(wordsOf(text, 76, HEADING));
		expect(words.length).toBeGreaterThan(0);
		expect(words.map((word) => word.text.trim()).join(" ")).toBe(text.trim());
		for (const word of words) {
			expect(word.left).toBeGreaterThanOrEqual(0);
			expect(word.left + word.width).toBeLessThanOrEqual(box.width);
			expect(word.top).toBeGreaterThanOrEqual(0);
			expect(word.top + word.height).toBeLessThanOrEqual(box.height);
		}
	});

	it("keeps the subtitle inside its own box and at its own size", async () => {
		const { words, box } = await rasterizeWords(wordsOf("in under a minute", 34, SUBTITLE));
		expect(words).toHaveLength(1);
		expect(words[0].height).toBeCloseTo(34 * getAnnotationScaleFactor(CARD), 5);
		expect(words[0].top).toBeGreaterThanOrEqual(0);
		expect(words[0].top + words[0].height).toBeLessThanOrEqual(box.height);
		expect(words[0].left + words[0].width).toBeLessThanOrEqual(box.width);
	});

	it("does not shrink a heading that already fits", async () => {
		const { words } = await rasterizeWords(wordsOf("Entries", 76, HEADING));
		expect(words).toHaveLength(1);
		expect(words[0].height).toBeCloseTo(76 * getAnnotationScaleFactor(CARD), 5);
	});

	it("leaves a heading and an overflowing subtitle in their own boxes", async () => {
		const heading = await rasterizeWords(
			wordsOf("Payroll, end to end, every month", 76, HEADING),
		);
		const subtitle = await rasterizeWords(
			wordsOf(
				"from the first timesheet to the last payslip, without a spreadsheet",
				34,
				SUBTITLE,
			),
		);
		for (const { words, box } of [heading, subtitle]) {
			expect(words.length).toBeGreaterThan(0);
			for (const word of words) {
				expect(word.top).toBeGreaterThanOrEqual(0);
				expect(word.top + word.height).toBeLessThanOrEqual(box.height);
				expect(word.left).toBeGreaterThanOrEqual(0);
				expect(word.left + word.width).toBeLessThanOrEqual(box.width);
			}
		}
	});
});
