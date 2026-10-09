import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentActivityLog } from "../../agentEdits/planAgentEdits";
import {
	type ClipRegion,
	getClipSourceEndMs,
	getClipSourceStartMs,
	getTimelineDurationMs,
} from "../../types";
import { findHoldSlackRanges, findIdleRanges, timelineOps } from "./timeline";
import type { EditorOpContext } from "./types";

const clip = (id: string, startMs: number, endMs: number, extra: Partial<ClipRegion> = {}) =>
	({ id, startMs, endMs, speed: 1, ...extra }) as ClipRegion;

function makeContext(clips: ClipRegion[], duration = 20) {
	type Region = { id: string; startMs: number; endMs: number };
	const state = {
		clips,
		zooms: [{ id: "z", startMs: 15000, endMs: 16000 }] as Region[],
		annotations: [{ id: "n", startMs: 15000, endMs: 16000 }] as Region[],
		audios: [{ id: "u", startMs: 15000, endMs: 18000 }] as Region[],
		captions: [
			{ id: "c", startMs: 15000, endMs: 16000, words: [{ startMs: 15000, endMs: 16000 }] },
		] as Array<Region & { words?: Region[] }>,
		selected: null as string | null,
		writes: 0,
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
			get selectedClipId() {
				return state.selected;
			},
			setClipRegions: (next: unknown) => {
				state.writes++;
				state.clips = apply(state.clips, next);
			},
			setSelectedClipId: (id: string | null) => {
				state.selected = id;
			},
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
		history: { undo: () => undefined, redo: () => undefined },
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

type Result = {
	changed: boolean;
	durationMs: number;
	clipCount: number;
	sceneMs: number;
	levers: string[];
};

const footage = (clips: ClipRegion[]) =>
	clips.map((c) => [getClipSourceStartMs(c), getClipSourceEndMs(c)]);

const atNormalSpeed = (clips: ClipRegion[]) => footage(clips.filter((c) => c.speed === 1));

const run = (op: string, payload: unknown, context: EditorOpContext) =>
	timelineOps[op](payload, context) as Result;

const log: AgentActivityLog = {
	version: 1,
	scenes: [
		{ startMs: 0, endMs: 12000, failed: false },
		{ startMs: 12000, endMs: 20000, failed: false },
	],
	spans: [
		{ kind: "motion", action: "click", startMs: 0, endMs: 1000 },
		{ kind: "wait", action: "wait", startMs: 2000, endMs: 12000 },
		{ kind: "motion", action: "click", startMs: 12000, endMs: 13000 },
	],
};

const exactLog: AgentActivityLog = {
	version: 1,
	scenes: [{ startMs: 0, endMs: 40000, failed: false }],
	spans: [
		{ kind: "motion", action: "click", startMs: 0, endMs: 1000 },
		{ kind: "wait", action: "wait", startMs: 2000, endMs: 11500 },
		{ kind: "motion", action: "click", startMs: 12700, endMs: 13700 },
		{ kind: "wait", action: "wait", startMs: 14700, endMs: 17200 },
		{ kind: "motion", action: "click", startMs: 18200, endMs: 19200 },
		{ kind: "wait", action: "wait", startMs: 20200, endMs: 22700 },
		{ kind: "motion", action: "click", startMs: 23700, endMs: 24700 },
		{ kind: "wait", action: "wait", startMs: 25700, endMs: 28200 },
		{ kind: "motion", action: "click", startMs: 29200, endMs: 30200 },
	],
};

const exactClips = (): ClipRegion[] => [
	clip("a", 0, 3200, { sourceStartMs: 0 }),
	clip("b", 3200, 4200, { sourceStartMs: 3200, speed: 8 }),
	clip("c", 4200, 8900, { sourceStartMs: 11200 }),
	clip("d", 8900, 9900, { sourceStartMs: 15900 }),
	clip("e", 9900, 14400, { sourceStartMs: 16900 }),
	clip("f", 14400, 15400, { sourceStartMs: 21400 }),
	clip("g", 15400, 19900, { sourceStartMs: 22400 }),
	clip("h", 19900, 20900, { sourceStartMs: 26900 }),
	clip("i", 20900, 33000, { sourceStartMs: 27900 }),
];

const compressedLog: AgentActivityLog = {
	version: 1,
	scenes: [
		{ startMs: 0, endMs: 9000, failed: false },
		{ startMs: 9000, endMs: 20000, failed: false },
	],
	spans: [
		{ kind: "motion", action: "click", startMs: 0, endMs: 1000 },
		{ kind: "wait", action: "wait", startMs: 1000, endMs: 1500 },
		{ kind: "hold", action: "wait", startMs: 1500, endMs: 8000 },
		{ kind: "motion", action: "click", startMs: 8000, endMs: 9000 },
		{ kind: "wait", action: "wait", startMs: 9000, endMs: 9500 },
		{ kind: "hold", action: "wait", startMs: 9500, endMs: 16000 },
		{ kind: "motion", action: "click", startMs: 16000, endMs: 17000 },
	],
};

const compressedClips = (): ClipRegion[] => [
	clip("a", 0, 5200, { sourceStartMs: 0 }),
	clip("b", 5200, 11100, { sourceStartMs: 7300 }),
	clip("c", 11100, 14000, { sourceStartMs: 15300 }),
];

const floorHoldLog: AgentActivityLog = {
	version: 1,
	scenes: [{ startMs: 0, endMs: 10000, failed: false }],
	spans: [
		{ kind: "motion", action: "click", startMs: 0, endMs: 1000 },
		{ kind: "hold", action: "wait", startMs: 1000, endMs: 2000 },
	],
};

function stubActivity(result: unknown) {
	vi.stubGlobal("window", { electronAPI: { getAgentActivity: async () => result } });
}

async function opsOnDeviceMaxRate(maxRate: number) {
	vi.stubGlobal("document", {
		createElement: () => ({
			set playbackRate(rate: number) {
				if (rate > maxRate) throw new DOMException("Unsupported rate", "NotSupportedError");
			},
		}),
	});
	vi.resetModules();
	const { timelineOps: ops } = await import("./timeline");
	return (op: string, payload: unknown, context: EditorOpContext) =>
		ops[op](payload, context) as Promise<Result>;
}

beforeEach(() =>
	vi.stubGlobal("document", {
		createElement: () => ({
			set playbackRate(rate: number) {
				if (rate > 16) throw new DOMException("Unsupported rate", "NotSupportedError");
			},
		}),
	}),
);

afterEach(() => vi.unstubAllGlobals());

describe("timeline.split", () => {
	it("splits a clip at a timeline time and keeps source continuity", () => {
		const { state, context } = makeContext([clip("clip-1", 0, 10000, { speed: 2 })]);
		const result = run("timeline.split", { timeMs: 4000 }, context);
		expect(result.clipCount).toBe(2);
		expect(state.clips.map((c) => [c.startMs, c.endMs, c.sourceStartMs ?? 0])).toEqual([
			[0, 4000, 0],
			[4000, 10000, 8000],
		]);
	});

	it("refuses a split on an existing boundary and changes nothing", () => {
		const { state, context } = makeContext([clip("a", 0, 5000), clip("b", 5000, 10000)]);
		expect(() => run("timeline.split", { timeMs: 5000 }, context)).toThrow(
			/already a clip boundary/,
		);
		expect(state.writes).toBe(0);
	});

	it("rejects non-finite and out-of-range times", () => {
		const { state, context } = makeContext([clip("a", 0, 10000)]);
		expect(() => run("timeline.split", { timeMs: Number.NaN }, context)).toThrow(
			/must be a number/,
		);
		expect(() => run("timeline.split", { timeMs: 99999 }, context)).toThrow(
			/timeline milliseconds/,
		);
		expect(() => run("timeline.split", {}, context)).toThrow(/must be a number/);
		expect(state.writes).toBe(0);
	});

	it("refuses an empty timeline", () => {
		const { context } = makeContext([]);
		expect(() => run("timeline.split", { timeMs: 1 }, context)).toThrow(/no clips/);
	});

	it("moves the selection to the left half instead of leaving it on a deleted id", () => {
		const { state, context } = makeContext([clip("a", 0, 10000)]);
		state.selected = "a";
		run("timeline.split", { timeMs: 4000 }, context);
		expect(state.clips.map((c) => c.id)).toEqual(["clip-1", "clip-2"]);
		expect(state.selected).toBe("clip-1");
	});
});

describe("timeline.remove", () => {
	it("drops the span, closes the gap and ripples every region type", () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		const result = run("timeline.remove", { startMs: 5000, endMs: 10000 }, context);
		expect(result.durationMs).toBe(15000);
		expect(state.clips.map((c) => [c.startMs, c.endMs, c.sourceStartMs ?? 0])).toEqual([
			[0, 5000, 0],
			[5000, 15000, 10000],
		]);
		expect(state.zooms).toEqual([{ id: "z", startMs: 10000, endMs: 11000 }]);
		expect(state.annotations).toEqual([{ id: "n", startMs: 10000, endMs: 11000 }]);
		expect(state.audios).toEqual([{ id: "u", startMs: 10000, endMs: 13000 }]);
	});

	it("refuses to remove everything and an inverted range", () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		expect(() => run("timeline.remove", { startMs: 0, endMs: 20000 }, context)).toThrow(
			/whole recording/,
		);
		expect(() => run("timeline.remove", { startMs: 9, endMs: 3 }, context)).toThrow(
			/after startMs/,
		);
		expect(state.writes).toBe(0);
	});
});

describe("timeline.trim", () => {
	it("keeps only a span of the whole recording", () => {
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		run("timeline.trim", { startMs: 2000, endMs: 8000 }, context);
		expect(state.clips.map((c) => [c.startMs, c.endMs, c.sourceStartMs ?? 0])).toEqual([
			[0, 6000, 2000],
		]);
	});

	it("trims one clip within its own span", () => {
		const { state, context } = makeContext([clip("a", 0, 10000), clip("b", 10000, 20000)]);
		run("timeline.trim", { clipIndex: 0, startMs: 1000, endMs: 4000 }, context);
		expect(state.clips.map((c) => [c.startMs, c.endMs])).toEqual([
			[0, 3000],
			[3000, 13000],
		]);
	});

	it("refuses a span outside the clip, and a no-op span", () => {
		const { state, context } = makeContext([clip("a", 0, 10000), clip("b", 10000, 20000)]);
		expect(() =>
			run("timeline.trim", { clipIndex: 0, startMs: 0, endMs: 12000 }, context),
		).toThrow(/must lie inside it/);
		expect(() => run("timeline.trim", { clipIndex: 5, startMs: 0, endMs: 1 }, context)).toThrow(
			/clipIndex must be a whole number/,
		);
		expect(
			run("timeline.trim", { clipIndex: 0, startMs: 0, endMs: 10000 }, context).changed,
		).toBe(false);
		expect(state.writes).toBe(0);
	});
});

describe("timeline.speed", () => {
	it("re-speeds a clip and ripples the clips after it", () => {
		const { state, context } = makeContext([clip("a", 0, 10000), clip("b", 10000, 20000)]);
		run("timeline.speed", { clipIndex: 0, speed: 2 }, context);
		expect(state.clips.map((c) => [c.startMs, c.endMs, c.speed])).toEqual([
			[0, 5000, 2],
			[5000, 15000, 1],
		]);
	});

	it("accepts the rates the clip slider offers, not only the speed-region presets", () => {
		const { state, context } = makeContext([clip("a", 0, 8000)]);
		run("timeline.speed", { speed: 4 }, context);
		expect(state.clips.map((c) => [c.endMs, c.speed])).toEqual([[2000, 4]]);
	});

	it("restores normal speed without leaving a sped-up clip behind", () => {
		const { state, context } = makeContext([clip("a", 0, 10000), clip("b", 10000, 20000)]);
		run("timeline.speed", { clipIndex: 0, speed: 2 }, context);
		run("timeline.speed", { clipIndex: 0, speed: 1 }, context);
		expect(state.clips.map((c) => [c.startMs, c.endMs, c.speed])).toEqual([
			[0, 10000, 1],
			[10000, 20000, 1],
		]);
	});

	it("rejects a rate the device cannot play, and zero", () => {
		const { state, context } = makeContext([clip("a", 0, 10000)]);
		expect(() => run("timeline.speed", { speed: 40 }, context)).toThrow(/cannot play/);
		expect(() => run("timeline.speed", { speed: 0 }, context)).toThrow(/cannot play/);
		expect(() => run("timeline.speed", { speed: Number.NaN }, context)).toThrow(
			/must be a number/,
		);
		expect(state.writes).toBe(0);
	});

	it("needs clipIndex when there are several clips, and reports a no-op", () => {
		const { context } = makeContext([clip("a", 0, 10000), clip("b", 10000, 20000)]);
		expect(() => run("timeline.speed", { speed: 2 }, context)).toThrow(/needs clipIndex/);
		expect(run("timeline.speed", { clipIndex: 1, speed: 1 }, context).changed).toBe(false);
	});
});

describe("timeline.reorder", () => {
	it("moves a clip and repacks the sequence", () => {
		const { state, context } = makeContext([clip("a", 0, 4000), clip("b", 4000, 10000)]);
		run("timeline.reorder", { fromIndex: 1, toIndex: 0 }, context);
		expect(state.clips.map((c) => [c.id, c.startMs, c.endMs])).toEqual([
			["b", 0, 6000],
			["a", 6000, 10000],
		]);
	});

	it("refuses a single clip, bad indexes and a same-place move", () => {
		const single = makeContext([clip("a", 0, 4000)]);
		expect(() => run("timeline.reorder", { fromIndex: 0, toIndex: 0 }, single.context)).toThrow(
			/single clip/,
		);
		const { state, context } = makeContext([clip("a", 0, 4000), clip("b", 4000, 10000)]);
		expect(() => run("timeline.reorder", { fromIndex: 0, toIndex: 2 }, context)).toThrow(
			/toIndex must be a whole number/,
		);
		expect(run("timeline.reorder", { fromIndex: 1, toIndex: 1 }, context).changed).toBe(false);
		expect(state.writes).toBe(0);
	});
});

describe("findIdleRanges", () => {
	it("keeps the planner's margins and protects motion", () => {
		expect(findIdleRanges(log, 20000)).toEqual([{ startMs: 3200, endMs: 11300 }]);
	});

	it("protects screen changes", () => {
		const ranges = findIdleRanges({ ...log, changeTimesMs: [7000] }, 20000);
		expect(ranges).toEqual([
			{ startMs: 3200, endMs: 6600 },
			{ startMs: 7400, endMs: 11300 },
		]);
	});
});

describe("timeline.fit", () => {
	it("speeds up idle stretches to hit the target and leaves action alone", async () => {
		stubActivity({ success: true, log });
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		const result = await run("timeline.fit", { targetMs: 15000 }, context);
		expect(result.durationMs).toBe(15000);
		expect(getTimelineDurationMs(state.clips, 20000)).toBe(15000);
		const sped = state.clips.filter((c) => c.speed > 1);
		expect(sped).toHaveLength(1);
		expect(sped[0].sourceStartMs).toBe(3200);
		expect(state.clips.filter((c) => c.speed === 1).length).toBeGreaterThanOrEqual(2);
	});

	it("shortens an edit that slowed clips made longer than the raw recording", async () => {
		stubActivity({ success: true, log });
		const { state, context } = makeContext([
			clip("a", 0, 40000, { speed: 0.5, sourceStartMs: 0 }),
		]);
		const result = await run("timeline.fit", { targetMs: 35000 }, context);
		expect(result.durationMs).toBe(35000);
		expect(getTimelineDurationMs(state.clips, 20000)).toBe(35000);
	});

	it("absorbs the rounding residual in a slot that has room for it", async () => {
		stubActivity({ success: true, log: exactLog });
		const { state, context } = makeContext(exactClips(), 40);
		const result = await run("timeline.fit", { targetMs: 32998 }, context);
		expect(result.durationMs).toBe(32998);
		expect(getTimelineDurationMs(state.clips, 40000)).toBe(32998);
	});

	it("trims once speed alone is not enough", async () => {
		stubActivity({ success: true, log });
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		const result = await run("timeline.fit", { targetMs: 12500 }, context);
		expect(result.durationMs).toBe(12500);
		expect(state.clips.every((c) => c.speed === 1 || c.speed >= 8)).toBe(true);
	});

	it("says how far short it fell, names every lever it tried, and changes nothing", async () => {
		stubActivity({ success: true, log });
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await expect(run("timeline.fit", { targetMs: 5000 }, context)).rejects.toThrow(
			/every idle stretch, shaving every end-of-scene hold to its 800 ms floor and running the kept footage at 1\.25x together remove at most 11040 ms, which is 3960 ms short/,
		);
		expect(state.writes).toBe(0);
	});

	it("rejects zero and non-shortening targets", async () => {
		stubActivity({ success: true, log });
		const { state, context } = makeContext([clip("a", 0, 10000)], 20);
		await expect(run("timeline.fit", { targetMs: 0 }, context)).rejects.toThrow(/more than 0/);
		await expect(run("timeline.fit", { targetMs: 25000 }, context)).rejects.toThrow(
			/only shortens/,
		);
		await expect(run("timeline.fit", { targetMs: 15000 }, context)).rejects.toThrow(
			/only shortens/,
		);
		expect((await run("timeline.fit", { targetMs: 10000 }, context)).changed).toBe(false);
		expect(state.writes).toBe(0);
	});

	it("reports a missing activity log by name", async () => {
		stubActivity({ success: false, log: null, message: "No activity log." });
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await expect(run("timeline.fit", { targetMs: 15000 }, context)).rejects.toThrow(
			/No activity log/,
		);
		expect(state.writes).toBe(0);
	});
});

describe("findHoldSlackRanges", () => {
	it("offers the generous part of each reading hold and keeps the floor", () => {
		expect(findHoldSlackRanges(compressedLog, 20000)).toEqual([
			{ startMs: 2000, endMs: 5200 },
			{ startMs: 10000, endMs: 13200 },
		]);
	});

	it("offers nothing from a hold the planner already keeps at its floor", () => {
		expect(findHoldSlackRanges(floorHoldLog, 10000)).toEqual([]);
		expect(findIdleRanges(floorHoldLog, 10000)).toEqual([]);
	});

	it("never offers footage the planner protects as action", () => {
		const ranges = findHoldSlackRanges(
			{ ...compressedLog, changeTimesMs: [2200, 10200] },
			20000,
		);
		expect(ranges).toEqual([
			{ startMs: 2600, endMs: 5200 },
			{ startMs: 10600, endMs: 13200 },
		]);
	});
});

describe("timeline.fit on an edit the automatic pass already compressed", () => {
	it("has no idle footage left to take", () => {
		const idle = findIdleRanges(compressedLog, 20000);
		expect(idle).toEqual([
			{ startMs: 5200, endMs: 7300 },
			{ startMs: 13200, endMs: 15300 },
		]);
		const overlapping = footage(compressedClips()).filter(([startMs, endMs]) =>
			idle.some((range) => startMs < range.endMs && endMs > range.startMs),
		);
		expect(overlapping).toEqual([]);
	});

	it("shaves the reading holds once the idle stretches are gone", async () => {
		stubActivity({ success: true, log: compressedLog });
		const { state, context } = makeContext(compressedClips());
		const result = await run("timeline.fit", { targetMs: 10000 }, context);
		expect(result.levers).toEqual(["idle", "holds"]);
		expect(result.durationMs).toBe(10000);
		expect(getTimelineDurationMs(state.clips, 20000)).toBe(10000);
		expect(atNormalSpeed(state.clips)).toEqual([
			[0, 2000],
			[7300, 10000],
			[15300, 18200],
		]);
		expect(footage(state.clips.filter((c) => c.speed > 1))).toEqual([
			[2000, 5200],
			[10000, 13200],
		]);
	});

	it("adds a mild speed-up over the kept footage when the holds are not enough", async () => {
		stubActivity({ success: true, log: compressedLog });
		const { state, context } = makeContext(compressedClips());
		const result = await run("timeline.fit", { targetMs: 7000 }, context);
		expect(result.levers).toEqual(["idle", "holds", "speed"]);
		expect(result.durationMs).toBe(7000);
		expect(getTimelineDurationMs(state.clips, 20000)).toBe(7000);
		expect(footage(state.clips)).toEqual([
			[0, 2000],
			[7300, 10000],
			[15300, 18200],
		]);
		expect(state.clips.every((c) => c.speed > 1 && c.speed <= 1.25)).toBe(true);
	});

	it("refuses a target that only a speed-up past 1.25x could reach", async () => {
		stubActivity({ success: true, log: compressedLog });
		const { state, context } = makeContext(compressedClips());
		await expect(run("timeline.fit", { targetMs: 6000 }, context)).rejects.toThrow(
			/remove at most 7920 ms, which is 80 ms short/,
		);
		expect(state.writes).toBe(0);
	});

	it("refuses when every hold is already at its floor and 1.25x is not enough", async () => {
		stubActivity({ success: true, log: floorHoldLog });
		const { state, context } = makeContext([clip("a", 0, 10000)], 10);
		await expect(run("timeline.fit", { targetMs: 7000 }, context)).rejects.toThrow(
			/remove at most 2000 ms, which is 1000 ms short/,
		);
		expect(state.writes).toBe(0);
	});

	it("still spends the idle stretches first and leaves the holds alone", async () => {
		stubActivity({ success: true, log });
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		const result = await run("timeline.fit", { targetMs: 15000 }, context);
		expect(result.levers).toEqual(["idle"]);
		expect(atNormalSpeed(state.clips)).toEqual([
			[0, 3200],
			[11300, 20000],
		]);
	});
});

describe("timeline.fit on a device with a slower top playback rate", () => {
	it("ramps no faster than the device can play", async () => {
		stubActivity({ success: true, log });
		const onDevice = await opsOnDeviceMaxRate(4);
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		const result = await onDevice("timeline.fit", { targetMs: 12500 }, context);
		expect(result.durationMs).toBe(12500);
		expect(getTimelineDurationMs(state.clips, 20000)).toBe(12500);
		expect(state.clips.map((c) => c.speed)).toEqual([1, 4, 1]);
	});

	it("trims instead of writing a rate the device cannot play at all", async () => {
		stubActivity({ success: true, log });
		const onDevice = await opsOnDeviceMaxRate(1);
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		const result = await onDevice("timeline.fit", { targetMs: 12500 }, context);
		expect(result.durationMs).toBe(12500);
		expect(getTimelineDurationMs(state.clips, 20000)).toBe(12500);
		expect(state.clips.every((c) => c.speed === 1)).toBe(true);
	});

	it("offers no speed-up at all for a clip already faster than the device", async () => {
		stubActivity({ success: true, log });
		const onDevice = await opsOnDeviceMaxRate(1);
		const { state, context } = makeContext([
			clip("a", 0, 10000, { speed: 2, sourceStartMs: 0 }),
		]);
		await expect(onDevice("timeline.fit", { targetMs: 2000 }, context)).rejects.toThrow(
			/remove at most 4400 ms, which is 3600 ms short/,
		);
		expect(state.writes).toBe(0);
	});

	it("counts a rate the device cannot play as capacity it does not have", async () => {
		stubActivity({ success: true, log });
		const onDevice = await opsOnDeviceMaxRate(1);
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await expect(onDevice("timeline.fit", { targetMs: 5000 }, context)).rejects.toThrow(
			/remove at most 8800 ms, which is 6200 ms short/,
		);
		expect(state.writes).toBe(0);
	});
});

describe("timeline.set_scene_duration", () => {
	it("shortens one scene to the requested length", async () => {
		stubActivity({ success: true, log });
		const { context } = makeContext([clip("a", 0, 20000)]);
		const result = await run("timeline.set_scene_duration", { index: 0, ms: 8000 }, context);
		expect(result.durationMs).toBe(16000);
		expect(result.sceneMs).toBe(8000);
	});

	it("gives a screen a shorter budget by shaving its reading hold", async () => {
		stubActivity({ success: true, log: compressedLog });
		const { state, context } = makeContext(compressedClips());
		const result = await run("timeline.set_scene_duration", { index: 0, ms: 4000 }, context);
		expect(result.levers).toEqual(["idle", "holds"]);
		expect(result.sceneMs).toBe(4000);
		expect(result.durationMs).toBe(11100);
		expect(atNormalSpeed(state.clips)).toEqual([
			[0, 2000],
			[7300, 13200],
			[15300, 18200],
		]);
	});

	it("refuses a scene with no idle time to give and a bad index", async () => {
		stubActivity({ success: true, log });
		const { state, context } = makeContext([clip("a", 0, 20000)]);
		await expect(
			run("timeline.set_scene_duration", { index: 1, ms: 5000 }, context),
		).rejects.toThrow(/short/);
		await expect(
			run("timeline.set_scene_duration", { index: 9, ms: 5000 }, context),
		).rejects.toThrow(/index must be a whole number/);
		await expect(
			run("timeline.set_scene_duration", { index: 0, ms: 13000 }, context),
		).rejects.toThrow(/only be shortened/);
		expect(state.writes).toBe(0);
	});

	describe("timeline.join", () => {
		const media = {
			path: "/media/joined.mp4",
			url: "recordly://joined",
			sourceStartMs: 20_000,
			durationMs: 5_000,
		};

		const api = (over: Record<string, unknown> = {}) => {
			const electronAPI = {
				importRecording: vi.fn(async () => ({ success: true, value: media })),
				finishRecordingImport: vi.fn(async () => ({ success: true })),
				...over,
			} as {
				importRecording: ReturnType<typeof vi.fn>;
				finishRecordingImport: ReturnType<typeof vi.fn>;
			};
			vi.stubGlobal("window", { electronAPI });
			return electronAPI;
		};

		const run = (payload: Record<string, unknown>, context: EditorOpContext) =>
			timelineOps["timeline.join"](payload, context) as Promise<Record<string, unknown>>;

		it("lays the joined recording after the existing clips and commits the media", async () => {
			const { finishRecordingImport } = api();
			const { state, context } = makeContext([clip("a", 0, 6000)]);
			const result = await run({ path: "/videos/second.mp4" }, context);
			expect(state.clips.map((c) => c.id)).toEqual(["a", "clip-1"]);
			expect(state.clips[1]).toMatchObject({ startMs: 6000, endMs: 11_000 });
			expect(result.joined).toMatchObject({ path: "/videos/second.mp4", durationMs: 5_000 });
			expect(finishRecordingImport.mock.calls).toEqual([
				["/media/joined.mp4"],
				["/media/joined.mp4", true],
			]);
		});

		it("switches playback to the combined file, or the joined clip plays nothing", async () => {
			api();
			const adopted: { path: string; url: string }[] = [];
			const { state, context } = makeContext([clip("a", 0, 6000)]);
			const withAdopt = {
				...context,
				adoptJoinedMedia: (m: { path: string; url: string }) => adopted.push(m),
			} as unknown as EditorOpContext;
			await run({ path: "/videos/second.mp4" }, withAdopt);
			expect(adopted).toEqual([{ path: "/media/joined.mp4", url: "recordly://joined" }]);
			expect(state.clips[1]).toMatchObject({ sourceStartMs: 20_000 });
		});

		it("refuses when the combined media could not be kept", async () => {
			api({
				finishRecordingImport: vi.fn(async (_path: string, commit?: boolean) =>
					commit === true ? { success: false, error: "disk full" } : { success: true },
				),
			});
			const { state, context } = makeContext([clip("a", 0, 6000)]);
			await expect(run({ path: "/videos/second.mp4" }, context)).rejects.toThrow(/disk full/);
			expect(state.clips.map((c) => c.id)).toEqual(["a"]);
		});

		it("releases the imported media when finalizing fails, and changes nothing", async () => {
			const { finishRecordingImport } = api({
				finishRecordingImport: vi.fn(async (_path: string, commit?: boolean) =>
					commit === undefined
						? { success: false, error: "disk full" }
						: { success: true },
				),
			});
			const { state, context } = makeContext([clip("a", 0, 6000)]);
			await expect(run({ path: "/videos/second.mp4" }, context)).rejects.toThrow(/disk full/);
			expect(state.clips.map((c) => c.id)).toEqual(["a"]);
			expect(finishRecordingImport).toHaveBeenCalledWith("/media/joined.mp4", false);
		});

		it("releases the imported media when the editor moved on mid-import", async () => {
			const { finishRecordingImport } = api();
			const { state, context } = makeContext([clip("a", 0, 6000)]);
			const moved = {
				...context,
				assertSameRecording: () => {
					throw new Error(
						"The editor loaded a different recording while this was running.",
					);
				},
			} as unknown as EditorOpContext;
			await expect(run({ path: "/videos/second.mp4" }, moved)).rejects.toThrow(
				/different recording/,
			);
			expect(state.clips.map((c) => c.id)).toEqual(["a"]);
			expect(finishRecordingImport).toHaveBeenCalledWith("/media/joined.mp4", false);
		});

		it.each([
			["a missing path", {}, /path must be the absolute path/],
			["an empty path", { path: "  " }, /path must be the absolute path/],
			["the recording already loaded", { path: "/tmp/a.mp4" }, /already loaded/],
			["an unknown field", { path: "/videos/b.mp4", at: 1 }, /unknown field at/],
			["an index past the end", { path: "/videos/b.mp4", index: 9 }, /index/],
		])("refuses %s without importing anything", async (_label, payload, message) => {
			const { importRecording } = api();
			const { state, context } = makeContext([clip("a", 0, 6000)]);
			await expect(run(payload as Record<string, unknown>, context)).rejects.toThrow(message);
			expect(importRecording).not.toHaveBeenCalled();
			expect(state.clips.map((c) => c.id)).toEqual(["a"]);
		});

		it("reports why the recording could not be added", async () => {
			api({
				importRecording: vi.fn(async () => ({ success: false, error: "not in Videos" })),
			});
			const { state, context } = makeContext([clip("a", 0, 6000)]);
			await expect(run({ path: "/videos/gone.mp4" }, context)).rejects.toThrow(
				/not in Videos/,
			);
			expect(state.clips.map((c) => c.id)).toEqual(["a"]);
		});
	});
});

describe("timeline.freeze", () => {
	const freeze = (payload: unknown, context: EditorOpContext) =>
		timelineOps["timeline.freeze"](payload, context) as Result & { frozenSourceMs: number };

	it("holds the frame inside a cut and pushes the rest of the edit later", () => {
		const { state, context } = makeContext([clip("a", 0, 20000, { sourceStartMs: 0 })]);
		const result = freeze({ atMs: 8000, ms: 2000 }, context);
		expect(result.durationMs).toBe(22000);
		expect(state.clips.map((c) => [c.startMs, c.endMs])).toEqual([
			[0, 8000],
			[8000, 10000],
			[10000, 22000],
		]);
		expect(state.clips[1].muted).toBe(true);
		expect(getClipSourceStartMs(state.clips[1])).toBe(7999);
		expect(getClipSourceEndMs(state.clips[1])).toBe(8000);
		expect(getClipSourceStartMs(state.clips[2])).toBe(8000);
		expect(state.zooms).toEqual([{ id: "z", startMs: 17000, endMs: 18000 }]);
		expect(state.audios).toEqual([{ id: "u", startMs: 17000, endMs: 20000 }]);
		expect(state.captions).toEqual([
			{ id: "c", startMs: 17000, endMs: 18000, words: [{ startMs: 17000, endMs: 18000 }] },
		]);
	});

	it("holds the last frame at the exact end from inside the decoded footage", () => {
		const { state, context } = makeContext([clip("a", 0, 20000, { sourceStartMs: 0 })]);
		const result = freeze({ atMs: 20000, ms: 3000 }, context);
		expect(result.durationMs).toBe(23000);
		expect(result.frozenSourceMs).toBe(19949);
		expect(getClipSourceEndMs(state.clips[1])).toBe(19950);
		expect(state.clips.map((c) => [c.startMs, c.endMs])).toEqual([
			[0, 20000],
			[20000, 23000],
		]);
	});

	it("holds the first frame at 0 ms", () => {
		const { state, context } = makeContext([clip("a", 0, 20000, { sourceStartMs: 0 })]);
		freeze({ atMs: 0, ms: 500 }, context);
		expect(state.clips.map((c) => [c.startMs, c.endMs])).toEqual([
			[0, 500],
			[500, 20500],
		]);
		expect(getClipSourceStartMs(state.clips[0])).toBe(0);
	});

	it("holds the frame the viewer is on inside a speed region", () => {
		const { state, context } = makeContext([
			clip("a", 0, 4000, { sourceStartMs: 0, speed: 2 }),
			clip("b", 4000, 8000, { sourceStartMs: 8000, speed: 1 }),
		]);
		freeze({ atMs: 2000, ms: 1000 }, context);
		expect(getClipSourceStartMs(state.clips[1])).toBe(3999);
		expect(state.clips[1].speed).toBe(0.001);
		expect(state.clips.map((c) => [c.startMs, c.endMs])).toEqual([
			[0, 2000],
			[2000, 3000],
			[3000, 5000],
			[5000, 9000],
		]);
	});

	it("stacks a freeze on a freeze", () => {
		const { state, context } = makeContext([clip("a", 0, 20000, { sourceStartMs: 0 })]);
		freeze({ atMs: 20000, ms: 1000 }, context);
		const second = freeze({ atMs: 21000, ms: 1000 }, context);
		expect(second.durationMs).toBe(22000);
		expect(state.clips).toHaveLength(3);
	});

	it.each([
		["ms of 0", { atMs: 1000, ms: 0 }, /ms must be a whole number of milliseconds from 1/],
		["negative ms", { atMs: 1000, ms: -500 }, /ms must be a whole number of milliseconds/],
		["absurd ms", { atMs: 1000, ms: 86_400_000 }, /from 1 to 600000/],
		["fractional ms", { atMs: 1000, ms: 12.5 }, /whole number of milliseconds/],
		["missing ms", { atMs: 1000 }, /ms must be a number/],
		["atMs past the edit", { atMs: 999_999, ms: 500 }, /outside the edit/],
		["negative atMs", { atMs: -1, ms: 500 }, /outside the edit/],
		["an unknown field", { atMs: 0, ms: 500, hold: 1 }, /unknown field hold/],
	])("refuses %s and changes nothing", (_label, payload, message) => {
		const { state, context } = makeContext([clip("a", 0, 20000, { sourceStartMs: 0 })]);
		expect(() => freeze(payload, context)).toThrow(message);
		expect(state.clips).toHaveLength(1);
		expect(state.writes).toBe(0);
		expect(state.zooms).toEqual([{ id: "z", startMs: 15000, endMs: 16000 }]);
	});

	it("refuses a freeze before the recording has loaded", () => {
		const { context } = makeContext([]);
		expect(() => freeze({ atMs: 0, ms: 500 }, context)).toThrow(/no clips yet/);
	});
});
