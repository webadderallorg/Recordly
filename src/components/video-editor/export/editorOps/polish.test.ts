import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentActivityLog } from "../../agentEdits/planAgentEdits";
import { type CaptionCue, DEFAULT_AUTO_CAPTION_SETTINGS } from "../../types";
import { captionsOps } from "./captions";
import { lookOps } from "./look";
import { POLISH_UNDO_NOTE, polishOps } from "./polish";
import { timelineOps } from "./timeline";
import type { EditorOpContext } from "./types";

const log: AgentActivityLog = {
	version: 1,
	scenes: [
		{ startMs: 0, endMs: 12000, failed: false, title: "Open payroll" },
		{ startMs: 12000, endMs: 20000, failed: false, title: "Pay the run" },
	],
	spans: [
		{ kind: "motion", action: "click", startMs: 0, endMs: 1000 },
		{ kind: "wait", action: "wait", startMs: 2000, endMs: 12000 },
		{ kind: "motion", action: "click", startMs: 12000, endMs: 13000 },
	],
};

type Over = {
	clips?: unknown[];
	zooms?: unknown[];
	cues?: CaptionCue[];
	path?: string | null;
	duration?: number;
};

function makeContext(over: Over = {}) {
	const state = {
		clips: over.clips ?? [{ id: "clip-0", startMs: 0, endMs: 20000, speed: 1 }],
		zooms: over.zooms ?? [],
		cues: over.cues ?? [],
		settings: { ...DEFAULT_AUTO_CAPTION_SETTINGS },
		look: {
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			padding: { top: 0, bottom: 0, left: 0, right: 0, linked: true },
			borderRadius: 0,
			shadowIntensity: 0,
			backgroundBlur: 0,
			wallpaper: "#000",
			webcam: { enabled: false },
		} as Record<string, unknown>,
	};
	const apply = (current: unknown, next: unknown) =>
		typeof next === "function" ? (next as (v: unknown) => unknown)(current) : next;
	const appearance = new Proxy(state.look, {
		get: (target, key: string) =>
			key.startsWith("set")
				? (value: unknown) => {
						target[key[3].toLowerCase() + key.slice(4)] = value;
					}
				: target[key],
	});
	const context = {
		duration: over.duration ?? 20,
		videoSourcePath: over.path === undefined ? "/tmp/a.mp4" : over.path,
		timeline: {
			get clipRegions() {
				return state.clips;
			},
			get zoomRegions() {
				return state.zooms;
			},
			speedRegions: [],
			annotationRegions: [],
			audioRegions: [],
			selectedClipId: null,
			get autoCaptions() {
				return state.cues;
			},
			setClipRegions: (n: unknown) => {
				state.clips = apply(state.clips, n) as never;
			},
			setZoomRegions: (n: unknown) => {
				state.zooms = apply(state.zooms, n) as never;
			},
			setAnnotationRegions: () => undefined,
			setAudioRegions: () => undefined,
			setSelectedClipId: () => undefined,
			setAutoCaptions: (n: unknown) => {
				state.cues = apply(state.cues, n) as never;
			},
			setAutoCaptionSettings: (n: unknown) => {
				state.settings = apply(state.settings, n) as never;
			},
			setSelectedCaptionId: () => undefined,
		},
		appearance,
		history: { undo: () => undefined, redo: () => undefined },
		ids: { clip: { current: 1 }, zoom: { current: 1 } },
		assertSameRecording: () => undefined,
		adoptJoinedMedia: () => undefined,
	} as unknown as EditorOpContext;
	return { state, context };
}

function stubLog(value: AgentActivityLog | null) {
	vi.stubGlobal("document", { createElement: () => ({ set playbackRate(_: number) {} }) });
	vi.stubGlobal("window", {
		electronAPI: {
			getAgentActivity: vi.fn(async () =>
				value ? { success: true, log: value } : { success: false, message: "No log." },
			),
		},
	});
}

type Reply = {
	ok: boolean;
	steps: { step: string; status: string; detail: string }[];
	note: string;
};
const polish = (payload: unknown, context: EditorOpContext) =>
	polishOps.polish_recording(payload, context) as Promise<Reply>;
const statusOf = (reply: Reply, step: string) => reply.steps.find((s) => s.step === step)?.status;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("polish_recording", () => {
	it("speeds idle, captions from scene titles and sets the look, reporting each step", async () => {
		stubLog(log);
		const { state, context } = makeContext();
		const reply = await polish({}, context);
		expect(reply.steps.filter((s) => s.status === "failed")).toEqual([]);
		expect(reply.ok).toBe(true);
		expect(statusOf(reply, "cuts_and_zooms")).toBe("skipped");
		expect(statusOf(reply, "idle_speedup")).toBe("applied");
		expect(statusOf(reply, "captions")).toBe("applied");
		expect(statusOf(reply, "look")).toBe("applied");
		expect(state.clips.some((c) => (c as { speed: number }).speed > 1)).toBe(true);
		expect(state.cues.map((c) => c.text)).toEqual(["Open payroll", "Pay the run"]);
		expect(state.look.borderRadius).toBe(12);
		expect(reply.note).toBe(POLISH_UNDO_NOTE);
	});

	it("is idempotent: a second run changes nothing", async () => {
		stubLog(log);
		const { state, context } = makeContext();
		await polish({}, context);
		const clips = JSON.stringify(state.clips);
		const cues = JSON.stringify(state.cues);
		const second = await polish({}, context);
		expect(JSON.stringify(state.clips)).toBe(clips);
		expect(JSON.stringify(state.cues)).toBe(cues);
		expect(second.steps.filter((s) => s.status === "applied")).toEqual([]);
		expect(statusOf(second, "look")).toBe("already_present");
	});

	it("does not redo or overwrite what the automatic edit already made", async () => {
		stubLog(log);
		const clips = [
			{ id: "a", startMs: 0, endMs: 5000, sourceStartMs: 0, speed: 1 },
			{ id: "b", startMs: 5000, endMs: 9000, sourceStartMs: 8000, speed: 4 },
		];
		const cues = [{ id: "c", startMs: 0, endMs: 900, text: "mine" }];
		const fit = vi.spyOn(timelineOps, "timeline.fit");
		const fitCaptions = vi.spyOn(captionsOps, "captions.fit_to_scenes");
		const { state, context } = makeContext({
			clips,
			cues,
			zooms: [{ id: "z", startMs: 0, endMs: 1000 }],
		});
		const reply = await polish({}, context);
		expect(statusOf(reply, "cuts_and_zooms")).toBe("already_present");
		expect(statusOf(reply, "idle_speedup")).toBe("already_present");
		expect(statusOf(reply, "captions")).toBe("already_present");
		expect(fit).not.toHaveBeenCalled();
		expect(fitCaptions).not.toHaveBeenCalled();
		expect(state.clips).toBe(clips);
		expect(state.cues).toBe(cues);
	});

	it("replaces existing captions only when captions: true is explicit", async () => {
		stubLog(log);
		const { state, context } = makeContext({
			cues: [{ id: "c", startMs: 0, endMs: 900, text: "mine" }],
		});
		await polish({ captions: true }, context);
		expect(state.cues.map((c) => c.text)).toEqual(["Open payroll", "Pay the run"]);
	});

	it("honours captions: false and an alternative style", async () => {
		stubLog(log);
		const { state, context } = makeContext();
		const reply = await polish({ style: "dark", captions: false }, context);
		expect(statusOf(reply, "captions")).toBe("skipped");
		expect(state.cues).toEqual([]);
		expect(state.look.wallpaper).toBe("/wallpapers/tahoe-dark.jpg");
	});

	it("refuses an unknown style or captions value, naming the valid ones, and changes nothing", async () => {
		stubLog(log);
		const { state, context } = makeContext();
		await expect(polish({ style: "neon" }, context)).rejects.toThrow(/clean, dark, none/);
		await expect(polish({ captions: "yes" }, context)).rejects.toThrow(/true or false/);
		await expect(polish({ extra: 1 }, context)).rejects.toThrow(/unknown field/);
		expect(state.look.borderRadius).toBe(0);
		expect(state.clips).toHaveLength(1);
	});

	it("refuses when no recording is loaded or the timeline has no length", async () => {
		stubLog(log);
		await expect(polish({}, makeContext({ path: null }).context)).rejects.toThrow(
			/no recording loaded/,
		);
		await expect(polish({}, makeContext({ clips: [] }).context)).rejects.toThrow(/empty/);
		await expect(
			polish(
				{},
				makeContext({ clips: [{ id: "z", startMs: 0, endMs: 0, speed: 1 }] }).context,
			),
		).rejects.toThrow(/empty/);
	});

	it("skips captions with a reason when the recording has no scenes, and still sets the look", async () => {
		stubLog({ ...log, scenes: [] });
		const { state, context } = makeContext();
		const reply = await polish({}, context);
		expect(reply.ok).toBe(true);
		expect(reply.steps.find((s) => s.step === "captions")?.detail).toMatch(/no scenes/);
		expect(statusOf(reply, "look")).toBe("applied");
		expect(state.cues).toEqual([]);
	});

	it("skips captions when every scene failed or a scene has no title", async () => {
		stubLog({ ...log, scenes: log.scenes.map((s) => ({ ...s, failed: true })) });
		let reply = await polish({}, makeContext().context);
		expect(reply.steps.find((s) => s.step === "captions")?.detail).toMatch(
			/Every scene failed/,
		);
		stubLog({ ...log, scenes: [{ ...log.scenes[0], title: undefined }, log.scenes[1]] });
		reply = await polish({}, makeContext().context);
		expect(reply.steps.find((s) => s.step === "captions")?.detail).toMatch(
			/1 of 2 scenes have no title/,
		);
	});

	it("degrades to the look alone for a recording nobody drove", async () => {
		stubLog(null);
		const { context } = makeContext();
		const reply = await polish({}, context);
		expect(statusOf(reply, "idle_speedup")).toBe("failed");
		expect(statusOf(reply, "captions")).toBe("failed");
		expect(statusOf(reply, "look")).toBe("applied");
		expect(reply.ok).toBe(false);
	});

	it("reports a single-clip timeline with no idle stretch as skipped, not applied", async () => {
		stubLog({ ...log, spans: [{ kind: "motion", action: "click", startMs: 0, endMs: 20000 }] });
		const reply = await polish({}, makeContext().context);
		expect(statusOf(reply, "idle_speedup")).toBe("skipped");
	});

	it("reports a caption step the op refuses (too many scenes) as failed and carries on", async () => {
		const scenes = Array.from({ length: 501 }, (_, i) => ({
			startMs: i * 10,
			endMs: i * 10 + 10,
			failed: false,
			title: `S${i}`,
		}));
		stubLog({ ...log, scenes });
		const { state, context } = makeContext({ duration: 100 });
		const reply = await polish({}, context);
		const captions = reply.steps.find((s) => s.step === "captions");
		expect(captions?.status).toBe("failed");
		expect(captions?.detail).toMatch(/most allowed/);
		expect(statusOf(reply, "look")).toBe("applied");
		expect(state.cues).toEqual([]);
	});

	it("says which steps were applied and not rolled back when a later one throws", async () => {
		stubLog(log);
		vi.spyOn(lookOps, "look.preset").mockImplementation(() => {
			throw new Error("boom");
		});
		const { state, context } = makeContext();
		const reply = await polish({}, context);
		expect(reply.ok).toBe(false);
		expect(statusOf(reply, "idle_speedup")).toBe("applied");
		expect(statusOf(reply, "captions")).toBe("applied");
		expect(statusOf(reply, "look")).toBe("failed");
		expect(reply.note).toMatch(/look failed/);
		expect(reply.note).toMatch(/NOT rolled back/);
		expect(state.cues).toHaveLength(2);
	});
});
