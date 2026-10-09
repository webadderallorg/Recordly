import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClipRegion } from "../../types";
import type { EditorOpContext } from "./types";

const recorder = vi.hoisted(() => ({
	configs: [] as Record<string, unknown>[],
	renders: [] as number[][],
	destroyed: 0,
	cursorAssetsFail: false,
	initFails: false,
	renderFails: false,
}));

vi.mock("@/lib/exporter/modernFrameRenderer", () => ({
	FrameRenderer: class {
		constructor(config: Record<string, unknown>) {
			recorder.configs.push(config);
		}
		async initialize() {
			if (recorder.initFails) throw new Error("no GPU context");
		}
		async renderFrame(
			_frame: unknown,
			timestamp: number,
			cursorTimestamp: number,
			_durationUs: undefined,
			timelineTimestamp: number,
		) {
			if (recorder.renderFails) throw new Error("the composite failed");
			recorder.renders.push([timestamp, cursorTimestamp, timelineTimestamp]);
		}
		getCanvas() {
			return { tile: true };
		}
		destroy() {
			recorder.destroyed += 1;
		}
	},
}));

vi.mock("../../videoPlayback/cursorRenderer", () => ({
	preloadCursorAssets: async () => {
		if (recorder.cursorAssetsFail) throw new Error("cursor artwork missing");
	},
}));

vi.mock("../../projectPersistence", () => ({
	resolveVideoUrl: async (path: string) => `file://${path}`,
	toFileUrl: (path: string) => `file://${path}`,
}));

import {
	frameOutput,
	MAX_FRAMED_SIDE,
	MAX_PREVIEW_FRAMES,
	MIN_EVERY_MS,
	parseFraming,
	planPreview,
	previewSheetGeometry,
	renderPreview,
	sameRendererConfig,
	teardownPreviewCache,
} from "./preview";

type Listener = () => void;

function fakeVideo() {
	const listeners = new Map<string, Set<Listener>>();
	const emit = (type: string) => {
		for (const listener of [...(listeners.get(type) ?? [])]) listener();
	};
	const video = {
		muted: false,
		preload: "",
		videoWidth: 1920,
		videoHeight: 1080,
		currentTime: 0,
		seeks: [] as number[],
		cleared: false,
		addEventListener(type: string, listener: Listener) {
			const set = listeners.get(type) ?? new Set<Listener>();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener(type: string, listener: Listener) {
			listeners.get(type)?.delete(listener);
		},
		removeAttribute() {
			video.cleared = true;
		},
		load() {},
		set src(_value: string) {
			queueMicrotask(() => emit("loadeddata"));
		},
	};
	Object.defineProperty(video, "currentTime", {
		set(value: number) {
			video.seeks.push(value);
			queueMicrotask(() => emit("seeked"));
		},
		get() {
			return video.seeks[video.seeks.length - 1] ?? 0;
		},
	});
	return video;
}

function fakeCanvas() {
	return {
		width: 0,
		height: 0,
		drawn: [] as unknown[][],
		filled: [] as unknown[][],
		getContext(kind: string) {
			if (kind !== "2d") return null;
			return {
				fillStyle: "",
				drawImage: (...args: unknown[]) => {
					this.drawn.push(args);
				},
				fillRect: (...args: unknown[]) => {
					this.filled.push(args);
				},
			};
		},
		toDataURL: () => "data:image/jpeg;base64,SHEET",
	};
}

const original = {
	document: (globalThis as { document?: unknown }).document,
	VideoFrame: (globalThis as { VideoFrame?: unknown }).VideoFrame,
};

let videos: ReturnType<typeof fakeVideo>[];
let canvases: ReturnType<typeof fakeCanvas>[];
let overlay: { clientWidth: number; clientHeight: number } | null;

const video = () => videos[videos.length - 1];

beforeEach(() => {
	teardownPreviewCache();
	vi.useFakeTimers({ shouldAdvanceTime: true });
	recorder.configs = [];
	recorder.renders = [];
	recorder.destroyed = 0;
	recorder.cursorAssetsFail = false;
	recorder.initFails = false;
	recorder.renderFails = false;
	videos = [];
	canvases = [];
	overlay = { clientWidth: 1280, clientHeight: 720 };
	(globalThis as { document?: unknown }).document = {
		createElement: (tag: string) => {
			if (tag === "video") {
				const element = fakeVideo();
				videos.push(element);
				return element;
			}
			const canvas = fakeCanvas();
			canvases.push(canvas);
			return canvas;
		},
		querySelector: () => overlay,
	};
	(globalThis as { VideoFrame?: unknown }).VideoFrame = class {
		constructor(
			public source: unknown,
			public init: { timestamp: number },
		) {}
		close() {}
	};
});

afterEach(() => {
	teardownPreviewCache();
	vi.useRealTimers();
	(globalThis as { document?: unknown }).document = original.document;
	(globalThis as { VideoFrame?: unknown }).VideoFrame = original.VideoFrame;
});

const clip = (over: Partial<ClipRegion> = {}): ClipRegion =>
	({ id: "clip-1", startMs: 0, endMs: 10_000, speed: 1, ...over }) as ClipRegion;

function makeContext(over: Record<string, unknown> = {}) {
	const timeline = {
		clipRegions: [clip()],
		zoomRegions: [],
		annotationRegions: [],
		audioRegions: [],
		speedRegions: [],
		trimRegions: [],
		cursorTelemetry: [{ timeMs: 0, x: 1, y: 1 }],
		autoCaptions: [],
		autoCaptionSettings: { enabled: true },
		...((over.timeline as Record<string, unknown>) ?? {}),
	};
	const appearance = {
		wallpaper: "none",
		padding: 0,
		borderRadius: 0,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		webcam: { enabled: false, sourcePath: null },
		resolvedWebcamVideoUrl: null,
		showCursor: true,
		cursorStyle: "tahoe",
		cursorSize: 1.4,
		...((over.appearance as Record<string, unknown>) ?? {}),
	};
	return {
		duration: 10,
		videoSourcePath: "/tmp/take.mp4",
		assertSameRecording: () => undefined,
		adoptJoinedMedia: () => undefined,
		history: { undo: () => {}, redo: () => {}, canUndo: false, canRedo: false },
		ids: {},
		exportAspectRatio: "native",
		effectiveSpeedRegions: timeline.speedRegions,
		effectiveShowCursor: appearance.showCursor,
		...over,
		timeline,
		appearance,
	} as unknown as EditorOpContext;
}

function editContext(
	base: EditorOpContext,
	edit: { timeline?: Record<string, unknown>; appearance?: Record<string, unknown> },
) {
	return {
		...base,
		timeline: { ...base.timeline, ...edit.timeline },
		appearance: { ...base.appearance, ...edit.appearance },
	} as unknown as EditorOpContext;
}

const plan = (payload: unknown, clips: ClipRegion[] = [clip()], durationMs = 10_000) =>
	planPreview(payload, { clipRegions: clips, durationMs });

describe("planPreview", () => {
	it("defaults to a single frame at the start of the edited timeline", () => {
		expect(plan({})).toMatchObject({
			frames: [{ atMs: 0, sourceMs: 0 }],
			cols: 1,
			rows: 1,
			skippedAtMs: [],
		});
	});

	it("maps an edited time through a cut and a speed change to its source time", () => {
		const clips = [
			clip({ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 4000, speed: 1 }),
			clip({ id: "b", startMs: 1000, endMs: 2000, sourceStartMs: 20_000, speed: 2 }),
		];
		expect(plan({ atMs: 1500 }, clips, 2000).frames).toEqual([
			{ atMs: 1500, sourceMs: 21_000 },
		]);
	});

	it("resolves a time exactly on a cut into the clip that starts there", () => {
		const clips = [
			clip({ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0 }),
			clip({ id: "b", startMs: 1000, endMs: 2000, sourceStartMs: 50_000 }),
		];
		expect(plan({ atMs: 1000 }, clips, 2000).frames).toEqual([
			{ atMs: 1000, sourceMs: 50_000 },
		]);
	});

	it("resolves the very last millisecond of the timeline instead of calling it a gap", () => {
		const clips = [clip({ startMs: 0, endMs: 2000, sourceStartMs: 1000 })];
		expect(plan({ atMs: 2000 }, clips, 2000).frames).toEqual([{ atMs: 2000, sourceMs: 2999 }]);
	});

	it("refuses a time in a gap between clips", () => {
		const clips = [
			clip({ id: "a", startMs: 0, endMs: 1000 }),
			clip({ id: "b", startMs: 5000, endMs: 6000 }),
		];
		expect(() => plan({ atMs: 3000 }, clips, 6000)).toThrow(/falls in a gap/);
	});

	it("refuses a time past the end of the edited timeline", () => {
		expect(() => plan({ atMs: 10_001 })).toThrow(/past the end/);
	});

	it("refuses atMs together with count", () => {
		expect(() => plan({ atMs: 0, count: 3 })).toThrow(/not both/);
	});

	it("refuses count together with everyMs", () => {
		expect(() => plan({ count: 3, everyMs: 500 })).toThrow(/exactly one/);
	});

	it("refuses an unknown field", () => {
		expect(() => plan({ atMs: 0, source: "raw" })).toThrow(/unknown field source/);
	});

	it("refuses a count outside 2 to the maximum", () => {
		expect(() => plan({ count: 1 })).toThrow(/whole number from 2/);
		expect(() => plan({ count: MAX_PREVIEW_FRAMES + 1 })).toThrow(/whole number from 2/);
		expect(() => plan({ count: 2.5 })).toThrow(/whole number from 2/);
	});

	it("refuses an everyMs below one frame and one that asks for too many frames", () => {
		expect(() => plan({ everyMs: MIN_EVERY_MS - 1 })).toThrow(/at least 17 ms/);
		expect(() => plan({ everyMs: 100 })).toThrow(/the most is 6/);
		expect(() => plan({ everyMs: 20_000 })).toThrow(/longer than the edited timeline/);
	});

	it("refuses a timeline with no length", () => {
		expect(() => plan({}, [], 0)).toThrow(/no length to preview/);
	});

	it("carries the framing arguments through to the plan", () => {
		expect(plan({ atMs: 0, aspect: "9:16", scale: 0.5 }).framing).toEqual({
			aspect: { w: 9, h: 16 },
			scale: 0.5,
		});
		expect(plan({ atMs: 0, padTo: "800x600" }).framing).toEqual({
			padTo: { width: 800, height: 600 },
		});
		expect(plan({ atMs: 0 }).framing).toBeNull();
	});

	it("refuses framing arguments before it looks at the timeline", () => {
		expect(() => plan({ aspect: "16:9", padTo: "800x600" }, [], 0)).toThrow(/not both/);
	});

	it("lays a sheet out in a grid and lists the moments that fall in gaps", () => {
		const clips = [
			clip({ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0 }),
			clip({ id: "b", startMs: 5000, endMs: 6000, sourceStartMs: 9000 }),
		];
		const result = plan({ count: 3 }, clips, 6000);
		expect(result.frames.map((frame) => frame.atMs)).toEqual([0, 6000]);
		expect(result.skippedAtMs).toEqual([3000]);
		expect([result.cols, result.rows]).toEqual([2, 1]);
	});

	it("refuses a sheet when fewer than two moments play anything", () => {
		const clips = [clip({ id: "a", startMs: 0, endMs: 100, sourceStartMs: 0 })];
		expect(() => plan({ count: 3 }, clips, 9000)).toThrow(/Fewer than two/);
	});
});

describe("render_preview", () => {
	it("composites through the export renderer and reports the layers it drew", async () => {
		const result = (await renderPreview({ atMs: 500 }, makeContext())) as Record<
			string,
			unknown
		>;
		expect(result.image).toEqual({
			data: "SHEET",
			mimeType: "image/jpeg",
			width: 1280,
			height: 720,
		});
		expect(result.frames).toEqual([{ atMs: 500, sourceMs: 500 }]);
		expect(recorder.renders).toEqual([[500_000, 500_000, 500_000]]);
		expect(recorder.configs[0]).toMatchObject({
			timelineEffects: true,
			width: 1280,
			height: 720,
			videoWidth: 1920,
			videoHeight: 1080,
			previewWidth: 1280,
			previewHeight: 720,
		});
		expect(result.rendered).toContain("cursor");
		expect(result.notRendered).toEqual([]);
		expect(result.reused).toEqual([]);
		expect(recorder.destroyed).toBe(0);
		expect(video().cleared).toBe(false);
	});

	it("names the cursor as not rendered when the recording has no telemetry", async () => {
		const result = (await renderPreview(
			{},
			makeContext({ timeline: { cursorTelemetry: [] } }),
		)) as { rendered: string[]; notRendered: string[] };
		expect(result.rendered).not.toContain("cursor");
		expect(result.notRendered).toEqual(["cursor: this recording carries no cursor telemetry"]);
	});

	it("names the cursor as not rendered when its artwork cannot be loaded", async () => {
		recorder.cursorAssetsFail = true;
		const result = (await renderPreview({}, makeContext())) as { notRendered: string[] };
		expect(result.notRendered[0]).toMatch(/cursor: its artwork could not be loaded/);
	});

	it("says the preview could not be measured when the editor preview is not on screen", async () => {
		overlay = null;
		const result = (await renderPreview({}, makeContext())) as { note: string };
		expect(result.note).toMatch(/could not be measured/);
		expect(recorder.configs[0]).toMatchObject({ previewWidth: 1920, previewHeight: 1080 });
	});

	it("tiles a sheet and seeks once per frame", async () => {
		const result = (await renderPreview({ count: 3 }, makeContext())) as {
			cols: number;
			rows: number;
			frames: unknown[];
		};
		expect(result.frames).toHaveLength(3);
		expect(video().seeks).toEqual([5, 9.96]);
		expect([result.cols, result.rows]).toEqual([2, 2]);
		const sheet = canvases[canvases.length - 1];
		expect(sheet.drawn).toHaveLength(3);
		expect([sheet.width, sheet.height]).toEqual([1286, 726]);
	});

	it("refuses when no recording is loaded", async () => {
		await expect(renderPreview({}, makeContext({ videoSourcePath: null }))).rejects.toThrow(
			/no recording loaded in the editor/,
		);
	});

	it("releases the renderer and the video when the renderer cannot start", async () => {
		recorder.initFails = true;
		await expect(renderPreview({}, makeContext())).rejects.toThrow(/no GPU context/);
		expect(video().cleared).toBe(true);
	});

	it("refuses a second preview while one is still rendering", async () => {
		const first = renderPreview({}, makeContext());
		await expect(renderPreview({}, makeContext())).rejects.toThrow(/already rendering/);
		await first;
		await expect(renderPreview({}, makeContext())).resolves.toBeTruthy();
	});

	it("refuses when the editor loads a different recording mid-render", async () => {
		let calls = 0;
		await expect(
			renderPreview(
				{},
				makeContext({
					assertSameRecording: () => {
						calls += 1;
						if (calls > 1) throw new Error("The editor loaded a different recording");
					},
				}),
			),
		).rejects.toThrow(/different recording/);
		expect(video().cleared).toBe(true);
	});
});

describe("previewSheetGeometry", () => {
	it("keeps the planned grid when every frame was drawn", () => {
		expect(previewSheetGeometry(6, 3)).toEqual({ cols: 3, rows: 2 });
		expect(previewSheetGeometry(4, 2)).toEqual({ cols: 2, rows: 2 });
	});

	it("shrinks to one row when the budget cut the sheet short", () => {
		expect(previewSheetGeometry(2, 3)).toEqual({ cols: 2, rows: 1 });
	});

	it("drops the rows nothing was drawn into", () => {
		expect(previewSheetGeometry(4, 3)).toEqual({ cols: 3, rows: 2 });
	});

	it("never returns a zero-sized sheet", () => {
		expect(previewSheetGeometry(0, 3)).toEqual({ cols: 1, rows: 1 });
	});
});

describe("sameRendererConfig", () => {
	it("matches two configs built from the same state", () => {
		const regions: unknown[] = [];
		expect(
			sameRendererConfig(
				{ width: 1280, zoomRegions: regions },
				{ width: 1280, zoomRegions: regions },
			),
		).toBe(true);
	});

	it("rejects a changed scalar, a changed array identity, and a missing key", () => {
		expect(sameRendererConfig({ padding: 0 }, { padding: 40 })).toBe(false);
		expect(sameRendererConfig({ zoomRegions: [] }, { zoomRegions: [] })).toBe(false);
		expect(sameRendererConfig({ padding: 0 }, { padding: 0, borderRadius: 8 })).toBe(false);
	});
});

describe("parseFraming", () => {
	it("reads an aspect, a padTo and a scale", () => {
		expect(parseFraming({ aspect: " 16:9 " })).toEqual({ aspect: { w: 16, h: 9 } });
		expect(parseFraming({ padTo: "2880X1600" })).toEqual({
			padTo: { width: 2880, height: 1600 },
		});
		expect(parseFraming({ aspect: "1:1", scale: 0.5 })).toEqual({
			aspect: { w: 1, h: 1 },
			scale: 0.5,
		});
	});

	it("returns nothing when no framing was asked for", () => {
		expect(parseFraming({ atMs: 0 })).toBeNull();
	});

	it("refuses aspect together with padTo and padTo together with scale", () => {
		expect(() => parseFraming({ aspect: "16:9", padTo: "800x600" })).toThrow(
			"Pass either aspect or padTo, not both.",
		);
		expect(() => parseFraming({ padTo: "800x600", scale: 0.5 })).toThrow(/not both/);
	});

	it("takes scale at both bounds and refuses it outside them", () => {
		expect(parseFraming({ scale: 1 })).toEqual({ scale: 1 });
		expect(parseFraming({ scale: 0.05 })).toEqual({ scale: 0.05 });
		expect(() => parseFraming({ scale: 1.0001 })).toThrow(/from 0.05 to 1/);
		expect(() => parseFraming({ scale: 0.0499 })).toThrow(/from 0.05 to 1/);
		expect(() => parseFraming({ scale: Number.NaN })).toThrow(/from 0.05 to 1/);
	});

	it("refuses a malformed or oversized padTo and a malformed aspect", () => {
		expect(() => parseFraming({ padTo: "801x600" })).toThrow(/with even sizes/);
		expect(() => parseFraming({ padTo: "2880-1600" })).toThrow(/with even sizes/);
		expect(() => parseFraming({ padTo: `${MAX_FRAMED_SIDE + 2}x1000` })).toThrow(
			/larger than 8192/,
		);
		expect(() => parseFraming({ aspect: "0:9" })).toThrow(/look like 16:9/);
		expect(() => parseFraming({ aspect: 169 })).toThrow(/look like 16:9/);
	});
});

describe("frameOutput", () => {
	it("leaves a frame alone when nothing was asked for", () => {
		expect(frameOutput(1920, 1080, null)).toEqual({
			width: 1920,
			height: 1080,
			contentWidth: 1920,
			contentHeight: 1080,
			contentX: 0,
			contentY: 0,
		});
	});

	it("is a no-op when the recording already has the asked-for aspect", () => {
		expect(frameOutput(1920, 1080, { aspect: { w: 16, h: 9 } })).toEqual(
			frameOutput(1920, 1080, null),
		);
	});

	it("adds bars without ever cropping or stretching the picture", () => {
		expect(frameOutput(1920, 1080, { aspect: { w: 1, h: 1 } })).toMatchObject({
			width: 1920,
			height: 1920,
			contentWidth: 1920,
			contentHeight: 1080,
			contentY: 420,
		});
	});

	it("fits the picture inside a padTo box and centres it", () => {
		expect(frameOutput(1920, 1080, { padTo: { width: 2880, height: 1600 } })).toMatchObject({
			width: 2880,
			height: 1600,
			contentWidth: 2844,
			contentHeight: 1600,
			contentX: 18,
		});
	});

	it("shrinks everything by scale after letterboxing", () => {
		expect(frameOutput(1920, 1080, { aspect: { w: 1, h: 1 }, scale: 0.5 })).toMatchObject({
			width: 960,
			height: 960,
			contentWidth: 960,
			contentHeight: 540,
			contentY: 210,
		});
		expect(frameOutput(1920, 1080, { scale: 0.05 })).toMatchObject({
			width: 96,
			height: 54,
		});
	});

	it("refuses an absurd aspect that would letterbox past the composite limit", () => {
		expect(() => frameOutput(1920, 1080, { aspect: { w: 1, h: 1000 } })).toThrow(
			/1920x1920000/,
		);
		expect(() => frameOutput(1920, 1080, { aspect: { w: 1000, h: 1 } })).toThrow(
			/will not composite a side over 8192 px/,
		);
	});
});

describe("render_preview framing", () => {
	it("letterboxes the sheet and keeps the picture at its native shape", async () => {
		const result = (await renderPreview({ atMs: 500, aspect: "1:1" }, makeContext())) as {
			image: { width: number; height: number };
			note: string;
		};
		expect(result.image).toMatchObject({ width: 1280, height: 1280 });
		expect(recorder.configs[0]).toMatchObject({ width: 1280, height: 720 });
		const sheet = canvases[canvases.length - 1];
		expect(sheet.filled).toEqual([[0, 0, 1280, 1280]]);
		expect(sheet.drawn).toEqual([[{ tile: true }, 0, 280, 1280, 720]]);
		expect(result.note).toMatch(/letterbox the export to 1920x1920/);
	});

	it("shrinks the whole composite for scale, down to the smallest allowed", async () => {
		const result = (await renderPreview({ atMs: 500, scale: 0.05 }, makeContext())) as {
			image: { width: number; height: number };
		};
		expect(result.image).toMatchObject({ width: 96, height: 54 });
	});

	it("fits the picture into a padTo box", async () => {
		const result = (await renderPreview({ atMs: 500, padTo: "800x600" }, makeContext())) as {
			image: { width: number; height: number };
		};
		expect(result.image).toMatchObject({ width: 800, height: 600 });
		expect(canvases[canvases.length - 1].drawn).toEqual([[{ tile: true }, 0, 75, 800, 450]]);
	});

	it("says nothing about letterboxing when no framing was asked for", async () => {
		const result = (await renderPreview({ atMs: 500 }, makeContext())) as { note: string };
		expect(result.note).not.toMatch(/letterbox/);
	});

	it("letterboxes every tile of a contact sheet that skips a gap", async () => {
		const clips = [
			clip({ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0 }),
			clip({ id: "b", startMs: 5000, endMs: 6000, sourceStartMs: 9000 }),
		];
		const result = (await renderPreview(
			{ count: 3, aspect: "1:1" },
			makeContext({ duration: 6, timeline: { clipRegions: clips } }),
		)) as { skippedAtMs: number[]; image: { width: number; height: number } };
		expect(result.skippedAtMs).toEqual([3000]);
		expect(result.image).toMatchObject({ width: 1286, height: 640 });
		expect(canvases[canvases.length - 1].filled).toEqual([
			[0, 0, 640, 640],
			[646, 0, 640, 640],
		]);
	});

	it("still scales annotations against the fallback when the editor cannot be measured", async () => {
		overlay = null;
		const result = (await renderPreview({ atMs: 0, aspect: "1:1" }, makeContext())) as {
			note: string;
		};
		expect(result.note).toMatch(/could not be measured/);
		expect(recorder.configs[0]).toMatchObject({ previewWidth: 1920, previewHeight: 1080 });
	});

	it("refuses an absurd aspect instead of composing a sheet nothing can hold", async () => {
		await expect(renderPreview({ atMs: 0, aspect: "1:1000" }, makeContext())).rejects.toThrow(
			/will not composite a side over 8192 px/,
		);
	});

	it("refuses aspect with padTo and padTo with scale", async () => {
		await expect(
			renderPreview({ atMs: 0, aspect: "16:9", padTo: "800x600" }, makeContext()),
		).rejects.toThrow("Pass either aspect or padTo, not both.");
		await expect(
			renderPreview({ atMs: 0, padTo: "800x600", scale: 0.5 }, makeContext()),
		).rejects.toThrow(/padTo already fixes the output size/);
	});
});

describe("render_preview follows the editor state the export reads", () => {
	it("composites on the canvas the editor's export aspect ratio gives the export", async () => {
		const result = (await renderPreview(
			{ atMs: 0 },
			makeContext({ exportAspectRatio: "9:16" }),
		)) as { image: { width: number; height: number }; note: string };
		expect(result.image).toMatchObject({ width: 1080, height: 1920 });
		expect(recorder.configs[0]).toMatchObject({ width: 1080, height: 1920 });
		expect(result.note).toMatch(/export aspect ratio is 9:16/);
		expect(result.note).toMatch(/separate from the aspect argument/);
	});

	it("says so instead of guessing when the export aspect ratio is not carried", async () => {
		const result = (await renderPreview(
			{ atMs: 0 },
			makeContext({ exportAspectRatio: undefined }),
		)) as { image: { width: number }; note: string };
		expect(result.image).toMatchObject({ width: 1280 });
		expect(result.note).toMatch(/export aspect ratio could not be read here/);
	});

	it("reports no cursor when the recording's session turned the overlay cursor off", async () => {
		const result = (await renderPreview(
			{ atMs: 0 },
			makeContext({ effectiveShowCursor: false }),
		)) as { rendered: string[]; notRendered: string[] };
		expect(result.rendered).not.toContain("cursor");
		expect(result.notRendered).toEqual(["cursor: it is turned off for this export"]);
		expect(recorder.configs[0]).toMatchObject({ showCursor: false });
	});

	it("says so instead of claiming a cursor when the session override is not carried", async () => {
		const result = (await renderPreview(
			{ atMs: 0 },
			makeContext({ effectiveShowCursor: undefined }),
		)) as { rendered: string[]; note: string };
		expect(result.rendered).toContain("cursor");
		expect(result.note).toMatch(/turned the overlay cursor off could not be read/);
	});

	it("composites with the speed regions the export derives, not the raw ones", async () => {
		const derived = [{ id: "clip-speed-a", startMs: 0, endMs: 1000, speed: 2 }];
		await renderPreview({ atMs: 0 }, makeContext({ effectiveSpeedRegions: derived }));
		expect(recorder.configs[0].speedRegions).toBe(derived);
	});

	it("keeps the speed caveat only while the derived regions are not carried", async () => {
		const clips = [clip({ speed: 2 })];
		const blind = (await renderPreview(
			{ atMs: 0 },
			makeContext({ effectiveSpeedRegions: undefined, timeline: { clipRegions: clips } }),
		)) as { note: string };
		expect(blind.note).toMatch(/not at 1x speed/);
		const carried = (await renderPreview(
			{ atMs: 0 },
			makeContext({ effectiveSpeedRegions: [], timeline: { clipRegions: clips } }),
		)) as { note: string };
		expect(carried.note).not.toMatch(/not at 1x speed/);
	});

	it("drops every divergence caveat once the editor carries all three", async () => {
		const result = (await renderPreview({ atMs: 0 }, makeContext())) as { note: string };
		expect(result.note).not.toMatch(/could not be read/);
		expect(result.note).not.toMatch(/not at 1x speed/);
		expect(result.note).not.toMatch(/invisible to this tool/);
		expect(result.note).toBe(
			"This is the export's own renderer compositing at 1280x720 per frame, not the recorded screen.",
		);
	});
});

describe("render_preview warm cache", () => {
	it("keeps the video and the renderer warm for the next preview", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		const first = videos.length;
		const second = (await renderPreview({ atMs: 200 }, context)) as { reused: string[] };
		expect(second.reused).toEqual(["decoded video", "export renderer"]);
		expect(videos).toHaveLength(first);
		expect(recorder.configs).toHaveLength(1);
		expect(recorder.destroyed).toBe(0);
	});

	it("rebuilds the renderer when the look changes but keeps the decoded video", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		const opened = videos.length;
		const next = (await renderPreview(
			{ atMs: 200 },
			editContext(context, { appearance: { padding: 64 } }),
		)) as { reused: string[] };
		expect(next.reused).toEqual(["decoded video"]);
		expect(videos).toHaveLength(opened);
		expect(recorder.configs).toHaveLength(2);
		expect(recorder.configs[1]).toMatchObject({ padding: 64 });
		expect(recorder.destroyed).toBe(1);
	});

	it("rebuilds the renderer when a zoom is added, so an edit cannot show the old frame", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		const edited = (await renderPreview(
			{ atMs: 100 },
			editContext(context, {
				timeline: { zoomRegions: [{ id: "zoom-1", startMs: 0, endMs: 500, depth: 3 }] },
			}),
		)) as { reused: string[] };
		expect(edited.reused).toEqual(["decoded video"]);
		expect(recorder.configs).toHaveLength(2);
		expect(recorder.configs[1]).toMatchObject({ zoomRegions: [{ id: "zoom-1" }] });
	});

	it("drops both when the editor loads a different recording", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		const first = video();
		const next = (await renderPreview({ atMs: 100 }, {
			...context,
			videoSourcePath: "/tmp/other.mp4",
		} as unknown as EditorOpContext)) as { reused: string[] };
		expect(next.reused).toEqual([]);
		expect(first.cleared).toBe(true);
		expect(videos).toHaveLength(2);
		expect(recorder.destroyed).toBe(1);
		expect(recorder.configs).toHaveLength(2);
	});

	it("rebuilds the renderer after a cut, because clips are part of what it was built from", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		const opened = videos.length;
		const next = (await renderPreview(
			{ atMs: 100 },
			editContext(context, {
				timeline: { clipRegions: [clip({ startMs: 0, endMs: 4000 })] },
			}),
		)) as { reused: string[] };
		expect(next.reused).toEqual(["decoded video"]);
		expect(videos).toHaveLength(opened);
		expect(recorder.configs).toHaveLength(2);
	});

	it("rebuilds the renderer when the editor preview is resized", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		overlay = { clientWidth: 960, clientHeight: 540 };
		const next = (await renderPreview({ atMs: 100 }, context)) as { reused: string[] };
		expect(next.reused).toEqual(["decoded video"]);
		expect(recorder.configs[1]).toMatchObject({ previewWidth: 960, previewHeight: 540 });
	});

	it("does not seek when the warm video already sits on the wanted frame", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 400 }, context);
		const seeks = video().seeks.length;
		await renderPreview({ atMs: 400 }, context);
		expect(video().seeks).toHaveLength(seeks);
		expect(recorder.renders).toHaveLength(2);
	});

	it("releases the renderer and the video once it has been idle", async () => {
		await renderPreview({ atMs: 100 }, makeContext());
		expect(recorder.destroyed).toBe(0);
		await vi.advanceTimersByTimeAsync(59_000);
		expect(recorder.destroyed).toBe(0);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(recorder.destroyed).toBe(1);
		expect(video().cleared).toBe(true);
		const cold = (await renderPreview({ atMs: 100 }, makeContext())) as { reused: string[] };
		expect(cold.reused).toEqual([]);
	});

	it("does not let a run of previews keep the renderer alive past the last one", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		await vi.advanceTimersByTimeAsync(40_000);
		await renderPreview({ atMs: 200 }, context);
		await vi.advanceTimersByTimeAsync(40_000);
		expect(recorder.destroyed).toBe(0);
		await vi.advanceTimersByTimeAsync(21_000);
		expect(recorder.destroyed).toBe(1);
	});

	it("drops everything when a render throws, instead of leaving it warm", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		recorder.renderFails = true;
		await expect(renderPreview({ atMs: 200 }, context)).rejects.toThrow(/composite/);
		expect(recorder.destroyed).toBe(1);
		expect(video().cleared).toBe(true);
		recorder.renderFails = false;
		const cold = (await renderPreview({ atMs: 100 }, context)) as { reused: string[] };
		expect(cold.reused).toEqual([]);
	});

	it("invalidates the cached renderer when padTo changes the size the picture is drawn at", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		const next = (await renderPreview({ atMs: 100, padTo: "800x600" }, context)) as {
			reused: string[];
		};
		expect(next.reused).toEqual(["decoded video"]);
		expect(recorder.configs[1]).toMatchObject({ width: 800, height: 450 });
		expect(sameRendererConfig(recorder.configs[0], recorder.configs[1])).toBe(false);
		expect(recorder.destroyed).toBe(1);
	});

	it("invalidates the cached renderer when the editor's export aspect ratio changes", async () => {
		const context = makeContext();
		await renderPreview({ atMs: 100 }, context);
		const next = (await renderPreview(
			{ atMs: 100 },
			makeContext({ exportAspectRatio: "9:16" }),
		)) as { reused: string[] };
		expect(next.reused).toEqual(["decoded video"]);
		expect(recorder.configs[1]).toMatchObject({ width: 1080, height: 1920 });
		expect(sameRendererConfig(recorder.configs[0], recorder.configs[1])).toBe(false);
	});

	it("keeps the renderer when an aspect only adds bars, and still redraws them", async () => {
		const context = makeContext();
		const plain = (await renderPreview({ atMs: 100 }, context)) as {
			image: { height: number };
		};
		const barred = (await renderPreview({ atMs: 100, aspect: "1:1" }, context)) as {
			reused: string[];
			image: { height: number };
		};
		expect(barred.reused).toEqual(["decoded video", "export renderer"]);
		expect(recorder.configs).toHaveLength(1);
		expect(barred.image.height).not.toBe(plain.image.height);
	});

	it("changes nothing at all when the asked-for aspect is the recording's own", async () => {
		const context = makeContext();
		const plain = (await renderPreview({ atMs: 100 }, context)) as {
			image: { width: number; height: number };
		};
		const same = (await renderPreview({ atMs: 100, aspect: "16:9" }, context)) as {
			reused: string[];
			image: { width: number; height: number };
		};
		expect(same.reused).toEqual(["decoded video", "export renderer"]);
		expect(same.image).toEqual(plain.image);
		expect(recorder.configs).toHaveLength(1);
	});

	it("defers an explicit teardown asked for while a render is in flight", async () => {
		const context = makeContext();
		const inFlight = renderPreview({ atMs: 100 }, context);
		expect(teardownPreviewCache()).toBe(false);
		await inFlight;
		expect(recorder.destroyed).toBe(1);
		expect(video().cleared).toBe(true);
		await vi.advanceTimersByTimeAsync(70_000);
		expect(recorder.destroyed).toBe(1);
	});
});
