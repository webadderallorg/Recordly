import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBCAM_OVERLAY, DEFAULT_ZOOM_MOTION_BLUR_TUNING } from "../../types";
import { lookOps } from "./look";
import { getEditorState } from "./state";
import type { EditorOpContext } from "./types";

const PROBES: Record<string, unknown> = {
	connectZooms: true,
	zoomInDurationMs: 800,
	zoomOutDurationMs: 800,
	connectedZoomDurationMs: 800,
	connectedZoomGapMs: 100,
	zoomInOverlapMs: 200,
	zoomInEasing: "glide",
	zoomOutEasing: "glide",
	connectedZoomEasing: "glide",
	zoomSmoothness: 0.5,
	zoomClassicMode: true,
	zoomMotionBlur: 1,
	zoomMotionBlurTuning: { maxDirectionalBlurPx: 10 },
	showCursor: false,
	loopCursor: true,
	cursorStyle: "dot",
	cursorSize: 2,
	cursorSmoothing: 1,
	cursorMotionBlur: 1,
	cursorSway: 1,
	cursorClickEffect: "ripple",
	cursorClickEffectScale: 1,
	cursorClickEffectOpacity: 0.5,
	cursorClickEffectDurationMs: 400,
	cursorClickBounce: 1,
	cursorClickBounceDuration: 200,
	cursorSpringStiffnessMultiplier: 1,
	cursorSpringDampingMultiplier: 1,
	cursorSpringMassMultiplier: 1,
	cameraSpringStiffnessMultiplier: 1,
	cameraSpringDampingMultiplier: 1,
	cameraSpringMassMultiplier: 1,
};

const LOOK_STATE: Record<string, unknown> = {
	wallpaper: "#112233",
	padding: { top: 20, bottom: 20, left: 20, right: 20, linked: true },
	borderRadius: 12,
	shadowIntensity: 0.4,
	backgroundBlur: 2,
	cropRegion: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
	webcam: {
		...DEFAULT_WEBCAM_OVERLAY,
		sourcePath: "/tmp/cam.webm",
		visibleRanges: [{ startMs: 0, endMs: 1000 }],
		cornerRadius: 8,
	},
};

const LOOK_WRITES: Record<string, unknown> = {
	wallpaper: "#abcdef",
	padding: { top: 40, bottom: 40, left: 40, right: 40, linked: true },
	borderRadius: 30,
	shadowIntensity: 0.9,
	backgroundBlur: 6,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	webcam: { size: 55, corner: "top-left", enabled: true },
};

function appearanceStub() {
	const state: Record<string, unknown> = {
		...LOOK_STATE,
		...PROBES,
		zoomMotionBlurTuning: DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	};
	return new Proxy(state, {
		get(target, key: string) {
			if (key.startsWith("set")) {
				return (value: unknown) => {
					target[key[3].toLowerCase() + key.slice(4)] = value;
				};
			}
			return target[key];
		},
	});
}

function context(): EditorOpContext {
	return {
		duration: 10,
		videoSourcePath: "/tmp/take.mp4",
		timeline: {
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 10_000, sourceStartMs: 0, speed: 1 }],
			zoomRegions: [],
			annotationRegions: [],
			audioRegions: [],
			autoCaptions: [],
		},
		appearance: appearanceStub(),
		history: { undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false },
		ids: {},
		assertSameRecording: () => undefined,
		adoptJoinedMedia: () => undefined,
	} as unknown as EditorOpContext;
}

function accepts(field: string): boolean {
	try {
		lookOps["look.motion"]({ [field]: PROBES[field] }, context());
		return true;
	} catch (error) {
		if (error instanceof Error && /unknown field/.test(error.message)) return false;
		throw error;
	}
}

describe("look.motion and get_editor_state agree on the motion settings", () => {
	beforeEach(() => {
		vi.stubGlobal("window", {
			electronAPI: { getAgentActivity: vi.fn(async () => ({ success: false })) },
		});
	});

	it("reports back every motion setting look.motion accepts", async () => {
		const reported = Object.keys((await getEditorState(context())).motion);
		const writableButInvisible = Object.keys(PROBES).filter(
			(field) => accepts(field) && !reported.includes(field),
		);
		expect(writableButInvisible).toEqual([]);
	});

	it("accepts every motion setting get_editor_state reports back", async () => {
		const reported = Object.keys((await getEditorState(context())).motion);
		const readableButUnsettable = reported.filter((field) => !accepts(field));
		expect(readableButUnsettable).toEqual([]);
	});
});

async function lookOf(ctx: EditorOpContext) {
	return (await getEditorState(ctx)).look as Record<string, unknown>;
}

describe("look.set and get_editor_state agree on the look", () => {
	beforeEach(() => {
		vi.stubGlobal("window", {
			electronAPI: { getAgentActivity: vi.fn(async () => ({ success: false })) },
		});
	});

	it("reports every look field and accepts the whole report back unchanged", async () => {
		const ctx = context();
		const before = await lookOf(ctx);
		expect(Object.keys(before).sort()).toEqual(Object.keys(LOOK_STATE).sort());
		lookOps["look.set"](before, ctx);
		expect(await lookOf(ctx)).toEqual(before);
	});

	it.each(Object.keys(LOOK_STATE))("accepts the reported %s on its own", async (field) => {
		const ctx = context();
		const before = await lookOf(ctx);
		lookOps["look.set"]({ [field]: before[field] }, ctx);
		expect(await lookOf(ctx)).toEqual(before);
	});

	it.each(
		Object.keys(LOOK_WRITES),
	)("reads back exactly what was written to %s", async (field) => {
		const ctx = context();
		lookOps["look.set"]({ [field]: LOOK_WRITES[field] }, ctx);
		expect((await lookOf(ctx))[field]).toMatchObject(LOOK_WRITES[field] as object);
	});

	it("reads back the written value for crop, the other name for cropRegion", async () => {
		const ctx = context();
		lookOps["look.set"]({ crop: { x: 0.2, y: 0.2, width: 0.8, height: 0.8 } }, ctx);
		expect((await lookOf(ctx)).cropRegion).toEqual({ x: 0.2, y: 0.2, width: 0.8, height: 0.8 });
	});

	it("reports linked false when linked is omitted, which is what the editor now holds", async () => {
		const ctx = context();
		const result = lookOps["look.set"](
			{ padding: { top: 40, bottom: 40, left: 40, right: 40 } },
			ctx,
		) as { applied: { padding: unknown } };
		expect(result.applied.padding).toEqual({
			top: 40,
			bottom: 40,
			left: 40,
			right: 40,
			linked: false,
		});
		expect((await lookOf(ctx)).padding).toEqual(result.applied.padding);
	});

	it("round-trips unlinked padding past the linked vertical limit", async () => {
		const ctx = context();
		lookOps["look.set"](
			{ padding: { top: 250, bottom: 0, left: 100, right: 0, linked: false } },
			ctx,
		);
		const padding = (await lookOf(ctx)).padding;
		expect(padding).toEqual({ top: 250, bottom: 0, left: 100, right: 0, linked: false });
		lookOps["look.set"]({ padding }, ctx);
		expect((await lookOf(ctx)).padding).toEqual(padding);
	});

	it("still refuses an unknown look field by name", () => {
		expect(() => lookOps["look.set"]({ glow: 1 }, context())).toThrow(/unknown field glow/);
	});
});
