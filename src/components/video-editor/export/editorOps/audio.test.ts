import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioRegion } from "../../types";
import { audioOps } from "./audio";
import type { EditorOpContext } from "./types";

const getLocalMediaUrl = vi.hoisted(() => vi.fn());

type Clip = { id: string; startMs: number; endMs: number; speed: number; muted?: boolean };
type TrackSettings = Record<string, { volume: number; normalize: boolean }>;

function makeContext(
	options: {
		regions?: AudioRegion[];
		clips?: Clip[];
		tracks?: TrackSettings;
		durationSec?: number;
		captions?: { id: string; startMs: number; endMs: number; text: string }[];
		loading?: boolean;
	} = {},
) {
	const state = {
		regions: options.regions ?? [],
		clips: options.clips ?? [],
		defaults: options.tracks ?? { mic: { volume: 1, normalize: false } },
		byClip: {} as Record<string, TrackSettings>,
		selected: null as string | null,
	};
	const apply = <T>(current: T, next: unknown) =>
		typeof next === "function" ? (next as (value: T) => T)(current) : (next as T);
	const context = {
		duration: options.durationSec ?? 10,
		videoSourcePath: "/tmp/take.mp4",
		timeline: {
			get clipRegions() {
				return state.clips;
			},
			get audioRegions() {
				return state.regions;
			},
			get autoCaptions() {
				return options.captions ?? [];
			},
			sourceAudioLoading: options.loading ?? false,
			get selectedAudioId() {
				return state.selected;
			},
			get defaultSourceAudioTrackSettings() {
				return state.defaults;
			},
			setAudioRegions: (next: unknown) => {
				state.regions = apply(state.regions, next);
			},
			setSelectedAudioId: (id: string | null) => {
				state.selected = id;
			},
			setClipRegions: (next: unknown) => {
				state.clips = apply(state.clips, next);
			},
			setDefaultSourceAudioTrackSettings: (next: unknown) => {
				state.defaults = apply(state.defaults, next);
			},
			setSourceAudioTrackSettingsByClip: (next: unknown) => {
				state.byClip = apply(state.byClip, next);
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

const run = (op: string, payload: unknown, context: EditorOpContext) =>
	audioOps[op](payload, context) as never;

function stubAudio(durationSec: number | "error" | "never") {
	class FakeAudio {
		duration = durationSec === "error" || durationSec === "never" ? 0 : durationSec;
		private listeners: Record<string, () => void> = {};
		addEventListener(name: string, handler: () => void) {
			this.listeners[name] = handler;
		}
		removeAttribute() {}
		load() {}
		set src(_value: string) {
			if (durationSec === "never") return;
			queueMicrotask(() =>
				this.listeners[durationSec === "error" ? "error" : "loadedmetadata"]?.(),
			);
		}
	}
	vi.stubGlobal("Audio", FakeAudio);
}

const region = (over: Partial<AudioRegion> = {}): AudioRegion => ({
	id: "r1",
	startMs: 0,
	endMs: 2000,
	audioPath: "/a.mp3",
	volume: 1,
	trackIndex: 0,
	...over,
});

beforeEach(() => {
	getLocalMediaUrl.mockReset();
	getLocalMediaUrl.mockImplementation(async (path: string) => ({ success: true, url: path }));
	vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("audio.add", () => {
	it("adds a region at the start time, selects it and keeps the file's own length", async () => {
		stubAudio(3);
		const { state, context } = makeContext();
		const result = (await run(
			"audio.add",
			{ path: "/music/theme.mp3", startMs: 1000, volume: 0.4 },
			context,
		)) as {
			id: string;
			trimmed: boolean;
		};
		expect(state.regions).toEqual([
			expect.objectContaining({
				id: result.id,
				startMs: 1000,
				endMs: 4000,
				volume: 0.4,
				audioPath: "/music/theme.mp3",
				trackIndex: 0,
			}),
		]);
		expect(state.selected).toBe(result.id);
		expect(result.trimmed).toBe(false);
	});

	it("trims to durationMs and to the end of the recording, and says so", async () => {
		stubAudio(60);
		const { state, context } = makeContext();
		const result = (await run("audio.add", { path: "/a.wav", startMs: 8000 }, context)) as {
			trimmed: boolean;
		};
		expect([state.regions[0].startMs, state.regions[0].endMs, result.trimmed]).toEqual([
			8000,
			10000,
			true,
		]);
		const second = makeContext();
		await run("audio.add", { path: "/a.wav", durationMs: 1500 }, second.context);
		expect(second.state.regions[0].endMs).toBe(1500);
	});

	it("moves to a free track when the first is taken and refuses a taken explicit track", async () => {
		stubAudio(2);
		const { state, context } = makeContext({ regions: [region({ endMs: 5000 })] });
		await run("audio.add", { path: "/a.mp3", startMs: 1000 }, context);
		expect(state.regions[1].trackIndex).toBe(1);
		await expect(
			run("audio.add", { path: "/a.mp3", startMs: 1000, trackIndex: 0 }, context),
		).rejects.toThrow(/no room/);
		expect(state.regions).toHaveLength(2);
	});

	it.each([
		["a relative path", { path: "a.mp3" }, /absolute path/],
		["no path", {}, /absolute path/],
		["a video file", { path: "/a.mp4" }, /must be an audio file/],
		["a start past the end", { path: "/a.mp3", startMs: 10000 }, /startMs must be/],
		["a negative start", { path: "/a.mp3", startMs: -5 }, /startMs must be/],
		["a volume above 1", { path: "/a.mp3", volume: 1.5 }, /volume must be/],
		["a negative volume", { path: "/a.mp3", volume: -0.1 }, /volume must be/],
		["a zero duration", { path: "/a.mp3", durationMs: 0 }, /durationMs/],
		["a fractional track", { path: "/a.mp3", trackIndex: 0.5 }, /whole number/],
		[
			"a non-finite start",
			{ path: "/a.mp3", startMs: Number.POSITIVE_INFINITY },
			/must be a number/,
		],
	])("rejects %s before reading the file", async (_name, payload, message) => {
		const probe = vi.fn();
		vi.stubGlobal("Audio", probe);
		const { state, context } = makeContext();
		await expect(run("audio.add", payload, context)).rejects.toThrow(message);
		expect(probe).not.toHaveBeenCalled();
		expect(state.regions).toEqual([]);
	});

	it("says a file that will not decode is unreadable audio, not unreadable access", async () => {
		stubAudio("error");
		const { state, context } = makeContext();
		await expect(run("audio.add", { path: "/silent.wav" }, context)).rejects.toThrow(
			/was found but the editor could not decode it/,
		);
		expect(state.regions).toEqual([]);
	});

	it("says so, and never loads the player, when the file is not approved or served", async () => {
		const loaded = vi.fn();
		class Never {
			addEventListener() {}
			removeAttribute() {}
			load() {}
			set src(value: string) {
				loaded(value);
			}
		}
		vi.stubGlobal("Audio", Never);
		getLocalMediaUrl.mockResolvedValueOnce({ success: false });
		const { state, context } = makeContext();
		await expect(
			run("audio.add", { path: "/Users/me/Downloads/a.mp3" }, context),
		).rejects.toThrow(/not allowed to read \/Users\/me\/Downloads\/a.mp3.*Add audio control/);
		expect(loaded).not.toHaveBeenCalled();
		expect(state.regions).toEqual([]);
	});

	it("loads the served url rather than the raw path", async () => {
		const loaded = vi.fn();
		class Serving {
			private onMeta: () => void = () => undefined;
			duration = 2;
			addEventListener(name: string, handler: () => void) {
				if (name === "loadedmetadata") this.onMeta = handler;
			}
			removeAttribute() {}
			load() {}
			set src(value: string) {
				loaded(value);
				queueMicrotask(this.onMeta);
			}
		}
		vi.stubGlobal("Audio", Serving);
		getLocalMediaUrl.mockResolvedValueOnce({ success: true, url: "http://127.0.0.1:1/m?p=a" });
		await run("audio.add", { path: "/Users/me/a.mp3" }, makeContext().context);
		expect(getLocalMediaUrl).toHaveBeenCalledWith("/Users/me/a.mp3");
		expect(loaded).toHaveBeenCalledWith("http://127.0.0.1:1/m?p=a");
	});

	it("says so outside the Recordly app", async () => {
		stubAudio(3);
		vi.stubGlobal("window", {});
		await expect(run("audio.add", { path: "/a.mp3" }, makeContext().context)).rejects.toThrow(
			/inside the Recordly app/,
		);
	});

	it("gives up when the media server never answers, and when it fails", async () => {
		vi.useFakeTimers();
		stubAudio(3);
		getLocalMediaUrl.mockReturnValueOnce(new Promise(() => undefined));
		const first = makeContext();
		const pending = run("audio.add", { path: "/slow.mp3" }, first.context) as Promise<unknown>;
		const assertion = expect(pending).rejects.toThrow(/Timed out reading/);
		await vi.advanceTimersByTimeAsync(10_001);
		await assertion;
		expect(first.state.regions).toEqual([]);
		getLocalMediaUrl.mockRejectedValueOnce(new Error("media server down"));
		await expect(run("audio.add", { path: "/a.mp3" }, makeContext().context)).rejects.toThrow(
			/media server down/,
		);
	});

	it("releases the player after a failed read", async () => {
		const removeAttribute = vi.fn();
		class Failing {
			private onError: () => void = () => undefined;
			addEventListener(name: string, handler: () => void) {
				if (name === "error") this.onError = handler;
			}
			removeAttribute = removeAttribute;
			load() {}
			set src(_value: string) {
				queueMicrotask(this.onError);
			}
		}
		vi.stubGlobal("Audio", Failing);
		await expect(
			run("audio.add", { path: "/gone.mp3" }, makeContext().context),
		).rejects.toThrow(/could not decode/);
		expect(removeAttribute).toHaveBeenCalledWith("src");
	});

	it("says there is no recording when its length is unknown", async () => {
		stubAudio(3);
		await expect(
			run("audio.add", { path: "/a.mp3" }, makeContext({ durationSec: 0 }).context),
		).rejects.toThrow(/no recording loaded/);
	});

	it("never writes a region of no length from fractional times", async () => {
		stubAudio(3);
		const { state, context } = makeContext();
		await expect(
			run("audio.add", { path: "/a.mp3", startMs: 9999.6 }, context),
		).rejects.toThrow(/startMs must be/);
		await expect(
			run("audio.add", { path: "/a.mp3", durationMs: 0.4 }, context),
		).rejects.toThrow(/durationMs/);
		expect(state.regions).toEqual([]);
	});

	it("rejects a zero-length file", async () => {
		stubAudio(0);
		const { context } = makeContext();
		await expect(run("audio.add", { path: "/empty.mp3" }, context)).rejects.toThrow(
			/no playable audio/,
		);
	});

	it("gives up when reading the file never finishes", async () => {
		vi.useFakeTimers();
		stubAudio("never");
		const { state, context } = makeContext();
		const pending = run("audio.add", { path: "/slow.mp3" }, context) as Promise<unknown>;
		const assertion = expect(pending).rejects.toThrow(/Timed out reading/);
		await vi.advanceTimersByTimeAsync(10_001);
		await assertion;
		expect(state.regions).toEqual([]);
	});
});

describe("audio.remove and audio.volume", () => {
	it("removes a region and clears its selection", () => {
		const { state, context } = makeContext({ regions: [region(), region({ id: "r2" })] });
		state.selected = "r1";
		run("audio.remove", { id: "r1" }, context);
		expect(state.regions.map((value) => value.id)).toEqual(["r2"]);
		expect(state.selected).toBeNull();
	});

	it("sets the volume, including both ends of its range", () => {
		const { state, context } = makeContext({ regions: [region()] });
		run("audio.volume", { id: "r1", volume: 0 }, context);
		expect(state.regions[0].volume).toBe(0);
		run("audio.volume", { id: "r1", volume: 1 }, context);
		expect(state.regions[0].volume).toBe(1);
	});

	it.each([
		["audio.remove", { id: "zz" }, /no audio region/],
		["audio.volume", { id: "zz", volume: 0.5 }, /no audio region/],
		["audio.volume", { id: "r1", volume: 1.01 }, /volume must be/],
		["audio.volume", { id: "r1", volume: Number.NaN }, /must be a number/],
		["audio.volume", { volume: 0.5 }, /id must be/],
	])("%s rejects %j and changes nothing", (op, payload, message) => {
		const regions = [region()];
		const { state, context } = makeContext({ regions });
		expect(() => run(op, payload, context)).toThrow(message);
		expect(state.regions).toBe(regions);
	});
});

describe("audio.mute_source", () => {
	const clips = [
		{ id: "a", startMs: 0, endMs: 1000, speed: 1 },
		{ id: "b", startMs: 1000, endMs: 2000, speed: 1 },
	];

	it("mutes every clip, or just one, and unmutes", () => {
		const { state, context } = makeContext({ clips });
		run("audio.mute_source", { muted: true }, context);
		expect(state.clips.map((clip) => clip.muted)).toEqual([true, true]);
		run("audio.mute_source", { muted: false, clipId: "b" }, context);
		expect(state.clips.map((clip) => clip.muted)).toEqual([true, false]);
	});

	it("rejects a non-boolean, an unknown clip and a recording with no clips", () => {
		expect(() =>
			run("audio.mute_source", { muted: "yes" }, makeContext({ clips }).context),
		).toThrow(/true or false/);
		expect(() =>
			run("audio.mute_source", { muted: true, clipId: "zz" }, makeContext({ clips }).context),
		).toThrow(/no clip/);
		expect(() => run("audio.mute_source", { muted: true }, makeContext().context)).toThrow(
			/no clips yet/,
		);
	});
});

describe("audio.source_track", () => {
	it("sets volume for every clip and keeps the other field", () => {
		const { state, context } = makeContext({
			tracks: {
				mic: { volume: 1, normalize: true },
				system: { volume: 1, normalize: false },
			},
		});
		run("audio.source_track", { track: "mic", volume: 0.25 }, context);
		expect(state.defaults.mic).toEqual({ volume: 0.25, normalize: true });
		expect(state.defaults.system).toEqual({ volume: 1, normalize: false });
	});

	it("keeps the clip's own volume when only normalize changes", () => {
		const { state, context } = makeContext({
			clips: [{ id: "a", startMs: 0, endMs: 1, speed: 1 }],
		});
		run("audio.source_track", { track: "mic", volume: 0.3, clipId: "a" }, context);
		run("audio.source_track", { track: "mic", normalize: true, clipId: "a" }, context);
		expect(state.byClip.a.mic).toEqual({ volume: 0.3, normalize: true });
	});

	it("scopes a change to one clip", () => {
		const { state, context } = makeContext({
			clips: [{ id: "a", startMs: 0, endMs: 1, speed: 1 }],
		});
		run("audio.source_track", { track: "mic", normalize: true, clipId: "a" }, context);
		expect(state.byClip.a.mic).toEqual({ volume: 1, normalize: true });
		expect(state.defaults.mic.normalize).toBe(false);
	});

	it.each([
		[{ track: "nope", volume: 0.5 }, /no source track "nope"/],
		[{ track: "mic" }, /volume, normalize/],
		[{ track: "mic", volume: 2 }, /volume must be/],
		[{ track: "mic", normalize: "on" }, /true or false/],
		[{ track: "mic", volume: 0.5, clipId: "zz" }, /no clip/],
	])("rejects %j", (payload, message) => {
		const { state, context } = makeContext();
		const before = state.defaults;
		expect(() => run("audio.source_track", payload, context)).toThrow(message);
		expect(state.defaults).toBe(before);
	});

	it("says so when the tracks have not loaded", () => {
		expect(() =>
			run(
				"audio.source_track",
				{ track: "mic", volume: 1 },
				makeContext({ tracks: {} }).context,
			),
		).toThrow(/read sourceAudio\.status/);
	});

	it("says there is no recording when none is loaded", () => {
		const { context } = makeContext();
		(context as { videoSourcePath: string | null }).videoSourcePath = null;
		expect(() => run("audio.source_track", { track: "mic", volume: 1 }, context)).toThrow(
			/no recording loaded/,
		);
	});

	it("lists the clips when the clip id is unknown", () => {
		const { context } = makeContext({ clips: [{ id: "a", startMs: 0, endMs: 1, speed: 1 }] });
		expect(() =>
			run("audio.source_track", { track: "mic", volume: 1, clipId: "zz" }, context),
		).toThrow(/Clips: a\./);
		expect(() => run("audio.mute_source", { muted: true, clipId: "zz" }, context)).toThrow(
			/Clips: a\./,
		);
	});

	it("points at get_editor_state when there are no clips", () => {
		expect(() =>
			run("audio.mute_source", { muted: true }, makeContext({ clips: [] }).context),
		).toThrow(/get_editor_state/);
	});

	it("lists audio regions when the id is unknown", () => {
		expect(() => run("audio.remove", { id: "x" }, makeContext().context)).toThrow(
			/no audio regions; add one with audio\.add/,
		);
	});
});

const speech = [
	{ id: "c1", startMs: 1000, endMs: 2000, text: "a" },
	{ id: "c2", startMs: 2050, endMs: 3000, text: "b" },
];

describe("audio.fade", () => {
	const music = () => region({ id: "m", startMs: 0, endMs: 4000 });

	it("stores fade in and out on the region and keeps the one not given", async () => {
		const { state, context } = makeContext({ regions: [music()] });
		await run("audio.fade", { id: "m", inMs: 500 }, context);
		const result = await run("audio.fade", { id: "m", outMs: 1000 }, context);
		expect(state.regions[0]).toMatchObject({ fadeInMs: 500, fadeOutMs: 1000 });
		expect(result).toMatchObject({ overlapping: false });
	});

	it("accepts a fade exactly the region's length and 0 to clear", async () => {
		const { state, context } = makeContext({ regions: [music()] });
		await run("audio.fade", { id: "m", inMs: 4000 }, context);
		expect(state.regions[0]).toMatchObject({ fadeInMs: 4000 });
		await run("audio.fade", { id: "m", inMs: 0 }, context);
		expect(state.regions[0]).toMatchObject({ fadeInMs: 0 });
	});

	it("reports an in and out that overlap in a short region", async () => {
		const { context } = makeContext({ regions: [music()] });
		const result = await run("audio.fade", { id: "m", inMs: 3000, outMs: 3000 }, context);
		expect(result).toMatchObject({ overlapping: true });
	});

	it.each([
		["longer than the region", { id: "m", inMs: 4001 }, /only 4000 ms long/],
		["negative", { id: "m", outMs: -1 }, /0 or more/],
		["not a number", { id: "m", inMs: "x" }, /inMs/],
		["no durations", { id: "m" }, /inMs, outMs/],
		["a region that does not exist", { id: "zz", inMs: 10 }, /no audio region/],
	])("refuses a fade %s and changes nothing", async (_name, payload, message) => {
		const { state, context } = makeContext({ regions: [music()] });
		expect(() => run("audio.fade", payload, context)).toThrow(message);
		expect(state.regions[0]).not.toHaveProperty("fadeInMs");
	});

	it("explains that the recording's own track cannot be faded", async () => {
		const { context } = makeContext({
			regions: [music()],
			clips: [{ id: "clip1", startMs: 0, endMs: 10000, speed: 1 }],
		});
		expect(() => run("audio.fade", { id: "clip1", inMs: 10 }, context)).toThrow(
			/own sound cannot be faded/,
		);
	});
});

describe("audio.duck", () => {
	const music = (over: Partial<AudioRegion> = {}) =>
		region({ id: "m", startMs: 500, endMs: 6000, ...over });

	it("ducks over the given ranges, clipped to the region and merged when they touch", async () => {
		const { state, context } = makeContext({ regions: [music()] });
		await run(
			"audio.duck",
			{
				id: "m",
				level: 0.3,
				ranges: [
					{ startMs: 0, endMs: 1000 },
					{ startMs: 1050, endMs: 2000 },
					{ startMs: 9000, endMs: 9500 },
				],
			},
			context,
		);
		expect((state.regions[0] as never as { duck: unknown }).duck).toEqual({
			level: 0.3,
			ranges: [{ startMs: 500, endMs: 2000 }],
		});
	});

	it("ducks under captions, and only the named region", async () => {
		const other = region({ id: "o", startMs: 0, endMs: 6000, trackIndex: 1 });
		const { state, context } = makeContext({
			regions: [music(), other],
			captions: speech,
			clips: [{ id: "k", startMs: 0, endMs: 10000, speed: 1 }],
		});
		const result = (await run(
			"audio.duck",
			{ id: "m", level: 0, ranges: "captions" },
			context,
		)) as {
			ranges: unknown[];
		};
		expect(result.ranges).toEqual([{ startMs: 1000, endMs: 3000 }]);
		expect(state.regions[1]).not.toHaveProperty("duck");
	});

	it("accepts both bounds and level 1 removes the duck", async () => {
		const { state, context } = makeContext({ regions: [music()] });
		const ranges = [{ startMs: 1000, endMs: 2000 }];
		await run("audio.duck", { id: "m", level: 0, ranges }, context);
		expect((state.regions[0] as never as { duck: { level: number } }).duck.level).toBe(0);
		await run("audio.duck", { id: "m", level: 1, ranges: [] }, context);
		expect((state.regions[0] as never as { duck: unknown }).duck).toBeUndefined();
	});

	it.each([
		[
			"a level below 0",
			{ id: "m", level: -0.1, ranges: [{ startMs: 1, endMs: 2 }] },
			/level must be/,
		],
		[
			"a level above 1",
			{ id: "m", level: 1.1, ranges: [{ startMs: 1, endMs: 2 }] },
			/level must be/,
		],
		[
			"no music region",
			{ id: "nope", level: 0.5, ranges: [{ startMs: 1, endMs: 2 }] },
			/no audio region/,
		],
		["no captions found", { id: "m", level: 0.5, ranges: "captions" }, /no captions/],
		[
			"ranges outside the region",
			{ id: "m", level: 0.5, ranges: [{ startMs: 8000, endMs: 9000 }] },
			/nothing would be ducked/,
		],
		[
			"a reversed range",
			{ id: "m", level: 0.5, ranges: [{ startMs: 2000, endMs: 1000 }] },
			/startMs < endMs/,
		],
		["no ranges argument", { id: "m", level: 0.5 }, /ranges must be/],
	])("refuses %s and changes nothing", async (_name, payload, message) => {
		const { state, context } = makeContext({ regions: [music()] });
		expect(() => run("audio.duck", payload, context)).toThrow(message);
		expect(state.regions[0]).not.toHaveProperty("duck");
	});

	it("says when the recording's sound is loading or absent, and still applies the duck", async () => {
		const ranges = [{ startMs: 1000, endMs: 2000 }];
		const loading = makeContext({ regions: [music()], tracks: {}, loading: true });
		const a = (await run("audio.duck", { id: "m", level: 0.5, ranges }, loading.context)) as {
			note: string;
		};
		expect(a.note).toMatch(/still loading/);
		const none = makeContext({ regions: [music()], tracks: {} });
		const b = (await run("audio.duck", { id: "m", level: 0.5, ranges }, none.context)) as {
			note: string;
		};
		expect(b.note).toMatch(/no sound of its own/);
		expect(none.state.regions[0]).toHaveProperty("duck");
	});
});
