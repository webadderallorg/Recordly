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
	vi.unstubAllGlobals();
	harness.effects = [];
	harness.refs = [];
	harness.index = 0;
	harness.loaded.mockClear();
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
			name: "source seek pending",
			muted: false,
			playing: true,
			rate: 1,
			time: 1,
			delay: 0,
			seeking: true,
			wasPlaying: true,
			plays: false,
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
	])("checks $name after a late source load", async ({
		muted,
		playing,
		rate,
		time,
		delay,
		plays,
		seeking,
		wasPlaying,
	}) => {
		const audio = {
			src: "",
			dataset: {},
			duration: 10,
			currentTime: 0,
			playbackRate: 1,
			paused: true,
			seeking: seeking ?? false,
			volume: 1,
			load: vi.fn(),
			pause: vi.fn(() => {
				audio.paused = true;
			}),
			play: vi.fn().mockImplementation(() => {
				audio.paused = false;
				return Promise.resolve();
			}),
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
		const params = {
			audioRegions: [],
			previewVolume: 1,
			isPlaying: playing,
			currentTime: time,
			timelineTime: time,
			duration: 10,
			sourcePlaybackRate: rate,
			previewSourceAudioFallbackPaths: ["/audio.system.wav"],
			sourceAudioFallbackStartDelayMsByPath: { "/audio.system.wav": delay },
			sourceAudioResourceVersion: 0,
			isCurrentClipMuted: muted,
			getSourceTrackPreviewGain: () => 1,
			onSourceFallbackLoadError: vi.fn(),
		};
		useAudioPreviewSync(params);
		for (const effect of harness.effects) effect();
		await Promise.resolve();
		expect(harness.loaded).toHaveBeenCalledOnce();
		expect(audio.play).not.toHaveBeenCalled();
		if (wasPlaying) audio.paused = false;
		harness.effects.at(-1)?.();
		await Promise.resolve();
		expect(audio.play).toHaveBeenCalledTimes(plays ? 1 : 0);
		if (wasPlaying) expect(audio.pause).toHaveBeenCalled();
		if (seeking) {
			audio.seeking = false;
			harness.effects.at(-1)?.();
			await Promise.resolve();
			expect(audio.play).toHaveBeenCalledOnce();
		}
		if (plays) {
			expect(audio.currentTime).toBeCloseTo(time - delay / 1000);
			harness.effects.at(-1)?.();
			await Promise.resolve();
			expect(audio.play).toHaveBeenCalledOnce();
		}
	});
});
