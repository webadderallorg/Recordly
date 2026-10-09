import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorOpContext } from "./types";

const run = promisify(execFile);

vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir(), isPackaged: false },
	ipcMain: { on: vi.fn() },
}));

const recorder = vi.hoisted(() => ({ configs: [] as Record<string, unknown>[] }));

vi.mock("@/lib/exporter/modernFrameRenderer", () => ({
	FrameRenderer: class {
		constructor(config: Record<string, unknown>) {
			recorder.configs.push(config);
		}
		async initialize() {}
		async renderFrame() {}
		getCanvas() {
			return { picture: true };
		}
		destroy() {}
	},
}));

vi.mock("../../videoPlayback/cursorRenderer", () => ({
	preloadCursorAssets: async () => undefined,
}));

vi.mock("../../projectPersistence", () => ({
	resolveVideoUrl: async (path: string) => `file://${path}`,
	toFileUrl: (path: string) => `file://${path}`,
}));

const { buildPostSpec } = await import("../../../../../electron/mcp/remoteExport");
const { getFfmpegBinaryPath } = await import("../../../../../electron/ipc/ffmpeg/binary");
const { frameOutput, parseFraming, renderPreview, teardownPreviewCache } = await import(
	"./preview"
);

type FramingArgs = { aspect?: string; padTo?: string; scale?: number };

const SOURCE_WIDTH = 1920;
const SOURCE_HEIGHT = 1080;

let ffmpegPath: string | null = null;
try {
	ffmpegPath = getFfmpegBinaryPath();
} catch (error) {
	console.warn(
		`[preview.parity] FFmpeg is unavailable, so the letterbox comparison against the real export pass is skipped: ${error instanceof Error ? error.message : String(error)}`,
	);
}
const withFfmpeg = ffmpegPath ? it : it.skip;

type Geometry = {
	width: number;
	height: number;
	contentX: number;
	contentY: number;
	contentWidth: number;
	contentHeight: number;
};

function readPpm(data: Buffer): { width: number; height: number; start: number } {
	const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(data.subarray(0, 64).toString("latin1"));
	if (!header) throw new Error("FFmpeg did not return a PPM frame to measure.");
	return { width: Number(header[1]), height: Number(header[2]), start: header[0].length };
}

async function exportGeometry(
	args: FramingArgs,
	renderWidth = SOURCE_WIDTH,
	renderHeight = SOURCE_HEIGHT,
): Promise<Geometry> {
	const spec = buildPostSpec(args);
	const { stdout } = await run(
		ffmpegPath as string,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			`color=c=red:s=${renderWidth}x${renderHeight}`,
			"-frames:v",
			"1",
			...(spec?.filter ? ["-vf", spec.filter] : []),
			"-f",
			"image2pipe",
			"-c:v",
			"ppm",
			"-",
		],
		{ encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
	);
	const { width, height, start } = readPpm(stdout as Buffer);
	let left = width;
	let top = height;
	let right = 0;
	let bottom = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (stdout[start + (y * width + x) * 3] <= 128) continue;
			if (x < left) left = x;
			if (y < top) top = y;
			if (x + 1 > right) right = x + 1;
			if (y + 1 > bottom) bottom = y + 1;
		}
	}
	return {
		width,
		height,
		contentX: left,
		contentY: top,
		contentWidth: right - left,
		contentHeight: bottom - top,
	};
}

const PIXEL_TOLERANCE = 2;

expect.extend({
	toBeWithinPixels(received: number, expected: number) {
		return {
			pass: Math.abs(received - expected) <= PIXEL_TOLERANCE,
			message: () => `expected ${received} to be within ${PIXEL_TOLERANCE} px of ${expected}`,
		};
	},
});

declare module "vitest" {
	interface Assertion {
		toBeWithinPixels(expected: number): void;
	}
}

const FRAMINGS: FramingArgs[] = [
	{},
	{ aspect: "16:9" },
	{ aspect: "9:16" },
	{ aspect: "1:1" },
	{ aspect: "4:3" },
	{ padTo: "800x600" },
	{ padTo: "2880x1600" },
	{ scale: 1 },
	{ scale: 0.05 },
	{ aspect: "1:1", scale: 0.5 },
];

describe("frameOutput matches the export's own ffmpeg letterbox pass", () => {
	for (const args of FRAMINGS) {
		withFfmpeg(
			`frames ${JSON.stringify(args)} the way ffmpeg does`,
			async () => {
				const exported = await exportGeometry(args);
				const previewed = frameOutput(
					SOURCE_WIDTH,
					SOURCE_HEIGHT,
					parseFraming(args as Record<string, unknown>),
				);
				expect(previewed.width).toBe(exported.width);
				expect(previewed.height).toBe(exported.height);
				expect(previewed.contentX).toBeWithinPixels(exported.contentX);
				expect(previewed.contentY).toBeWithinPixels(exported.contentY);
				expect(previewed.contentWidth).toBeWithinPixels(exported.contentWidth);
				expect(previewed.contentHeight).toBeWithinPixels(exported.contentHeight);
			},
			30_000,
		);
	}
});

describe("render_preview and export_video refuse the same framing arguments", () => {
	const bad: FramingArgs[] = [
		{ aspect: "16:9", padTo: "800x600" },
		{ padTo: "800x600", scale: 0.5 },
		{ aspect: "0:9" },
		{ aspect: "16:9:9" },
		{ aspect: "sixteen by nine" },
		{ padTo: "801x600" },
		{ padTo: "800x1" },
		{ padTo: "10000x1000" },
		{ scale: 2 },
		{ scale: 0.04 },
		{ scale: Number.NaN },
		{ scale: "half" as unknown as number },
	];
	for (const args of bad) {
		it(`refuses ${JSON.stringify(args)} with the export's own wording`, () => {
			let exportError: string | null = null;
			try {
				buildPostSpec(args);
			} catch (error) {
				exportError = error instanceof Error ? error.message : String(error);
			}
			expect(exportError).not.toBeNull();
			expect(() => parseFraming(args as Record<string, unknown>)).toThrow(
				exportError as string,
			);
		});
	}

	it("refuses a non-string aspect that the export's validator crashes on", () => {
		expect(() => buildPostSpec({ aspect: 16 as unknown as string })).toThrow();
		expect(() => parseFraming({ aspect: 16 })).toThrow(/aspect must look like 16:9, not 16\./);
	});

	it("asks for no ffmpeg pass exactly when it asks for no letterbox", () => {
		expect(buildPostSpec({})).toBeNull();
		expect(parseFraming({})).toBeNull();
		expect(buildPostSpec({ aspect: "1:1" })).not.toBeNull();
		expect(parseFraming({ aspect: "1:1" })).not.toBeNull();
	});
});

function rasterCanvas() {
	const canvas = {
		width: 0,
		height: 0,
		picture: null as Uint8Array | null,
		getContext(kind: string) {
			if (kind !== "2d") return null;
			const paint = (x: number, y: number, w: number, h: number, value: number) => {
				canvas.picture ??= new Uint8Array(canvas.width * canvas.height);
				for (let row = Math.round(y); row < Math.round(y + h); row++) {
					if (row < 0 || row >= canvas.height) continue;
					for (let col = Math.round(x); col < Math.round(x + w); col++) {
						if (col < 0 || col >= canvas.width) continue;
						canvas.picture[row * canvas.width + col] = value;
					}
				}
			};
			return {
				fillStyle: "",
				fillRect: (x: number, y: number, w: number, h: number) => paint(x, y, w, h, 0),
				drawImage: (_source: unknown, x: number, y: number, w: number, h: number) =>
					paint(x, y, w, h, 1),
			};
		},
		toDataURL: () => "data:image/jpeg;base64,SHEET",
	};
	return canvas;
}

function fakeVideo() {
	const listeners = new Map<string, Set<() => void>>();
	const video = {
		muted: false,
		preload: "",
		videoWidth: SOURCE_WIDTH,
		videoHeight: SOURCE_HEIGHT,
		seeks: [] as number[],
		addEventListener(type: string, listener: () => void) {
			const set = listeners.get(type) ?? new Set<() => void>();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener(type: string, listener: () => void) {
			listeners.get(type)?.delete(listener);
		},
		removeAttribute() {},
		load() {},
		set src(_value: string) {
			queueMicrotask(() => {
				for (const listener of [...(listeners.get("loadeddata") ?? [])]) listener();
			});
		},
	};
	Object.defineProperty(video, "currentTime", {
		set(value: number) {
			video.seeks.push(value);
			queueMicrotask(() => {
				for (const listener of [...(listeners.get("seeked") ?? [])]) listener();
			});
		},
		get() {
			return video.seeks[video.seeks.length - 1] ?? 0;
		},
	});
	return video;
}

let sheets: ReturnType<typeof rasterCanvas>[];
const originalDocument = (globalThis as { document?: unknown }).document;
const originalVideoFrame = (globalThis as { VideoFrame?: unknown }).VideoFrame;

beforeEach(() => {
	teardownPreviewCache();
	recorder.configs = [];
	sheets = [];
	(globalThis as { document?: unknown }).document = {
		createElement: (tag: string) => {
			if (tag === "video") return fakeVideo();
			const canvas = rasterCanvas();
			sheets.push(canvas);
			return canvas;
		},
		querySelector: () => ({ clientWidth: 1280, clientHeight: 720 }),
	};
	(globalThis as { VideoFrame?: unknown }).VideoFrame = class {
		close() {}
	};
});

afterEach(() => {
	teardownPreviewCache();
	(globalThis as { document?: unknown }).document = originalDocument;
	(globalThis as { VideoFrame?: unknown }).VideoFrame = originalVideoFrame;
});

function previewContext(over: Record<string, unknown> = {}) {
	return {
		duration: 10,
		videoSourcePath: "/tmp/take.mp4",
		assertSameRecording: () => undefined,
		adoptJoinedMedia: () => undefined,
		history: { undo: () => {}, redo: () => {}, canUndo: false, canRedo: false },
		ids: {},
		exportAspectRatio: "native",
		effectiveSpeedRegions: [],
		effectiveShowCursor: false,
		timeline: {
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 1 }],
			zoomRegions: [],
			annotationRegions: [],
			audioRegions: [],
			speedRegions: [],
			trimRegions: [],
			cursorTelemetry: [],
			autoCaptions: [],
			autoCaptionSettings: { enabled: true },
		},
		appearance: {
			wallpaper: "none",
			padding: 0,
			borderRadius: 0,
			shadowIntensity: 0,
			backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			webcam: { enabled: false, sourcePath: null },
			resolvedWebcamVideoUrl: null,
			showCursor: false,
			cursorStyle: "tahoe",
			cursorSize: 1.4,
		},
		...over,
	} as unknown as EditorOpContext;
}

async function previewPicture(args: FramingArgs, over: Record<string, unknown> = {}) {
	await renderPreview({ atMs: 500, ...args }, previewContext(over));
	const sheet = sheets[sheets.length - 1];
	const pixels = sheet.picture;
	if (!pixels) throw new Error("the preview composited nothing into the sheet");
	let left = sheet.width;
	let top = sheet.height;
	let right = 0;
	let bottom = 0;
	for (let y = 0; y < sheet.height; y++) {
		for (let x = 0; x < sheet.width; x++) {
			if (pixels[y * sheet.width + x] === 0) continue;
			if (x < left) left = x;
			if (y < top) top = y;
			if (x + 1 > right) right = x + 1;
			if (y + 1 > bottom) bottom = y + 1;
		}
	}
	return {
		left: left / sheet.width,
		top: top / sheet.height,
		width: (right - left) / sheet.width,
		height: (bottom - top) / sheet.height,
	};
}

describe("render_preview and export_video frame the same picture", () => {
	for (const args of FRAMINGS) {
		withFfmpeg(
			`places the picture identically for ${JSON.stringify(args)}`,
			async () => {
				const exported = await exportGeometry(args);
				const previewed = await previewPicture(args);
				expect(previewed.left).toBeCloseTo(exported.contentX / exported.width, 2);
				expect(previewed.top).toBeCloseTo(exported.contentY / exported.height, 2);
				expect(previewed.width).toBeCloseTo(exported.contentWidth / exported.width, 2);
				expect(previewed.height).toBeCloseTo(exported.contentHeight / exported.height, 2);
			},
			30_000,
		);
	}

	withFfmpeg(
		"places the picture identically on the editor's own 9:16 export canvas",
		async () => {
			const exported = await exportGeometry({ aspect: "16:9" }, 1080, 1920);
			const previewed = await previewPicture(
				{ aspect: "16:9" },
				{ exportAspectRatio: "9:16" },
			);
			expect(previewed.left).toBeCloseTo(exported.contentX / exported.width, 2);
			expect(previewed.top).toBeCloseTo(exported.contentY / exported.height, 2);
			expect(previewed.width).toBeCloseTo(exported.contentWidth / exported.width, 2);
			expect(previewed.height).toBeCloseTo(exported.contentHeight / exported.height, 2);
		},
		30_000,
	);

	it("keeps the whole sheet at the framed aspect ratio", async () => {
		await renderPreview({ atMs: 500, aspect: "1:1" }, previewContext());
		const sheet = sheets[sheets.length - 1];
		expect(sheet.width).toBe(sheet.height);
	});

	it("refuses an aspect that would letterbox the frame past the composite limit", async () => {
		await expect(
			renderPreview({ atMs: 500, aspect: "1:1000" }, previewContext()),
		).rejects.toThrow(/1920x1920000/);
	});
});

describe("render_preview composites with the renderer the export uses", () => {
	const source = (file: string) =>
		readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

	it("opens the modern renderer and not the legacy one", () => {
		const preview = source("./preview.ts");
		expect(preview).toContain('await import("@/lib/exporter/modernFrameRenderer")');
		expect(preview).not.toContain("exporter/frameRenderer");
	});

	it("opens the same renderer module the mp4 exporter does", () => {
		expect(source("../../../../lib/exporter/modernVideoExporter.ts")).toContain(
			'from "./modernFrameRenderer"',
		);
	});
});
