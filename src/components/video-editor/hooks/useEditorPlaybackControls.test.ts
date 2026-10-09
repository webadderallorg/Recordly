import { describe, expect, it, vi } from "vitest";
import { useEditorPlaybackControls } from "./useEditorPlaybackControls";

vi.mock("react", () => ({
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => void) => effect(),
	useRef: (current: unknown) => ({ current }),
}));

describe("useEditorPlaybackControls frame stepping", () => {
	function setup(timelinePlayheadTime = 5.0, timelineDuration = 10.0) {
		const video = {};
		const playback = {
			video,
			isPlaying: false,
			pause: vi.fn(() => {
				playback.isPlaying = false;
			}),
			play: vi.fn().mockResolvedValue(undefined),
			seekTimeline: vi.fn(),
		};
		const videoPlaybackRef = { current: playback };
		const timelineRef = {
			current: {
				keyframes: [
					{ id: "k1", time: 2000 },
					{ id: "k2", time: 8000 },
				],
			},
		};
		const playSourceAudioPreview = vi.fn();

		const controls = useEditorPlaybackControls({
			videoPlaybackRef: videoPlaybackRef as unknown as Parameters<
				typeof useEditorPlaybackControls
			>[0]["videoPlaybackRef"],
			timelineRef: timelineRef as unknown as Parameters<
				typeof useEditorPlaybackControls
			>[0]["timelineRef"],
			playSourceAudioPreview,
			timelinePlayheadTime,
			timelineDuration,
		});

		return { controls, playback, videoPlaybackRef, timelineRef };
	}

	it("steps forward by 1 frame (1/60s) and pauses active playback", () => {
		const { controls, playback } = setup(2.0, 10.0);
		playback.isPlaying = true;

		controls.stepFrameForward();

		expect(playback.pause).toHaveBeenCalled();
		expect(playback.seekTimeline).toHaveBeenCalledWith(expect.closeTo(2.0 + 1 / 60, 5));
	});

	it("steps backward by 1 frame (1/60s) and pauses active playback", () => {
		const { controls, playback } = setup(2.0, 10.0);
		playback.isPlaying = true;

		controls.stepFrameBackward();

		expect(playback.pause).toHaveBeenCalled();
		expect(playback.seekTimeline).toHaveBeenCalledWith(expect.closeTo(2.0 - 1 / 60, 5));
	});

	it("supports custom fps (e.g. 30fps) for frame stepping", () => {
		const { controls: c1, playback: p1 } = setup(2.0, 10.0);
		c1.stepFrameForward(30);
		expect(p1.seekTimeline).toHaveBeenCalledWith(expect.closeTo(2.0 + 1 / 30, 5));

		const { controls: c2, playback: p2 } = setup(2.0, 10.0);
		c2.stepFrameBackward(30);
		expect(p2.seekTimeline).toHaveBeenCalledWith(expect.closeTo(2.0 - 1 / 30, 5));
	});

	it("clamps frame stepping at 0 when stepping backward near start", () => {
		const { controls, playback } = setup(0.005, 10.0);

		controls.stepFrameBackward();

		expect(playback.seekTimeline).toHaveBeenCalledWith(0);
	});

	it("clamps frame stepping at duration when stepping forward near end", () => {
		const { controls, playback } = setup(9.995, 10.0);

		controls.stepFrameForward();

		expect(playback.seekTimeline).toHaveBeenCalledWith(10.0);
	});

	it("steps time by custom seconds (e.g. +1s and -1s)", () => {
		const { controls: c1, playback: p1 } = setup(5.0, 10.0);
		c1.stepTimeSeconds(1);
		expect(p1.seekTimeline).toHaveBeenCalledWith(6.0);

		const { controls: c2, playback: p2 } = setup(5.0, 10.0);
		c2.stepTimeSeconds(-2.5);
		expect(p2.seekTimeline).toHaveBeenCalledWith(2.5);
	});

	it("accumulates rapid repeated frame steps correctly across keydowns", () => {
		const { controls, playback } = setup(1.0, 10.0);

		controls.stepFrameForward(60);
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(1.0 + 1 / 60, 5));

		controls.stepFrameForward(60);
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(1.0 + 2 / 60, 5));

		controls.stepFrameForward(60);
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(1.0 + 3 / 60, 5));
	});
});
