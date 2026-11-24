import { describe, expect, it, vi } from "vitest";
import { useEditorPlaybackControls } from "./useEditorPlaybackControls";

vi.mock("react", () => ({
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => void) => effect(),
	useRef: (current: unknown) => ({ current }),
}));

describe("useEditorPlaybackControls frame stepping", () => {
	function setup({
		timelinePlayheadTime = 5.0,
		timelineDuration = 10.0,
		sourceFrameTimestamps = null as number[] | null,
		sourceFrameRate = null as number | null,
		clipRegions = [] as Parameters<typeof useEditorPlaybackControls>[0]["clipRegions"],
		zoomRegions = [] as Parameters<typeof useEditorPlaybackControls>[0]["zoomRegions"],
	} = {}) {
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
			clipRegions,
			zoomRegions,
			timelinePlayheadTime,
			timelineDuration,
			sourceFrameTimestamps,
			sourceFrameRate,
		});

		return { controls, playback, videoPlaybackRef, timelineRef };
	}

	it("steps by decoded presentation timestamps without requiring an fps argument", () => {
		const { controls, playback } = setup({
			timelinePlayheadTime: 0.225,
			timelineDuration: 2.5,
			sourceFrameTimestamps: [0, 0.05, 0.225, 1.236117, 1.252783, 2.0],
			sourceFrameRate: 60,
		});
		playback.isPlaying = true;

		controls.stepFrameForward();
		expect(playback.pause).toHaveBeenCalled();
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(1.236117, 6));

		controls.stepFrameBackward();
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(0.225, 6));
	});

	it("uses sourceFrameRate when presentation timestamps are unavailable", () => {
		const { controls, playback } = setup({
			timelinePlayheadTime: 2.0,
			timelineDuration: 10.0,
			sourceFrameTimestamps: null,
			sourceFrameRate: 30,
		});

		controls.stepFrameForward();
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(2.0 + 1 / 30, 5));

		controls.stepFrameBackward();
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(2.0, 5));
	});

	it("falls back to 60 fps when neither presentation timestamps nor sourceFrameRate exist", () => {
		const { controls, playback } = setup({
			timelinePlayheadTime: 2.0,
			timelineDuration: 10.0,
		});
		playback.isPlaying = true;

		controls.stepFrameForward();
		expect(playback.pause).toHaveBeenCalled();
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(2.0 + 1 / 60, 5));

		controls.stepFrameBackward();
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(2.0, 5));
	});

	it("supports explicit custom fps override (e.g. 30fps) for frame stepping", () => {
		const { controls: c1, playback: p1 } = setup({
			timelinePlayheadTime: 2.0,
			timelineDuration: 10.0,
		});
		c1.stepFrameForward(30);
		expect(p1.seekTimeline).toHaveBeenCalledWith(expect.closeTo(2.0 + 1 / 30, 5));

		const { controls: c2, playback: p2 } = setup({
			timelinePlayheadTime: 2.0,
			timelineDuration: 10.0,
		});
		c2.stepFrameBackward(30);
		expect(p2.seekTimeline).toHaveBeenCalledWith(expect.closeTo(2.0 - 1 / 30, 5));
	});

	it("clamps fallback frame stepping at 0 and timelineDuration", () => {
		const { controls: cStart, playback: pStart } = setup({
			timelinePlayheadTime: 0.005,
			timelineDuration: 10.0,
		});
		cStart.stepFrameBackward();
		expect(pStart.seekTimeline).toHaveBeenCalledWith(0);

		const { controls: cEnd, playback: pEnd } = setup({
			timelinePlayheadTime: 9.995,
			timelineDuration: 10.0,
		});
		cEnd.stepFrameForward();
		expect(pEnd.seekTimeline).toHaveBeenCalledWith(10.0);
	});

	it("steps time by custom seconds (e.g. +1s and -1s)", () => {
		const { controls: c1, playback: p1 } = setup({
			timelinePlayheadTime: 5.0,
			timelineDuration: 10.0,
		});
		c1.stepTimeSeconds(1);
		expect(p1.seekTimeline).toHaveBeenCalledWith(6.0);

		const { controls: c2, playback: p2 } = setup({
			timelinePlayheadTime: 5.0,
			timelineDuration: 10.0,
		});
		c2.stepTimeSeconds(-2.5);
		expect(p2.seekTimeline).toHaveBeenCalledWith(2.5);
	});

	it("accumulates rapid repeated frame steps correctly across keydowns", () => {
		const { controls, playback } = setup({
			timelinePlayheadTime: 1.0,
			timelineDuration: 10.0,
		});

		controls.stepFrameForward(60);
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(1.0 + 1 / 60, 5));

		controls.stepFrameForward(60);
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(1.0 + 2 / 60, 5));

		controls.stepFrameForward(60);
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(expect.closeTo(1.0 + 3 / 60, 5));
	});

	it("skips between clips, zooms, and keyframes in timeline order", () => {
		const { controls, playback } = setup({
			timelinePlayheadTime: 0,
			timelineDuration: 10.0,
			clipRegions: [
				{ id: "clip-1", startMs: 0, endMs: 4000, speed: 1 },
				{ id: "clip-2", startMs: 4000, endMs: 10000, speed: 1 },
			],
			zoomRegions: [
				{
					id: "zoom-1",
					startMs: 1000,
					endMs: 2500,
					depth: 2,
					mode: "manual",
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
		});

		controls.handlePreviewSkip("forward");
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(1.0);
		controls.handlePreviewSkip("forward");
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(2.0);
		controls.handlePreviewSkip("forward");
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(4.0);
		controls.handlePreviewSkip("backward");
		expect(playback.seekTimeline).toHaveBeenLastCalledWith(2.0);
	});
});
