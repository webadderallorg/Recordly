import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import { useAudioPreviewSync } from "./useAudioPreviewSync";

const hooks = vi.hoisted(() => ({
	refs: [] as Array<{ current: unknown }>,
	index: 0,
	effects: [] as Array<() => unknown>,
}));
vi.mock("react", () => ({
	useMemo: (fn: () => unknown) => fn(),
	useCallback: (fn: unknown) => fn,
	useRef: (current: unknown) => {
		const index = hooks.index++;
		hooks.refs[index] ??= { current };
		return hooks.refs[index];
	},
	useEffect: (fn: () => unknown) => {
		hooks.effects.push(fn);
	},
}));
vi.mock("@/lib/exporter/localMediaSource", () => ({ resolveMediaElementSource: vi.fn() }));

class PreviewAudio {
	currentTime = 0;
	duration = 10;
	paused = true;
	src = "";
	dataset = {};
	play = vi.fn(async () => {
		this.paused = false;
	});
	load() {}
	pause() {
		this.paused = true;
	}
}
const elements: PreviewAudio[] = [];
const audioPath = "/recording.mic.m4a";
type Params = Parameters<typeof useAudioPreviewSync>[0];
function render(overrides: Partial<Params> = {}) {
	hooks.index = 0;
	hooks.effects = [];
	const result = useAudioPreviewSync({
		audioRegions: [],
		previewVolume: 1,
		isPlaying: false,
		currentTime: 3,
		timelineTime: 3,
		duration: 10,
		effectiveSpeedRegions: [],
		previewSourceAudioFallbackPaths: [audioPath],
		sourceAudioFallbackStartDelayMsByPath: {},
		sourceAudioResourceVersion: 0,
		isCurrentClipMuted: false,
		getSourceTrackPreviewGain: () => 1,
		onSourceFallbackLoadError: vi.fn(),
		...overrides,
	});
	for (const effect of hooks.effects) effect();
	return result;
}
async function flushLoads() {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
	hooks.refs = [];
	elements.length = 0;
	vi.mocked(resolveMediaElementSource).mockImplementation(async (src) => ({
		src,
		revoke: () => {},
	}));
	vi.stubGlobal(
		"Audio",
		class extends PreviewAudio {
			constructor() {
				super();
				elements.push(this);
			}
		},
	);
	vi.stubGlobal(
		"AudioContext",
		class {
			state = "running";
			destination = {};
			createGain() {
				return { gain: { value: 1 }, connect() {} };
			}
		},
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("companion preview timing", () => {
	it.each([
		{ suffix: "mic", delay: 1250, expected: 1.75 },
		{ suffix: "system", delay: 1250, expected: 1.75 },
		{ suffix: "mic", delay: 0, expected: 3 },
		{ suffix: "mic", delay: undefined, expected: 3 },
		{ suffix: "mic", delay: -100, expected: 3 },
		{ suffix: "mic", delay: 4000, expected: 0 },
	])("seeks $suffix with recorded delay $delay ms", async ({ suffix, delay, expected }) => {
		const path = `/recording.${suffix}.m4a`;
		render({
			previewSourceAudioFallbackPaths: [path],
			sourceAudioFallbackStartDelayMsByPath: delay === undefined ? {} : { [path]: delay },
		});
		await flushLoads();
		expect(elements).toHaveLength(1);
		expect(elements[0].currentTime).toBe(expected);
	});

	it.each([
		false,
		true,
	])("waits for the recorded start time (initially playing: %s)", async (initiallyPlaying) => {
		const timing = { [audioPath]: 2000 };
		const controls = render({
			isPlaying: initiallyPlaying,
			currentTime: 1,
			sourceAudioFallbackStartDelayMsByPath: timing,
		});
		await flushLoads();
		controls.playSourceAudioPreview();
		expect(elements[0].play).not.toHaveBeenCalled();
		render({ isPlaying: true, currentTime: 1, sourceAudioFallbackStartDelayMsByPath: timing });
		await flushLoads();
		expect(elements[0].paused).toBe(true);
		expect(elements[0].play).not.toHaveBeenCalled();
		render({
			isPlaying: true,
			currentTime: 2.1,
			sourceAudioFallbackStartDelayMsByPath: timing,
		});
		await flushLoads();
		expect(elements[0].paused).toBe(false);
		expect(elements[0].currentTime).toBeCloseTo(0.1);
	});

	it("does not play a late resource after playback has paused", async () => {
		let resolve!: (value: { src: string; revoke: () => void }) => void;
		vi.mocked(resolveMediaElementSource).mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		render({ isPlaying: true });
		render({ isPlaying: false });
		resolve({ src: audioPath, revoke: () => {} });
		await flushLoads();
		expect(elements[0].paused).toBe(true);
		expect(elements[0].play).not.toHaveBeenCalled();
	});

	it("does not restart audio when a pending context resume finishes after pausing", async () => {
		let resume!: () => void;
		const pending = new Promise<void>((done) => {
			resume = done;
		});
		vi.stubGlobal(
			"AudioContext",
			class {
				state = "suspended";
				destination = {};
				resume() {
					return pending;
				}
				createGain() {
					return { gain: { value: 1 }, connect() {} };
				}
			},
		);
		render({ isPlaying: true });
		await flushLoads();
		render({ isPlaying: false });
		const callsBeforeResume = elements[0].play.mock.calls.length;
		resume();
		await flushLoads();
		expect(elements[0].paused).toBe(true);
		expect(elements[0].play).toHaveBeenCalledTimes(callsBeforeResume);
	});

	it("does not start an ended companion from the playback button", async () => {
		const controls = render({ currentTime: 10 });
		await flushLoads();
		controls.playSourceAudioPreview();
		render({ isPlaying: true, currentTime: 10 });
		await flushLoads();
		expect(elements[0].paused).toBe(true);
		expect(elements[0].play).not.toHaveBeenCalled();
	});
});
