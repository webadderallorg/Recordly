import { afterEach, describe, expect, it, vi } from "vitest";
import { useAudioPreviewSync } from "./useAudioPreviewSync";

vi.mock("react", () => ({
	useMemo: (fn: () => unknown) => fn(),
	useCallback: (fn: unknown) => fn,
	useRef: (current: unknown) => ({ current }),
	useEffect: (fn: () => unknown) => {
		fn();
	},
}));
vi.mock("@/lib/exporter/localMediaSource", () => ({
	resolveMediaElementSource: async (src: string) => ({ src, revoke: () => {} }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("companion preview timing", () => {
	it.each([
		{ suffix: "mic", delay: 1250, expected: 1.75 },
		{ suffix: "system", delay: 1250, expected: 1.75 },
		{ suffix: "mic", delay: 0, expected: 3 },
		{ suffix: "mic", delay: undefined, expected: 3 },
		{ suffix: "mic", delay: -100, expected: 3 },
		{ suffix: "mic", delay: 4000, expected: 0 },
	])("seeks $suffix with recorded delay $delay ms", async ({ suffix, delay, expected }) => {
		const elements: Array<{ currentTime: number }> = [];
		vi.stubGlobal(
			"Audio",
			class {
				currentTime = 0;
				duration = 10;
				paused = true;
				dataset = {};
				load() {}
				pause() {}
				constructor() {
					elements.push(this);
				}
			},
		);
		const audioPath = `/recording.${suffix}.m4a`;
		useAudioPreviewSync({
			audioRegions: [],
			previewVolume: 1,
			isPlaying: false,
			currentTime: 3,
			timelineTime: 3,
			duration: 10,
			effectiveSpeedRegions: [],
			previewSourceAudioFallbackPaths: [audioPath],
			sourceAudioFallbackStartDelayMsByPath:
				delay === undefined ? {} : { [audioPath]: delay },
			sourceAudioResourceVersion: 0,
			isCurrentClipMuted: false,
			getSourceTrackPreviewGain: () => 1,
			onSourceFallbackLoadError: vi.fn(),
		});
		await Promise.resolve();
		expect(elements).toHaveLength(1);
		expect(elements[0].currentTime).toBe(expected);
	});
});
