import { afterEach, describe, expect, it, vi } from "vitest";
import { useAudioPreviewSync } from "./useAudioPreviewSync";

const harness = vi.hoisted(() => ({
	effects: [] as (() => void | (() => void))[],
	refs: [] as { current: unknown }[],
	index: 0,
	loaded: vi.fn(),
}));
vi.mock("react", () => ({
	useCallback: (callback: unknown) => callback,
	useMemo: (factory: () => unknown) => factory(),
	useEffect: (effect: () => void) => harness.effects.push(effect),
	useRef: (value: unknown) => {
		const index = harness.index++;
		harness.refs[index] ??= { current: value };
		return harness.refs[index];
	},
	useState: () => [0, harness.loaded],
}));
vi.mock("@/lib/exporter/localMediaSource", () => ({
	resolveMediaElementSource: async () => ({ src: "file:///audio.wav", revoke: vi.fn() }),
}));
vi.mock("../videoPlayback/playbackRate", () => ({
	supportsPreviewPlaybackRate: (rate: number) => rate <= 16,
}));

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	harness.effects = [];
	harness.refs = [];
	harness.index = 0;
	harness.loaded.mockClear();
});

it("does not repeatedly seek healthy fast playback after delayed renders", async () => {
	let wallTimeMs = 0;
	vi.spyOn(performance, "now").mockImplementation(() => wallTimeMs);
	let position = 0;
	const seeks: number[] = [];
	const audio = {
		src: "",
		dataset: {},
		duration: 30,
		playbackRate: 1,
		paused: false,
		seeking: false,
		volume: 1,
		get currentTime() {
			return position;
		},
		set currentTime(time: number) {
			position = time;
			seeks.push(time);
		},
		load: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		pause: vi.fn(),
		play: vi.fn().mockResolvedValue(undefined),
	};
	vi.stubGlobal("Audio", function () {
		return audio;
	});
	vi.stubGlobal(
		"AudioContext",
		class {
			state = "running";
			destination = {};
			createGain() {
				return { gain: { value: 1 }, connect: vi.fn() };
			}
		},
	);
	const render = (timelineTime: number, sourceTime = timelineTime * 4) => {
		harness.index = 0;
		harness.effects = [];
		// biome-ignore lint/correctness/useHookAtTopLevel: the mocked React harness explicitly simulates successive renders.
		useAudioPreviewSync({
			audioRegions: [],
			previewVolume: 1,
			isPlaying: true,
			currentTime: sourceTime,
			timelineTime,
			duration: 30,
			sourcePlaybackRate: 4,
			previewSourceAudioFallbackPaths: ["/audio.system.wav"],
			sourceAudioFallbackStartDelayMsByPath: { "/audio.system.wav": 0 },
			sourceAudioResourceVersion: 0,
			isCurrentClipMuted: false,
			getSourceTrackPreviewGain: () => 1,
			onSourceFallbackLoadError: vi.fn(),
		});
	};
	render(0);
	for (const effect of harness.effects) effect();
	await Promise.resolve();
	harness.effects.at(-1)?.();
	await Promise.resolve();
	seeks.length = 0;
	for (const time of [0.3, 0.6, 0.9]) {
		wallTimeMs = time * 1000;
		position = time * 4 - 0.05;
		render(time);
		harness.effects.at(-1)?.();
	}
	expect(seeks).toEqual([]);
	// An actual source discontinuity at a cut still aligns the audio promptly.
	wallTimeMs += 30;
	render(0.93, 8);
	harness.effects.at(-1)?.();
	expect(seeks).toEqual([8]);
});

describe("source preview playback ownership", () => {
	it.each([
		{
			name: "sub-second offset",
			muted: false,
			playing: true,
			rate: 1,
			time: 0.5,
			delay: 0,
			plays: true,
		},
		{
			name: "playing clip",
			muted: false,
			playing: true,
			rate: 1,
			time: 1,
			delay: 0,
			plays: true,
		},
		{
			name: "gap or muted clip",
			muted: true,
			playing: true,
			rate: 1,
			time: 1,
			delay: 0,
			plays: false,
		},
		{
			name: "paused clip",
			muted: false,
			playing: false,
			rate: 1,
			time: 1,
			delay: 0,
			plays: false,
		},
		{
			name: "unsupported rate",
			muted: false,
			playing: true,
			rate: 20,
			time: 1,
			delay: 0,
			plays: false,
		},
		{
			name: "before audio start",
			muted: false,
			playing: true,
			rate: 1,
			time: 0,
			delay: 1000,
			plays: false,
		},
		{
			name: "media end",
			muted: false,
			playing: true,
			rate: 1,
			time: 10,
			delay: 0,
			plays: false,
		},
		{
			name: "microphone before its recorded start",
			path: "/audio.mic.wav",
			muted: false,
			playing: true,
			rate: 1,
			time: 0.5,
			delay: 1500,
			plays: false,
		},
		{
			name: "microphone after its recorded start",
			path: "/audio.mic.wav",
			muted: false,
			playing: true,
			rate: 1,
			time: 3,
			delay: 1500,
			plays: true,
		},
		{
			name: "track starting beyond the visible recording",
			muted: false,
			playing: true,
			rate: 1,
			time: 5,
			delay: 12000,
			plays: false,
		},
	])("checks $name after a late source load", async ({
		path = "/audio.system.wav",
		muted,
		playing,
		rate,
		time,
		delay,
		plays,
	}) => {
		const audio = {
			src: "",
			dataset: {},
			duration: 10,
			currentTime: 0,
			playbackRate: 1,
			paused: true,
			volume: 1,
			load: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			pause: vi.fn(),
			play: vi.fn().mockResolvedValue(undefined),
		};
		vi.stubGlobal("Audio", function () {
			return audio;
		});
		vi.stubGlobal(
			"AudioContext",
			class {
				state = "running";
				destination = {};
				createGain() {
					return { gain: { value: 1 }, connect: vi.fn() };
				}
			},
		);
		// Execute mocked effects explicitly so the asynchronous load can finish between syncs.
		useAudioPreviewSync({
			audioRegions: [],
			previewVolume: 1,
			isPlaying: playing,
			currentTime: time,
			timelineTime: time,
			duration: 10,
			sourcePlaybackRate: rate,
			previewSourceAudioFallbackPaths: [path],
			sourceAudioFallbackStartDelayMsByPath: { [path]: delay },
			sourceAudioResourceVersion: 0,
			isCurrentClipMuted: muted,
			getSourceTrackPreviewGain: () => 1,
			onSourceFallbackLoadError: vi.fn(),
		});
		for (const effect of harness.effects) effect();
		await Promise.resolve();
		expect(harness.loaded).toHaveBeenCalledOnce();
		expect(audio.play).not.toHaveBeenCalled();
		harness.effects.at(-1)?.();
		await Promise.resolve();
		expect(audio.play).toHaveBeenCalledTimes(plays ? 1 : 0);
		if (plays) expect(audio.currentTime).toBeCloseTo(time - delay / 1000);
	});
});

describe("source preview seek completion", () => {
	class SeekingAudio extends EventTarget {
		src = "";
		dataset = {};
		duration = 10;
		playbackRate = 1;
		paused = true;
		seeking = false;
		volume = 1;
		position = 0;
		load = vi.fn();
		pause = vi.fn(() => {
			this.paused = true;
		});
		play = vi.fn(async () => {
			this.paused = false;
		});
		get currentTime() {
			return this.position;
		}
		set currentTime(time: number) {
			this.position = time;
			this.seeking = true;
		}
		finishSeek() {
			this.seeking = false;
			this.dispatchEvent(new Event("seeked"));
		}
	}

	function setup() {
		const audio = new SeekingAudio();
		vi.stubGlobal("Audio", function () {
			return audio;
		});
		vi.stubGlobal(
			"AudioContext",
			class {
				state = "running";
				destination = {};
				createGain() {
					return { gain: { value: 1 }, connect: vi.fn() };
				}
			},
		);
		const render = (playing = true, muted = false) => {
			harness.index = 0;
			harness.effects = [];
			useAudioPreviewSync({
				audioRegions: [],
				previewVolume: 1,
				isPlaying: playing,
				currentTime: 2,
				timelineTime: 2,
				duration: 10,
				sourcePlaybackRate: 1,
				previewSourceAudioFallbackPaths: ["/audio.system.wav"],
				sourceAudioFallbackStartDelayMsByPath: { "/audio.system.wav": 0 },
				sourceAudioResourceVersion: 0,
				isCurrentClipMuted: muted,
				getSourceTrackPreviewGain: () => 1,
				onSourceFallbackLoadError: vi.fn(),
			});
		};
		return { audio, render };
	}

	it("waits for native seeking to finish and resumes without another timeline update", async () => {
		const { audio, render } = setup();
		render();
		for (const effect of harness.effects) effect();
		await Promise.resolve();
		const cleanup = harness.effects.at(-1)?.();
		await Promise.resolve();
		expect(audio.seeking).toBe(true);
		expect(audio.play).not.toHaveBeenCalled();
		audio.finishSeek();
		await Promise.resolve();
		expect(audio.play).toHaveBeenCalledOnce();
		// Later seeked notifications must not restart an already-running track.
		audio.finishSeek();
		await Promise.resolve();
		expect(audio.play).toHaveBeenCalledOnce();
		cleanup?.();
	});

	it("pauses a playing source before seeking and restarts after seek completion", async () => {
		const { audio, render } = setup();
		render();
		for (const effect of harness.effects) effect();
		await Promise.resolve();
		audio.paused = false;
		audio.pause.mockClear();
		const cleanup = harness.effects.at(-1)?.();
		await Promise.resolve();
		expect(audio.pause).toHaveBeenCalledOnce();
		expect(audio.paused).toBe(true);
		expect(audio.play).not.toHaveBeenCalled();
		audio.finishSeek();
		await Promise.resolve();
		expect(audio.play).toHaveBeenCalledOnce();
		cleanup?.();
	});

	it.each([
		"pause",
		"mute",
		"unmount",
	])("does not resume abandoned seeking after %s", async (transition) => {
		const { audio, render } = setup();
		render();
		for (const effect of harness.effects) effect();
		await Promise.resolve();
		const cleanup = harness.effects.at(-1)?.();
		await Promise.resolve();
		expect(audio.seeking).toBe(true);
		cleanup?.();
		if (transition !== "unmount") {
			render(transition !== "pause", transition === "mute");
			harness.effects.at(-1)?.();
		}
		audio.finishSeek();
		await Promise.resolve();
		expect(audio.play).not.toHaveBeenCalled();
	});
});
