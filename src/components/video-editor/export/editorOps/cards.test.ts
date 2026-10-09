import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AnnotationRegion,
	type ClipRegion,
	getClipSourceStartMs,
	isBlankClip,
	isStillClip,
} from "../../types";
import { cardsOps } from "./cards";
import type { EditorOpContext } from "./types";

const mockGetRenderableAssetUrl = vi.fn(async (asset: string) =>
	asset.includes("missing") ? asset : "data:image/png;base64,AAAA",
);

vi.mock("@/lib/assetPath", () => ({
	isAbsoluteLocalAssetPath: (asset: string) => asset.startsWith("/"),
	getRenderableAssetUrl: (asset: string) => mockGetRenderableAssetUrl(asset),
}));

const clip = (id: string, startMs: number, endMs: number, extra: Partial<ClipRegion> = {}) =>
	({ id, startMs, endMs, speed: 1, sourceStartMs: startMs, ...extra }) as ClipRegion;

function makeContext(clips: ClipRegion[], duration = 20) {
	type Region = { id: string; startMs: number; endMs: number };
	const state = {
		clips,
		zooms: [{ id: "z", startMs: 15000, endMs: 16000 }] as Region[],
		annotations: [] as AnnotationRegion[],
		audios: [{ id: "u", startMs: 15000, endMs: 18000 }] as Region[],
		captions: [{ id: "c", startMs: 15000, endMs: 16000 }] as Region[],
	};
	const apply = <T>(current: T, next: unknown) =>
		typeof next === "function" ? (next as (value: T) => T)(current) : (next as T);
	const context = {
		duration,
		videoSourcePath: "/tmp/a.mp4",
		timeline: {
			get clipRegions() {
				return state.clips;
			},
			get annotationRegions() {
				return state.annotations;
			},
			selectedClipId: null,
			setClipRegions: (next: unknown) => {
				state.clips = apply(state.clips, next);
			},
			setSelectedClipId: () => undefined,
			setZoomRegions: (next: unknown) => {
				state.zooms = apply(state.zooms, next);
			},
			setAnnotationRegions: (next: unknown) => {
				state.annotations = apply(state.annotations, next);
			},
			setAudioRegions: (next: unknown) => {
				state.audios = apply(state.audios, next);
			},
			setAutoCaptions: (next: unknown) => {
				state.captions = apply(state.captions, next);
			},
		},
		ids: {
			zoom: { current: 1 },
			clip: { current: 1 },
			audio: { current: 1 },
			annotation: { current: 1 },
			annotationZIndex: { current: 1 },
		},
		assertSameRecording: () => undefined,
		adoptJoinedMedia: () => undefined,
	} as unknown as EditorOpContext;
	return { state, context };
}

type CardResult = {
	changed: boolean;
	durationMs: number;
	clipCount: number;
	card: { kind: string; position: string; startMs: number; endMs: number };
};

const add = (kind: "title" | "end", payload: unknown, context: EditorOpContext) =>
	cardsOps[`card.${kind}`](payload, context) as Promise<CardResult>;

const fill = (annotations: AnnotationRegion[]) =>
	annotations.find((annotation) => annotation.style.fillBox);

describe("add_card", () => {
	beforeEach(() => {
		mockGetRenderableAssetUrl.mockClear();
	});

	it("puts a title card at the start, extends the timeline and moves later effects", async () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		const result = await add(
			"title",
			{ text: "Filing a timesheet", subtitle: "in under a minute", durationMs: 2500 },
			context,
		);
		expect(result.durationMs).toBe(22500);
		expect(result.card).toMatchObject({ position: "start", startMs: 0, endMs: 2500 });
		expect(state.clips.map((c) => [c.startMs, c.endMs])).toEqual([
			[0, 2500],
			[2500, 22500],
		]);
		expect(state.clips[1].id).toBe("a");
		expect(getClipSourceStartMs(state.clips[1])).toBe(0);
		expect(state.zooms).toEqual([{ id: "z", startMs: 17500, endMs: 18500 }]);
		expect(state.audios).toEqual([{ id: "u", startMs: 17500, endMs: 20500 }]);
		expect(state.captions).toEqual([{ id: "c", startMs: 17500, endMs: 18500 }]);
		expect(state.annotations).toHaveLength(3);
		for (const annotation of state.annotations) {
			expect(annotation.space).toBe("screen");
			expect([annotation.startMs, annotation.endMs]).toEqual([0, 2500]);
		}
		expect(fill(state.annotations)).toMatchObject({
			type: "text",
			content: "",
			position: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
		});
		expect(fill(state.annotations)?.style.backgroundColor).toBe("#000000");
		expect(state.annotations.map((a) => a.content)).toContain("Filing a timesheet");
		expect(state.annotations.map((a) => a.content)).toContain("in under a minute");
	});

	it("holds the last frame under an end card instead of stopping on live UI", async () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		const result = await add("end", { text: "Thanks", durationMs: 3000 }, context);
		expect(result.card).toMatchObject({ position: "end", startMs: 20000, endMs: 23000 });
		expect(state.clips).toHaveLength(2);
		expect(isStillClip(state.clips[1])).toBe(true);
		expect(isBlankClip(state.clips[1])).toBe(false);
		expect(state.clips[1].muted).toBe(true);
		expect(state.zooms).toEqual([{ id: "z", startMs: 15000, endMs: 16000 }]);
		expect(state.annotations).toHaveLength(2);
	});

	it("refuses a card with no footage to hold, since blank time carries no words", async () => {
		const { state, context } = makeContext([]);
		await expect(add("title", { text: "Intro", durationMs: 1500 }, context)).rejects.toThrow(
			/no clips yet/,
		);
		expect(state.clips).toEqual([]);
		expect(state.annotations).toEqual([]);
	});

	it("holds a real frame under a title card, so the words have something to sit on", async () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await add("title", { text: "Entries", durationMs: 2000 }, context);
		expect(isBlankClip(state.clips[0])).toBe(false);
		expect(isStillClip(state.clips[0])).toBe(true);
		expect(getClipSourceStartMs(state.clips[0])).toBe(0);
		expect(state.clips[0].muted).toBe(true);
	});

	it.each([
		["without a logo", undefined],
		["with a logo", "/tmp/logo.png"],
	])("gives the heading a box two lines deep, clear of its neighbours %s", async (_l, logo) => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await add(
			"title",
			{ text: "Payroll, end to end", subtitle: "every month", durationMs: 2000, logo },
			context,
		);
		const box = (match: (annotation: AnnotationRegion) => boolean) => {
			const found = state.annotations.find(match)!;
			return { top: found.position.y, bottom: found.position.y + found.size.height };
		};
		const heading = box((a) => a.content === "Payroll, end to end");
		expect(heading.bottom - heading.top).toBeGreaterThanOrEqual(26);
		expect(heading.bottom).toBeLessThanOrEqual(box((a) => a.content === "every month").top);
		if (logo) expect(box((a) => a.type === "image").bottom).toBeLessThanOrEqual(heading.top);
	});

	it("accepts an explicit position that contradicts the kind", async () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await add("end", { text: "Chapter two", durationMs: 1000, position: "start" }, context);
		expect(state.clips[0].endMs).toBe(1000);
	});

	it("reads a logo once and pins it above the words", async () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await add(
			"title",
			{ text: "Recordly", durationMs: 2000, logo: "/tmp/logo.png", background: "#fff" },
			context,
		);
		expect(mockGetRenderableAssetUrl).toHaveBeenCalledTimes(1);
		const image = state.annotations.find((a) => a.type === "image");
		expect(image?.imageContent).toBe("data:image/png;base64,AAAA");
		expect(fill(state.annotations)?.style.backgroundColor).toBe("#FFF");
	});

	it("stacks two cards, each adding its own time", async () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await add("title", { text: "One", durationMs: 1000 }, context);
		const second = await add("title", { text: "Two", durationMs: 1000 }, context);
		expect(second.durationMs).toBe(22000);
		expect(state.clips).toHaveLength(3);
		expect(state.annotations).toHaveLength(4);
		expect(new Set(state.annotations.map((a) => a.id)).size).toBe(4);
	});

	it.each([
		["missing text", { durationMs: 1000 }, /text must be a string/],
		["empty text", { text: "   ", durationMs: 1000 }, /text is empty/],
		[
			"a non-string subtitle",
			{ text: "A", subtitle: 7, durationMs: 1000 },
			/subtitle must be a string/,
		],
		["text past the limit", { text: "x".repeat(201), durationMs: 1000 }, /at most 200/],
		["durationMs of 0", { text: "A", durationMs: 0 }, /from 1 to 600000/],
		["negative durationMs", { text: "A", durationMs: -1 }, /from 1 to 600000/],
		["absurd durationMs", { text: "A", durationMs: 3_600_000 }, /from 1 to 600000/],
		["missing durationMs", { text: "A" }, /durationMs must be a number/],
		["a bad background", { text: "A", durationMs: 1000, background: "black" }, /hex colour/],
		["a relative logo", { text: "A", durationMs: 1000, logo: "logo.png" }, /absolute path/],
		[
			"a non-image logo",
			{ text: "A", durationMs: 1000, logo: "/tmp/notes.txt" },
			/must be one of/,
		],
		[
			"an unreadable logo",
			{ text: "A", durationMs: 1000, logo: "/tmp/missing.png" },
			/could not be read/,
		],
		[
			"an unknown position",
			{ text: "A", durationMs: 1000, position: "middle" },
			/"start" or "end"/,
		],
		[
			"an unknown field",
			{ text: "A", durationMs: 1000, colour: "red" },
			/unknown field colour/,
		],
		["a non-object payload", "A", /needs an object of arguments/],
	])("refuses %s and changes nothing", async (_label, payload, message) => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await expect(add("title", payload, context)).rejects.toThrow(message);
		expect(state.clips).toEqual([clip("a", 0, 20000)]);
		expect(state.annotations).toEqual([]);
		expect(state.zooms).toEqual([{ id: "z", startMs: 15000, endMs: 16000 }]);
	});

	it("accepts an empty subtitle by leaving it out", async () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await add("title", { text: "A", subtitle: "  ", durationMs: 1000 }, context);
		expect(state.annotations).toHaveLength(2);
	});
});
