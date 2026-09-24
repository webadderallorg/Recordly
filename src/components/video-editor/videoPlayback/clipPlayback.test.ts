import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClipRegion } from "../types";
import { createClipPlayback, findPreviewClipAtTimelineTime } from "./clipPlayback";

describe("clip timeline playback", () => {
	let now = 0;
	let tick: FrameRequestCallback | undefined;
	beforeEach(() => {
		now = 0;
		tick = undefined;
		vi.spyOn(performance, "now").mockImplementation(() => now);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			tick = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {
			tick = undefined;
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});
	const advance = (milliseconds: number) => {
		now += milliseconds;
		const callback = tick;
		tick = undefined;
		callback?.(now);
	};
	function setup(
		clips: ClipRegion[] = [
			{ id: "left", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 3 },
			{ id: "right", startMs: 2000, endMs: 4000, sourceStartMs: 6000, speed: 3 },
		],
	) {
		const video = {
			duration: 12,
			currentTime: 0,
			seeking: false,
			paused: true,
			playbackRate: 1,
			play: vi.fn(async () => {
				video.paused = false;
			}),
			pause: vi.fn(() => {
				video.paused = true;
			}),
		} as unknown as HTMLVideoElement;
		const onTime = vi.fn();
		const onPlaying = vi.fn();
		const onError = vi.fn();
		const onSourceSeek = vi.fn();
		const playback = createClipPlayback({
			video,
			getClips: () => clips,
			onTime,
			onPlaying,
			onError,
			onSourceSeek,
		});
		return { video, playback, onTime, onPlaying, onError, onSourceSeek };
	}
	it("crosses a source cut at the same 2.8s timeline timestamp without playing the removed footage", async () => {
		const { video, playback, onTime, onSourceSeek } = setup([
			{ id: "a", startMs: 0, endMs: 2800, sourceStartMs: 0, speed: 1 },
			{ id: "b", startMs: 2800, endMs: 5300, sourceStartMs: 3500, speed: 1 },
		]);
		playback.seek(2.799);
		expect(onTime).toHaveBeenLastCalledWith(2.799, 2.799);
		expect(onSourceSeek).toHaveBeenLastCalledWith("seek");
		await playback.play();
		video.currentTime = 2.8;
		advance(1);
		expect(onTime).toHaveBeenLastCalledWith(2.8, 3.5);
		expect(video.currentTime).toBe(3.5);
		expect(onSourceSeek).toHaveBeenLastCalledWith("cut");
		playback.seek(2.8005);
		expect(onSourceSeek).toHaveBeenLastCalledWith("seek");
		video.currentTime = 3.501;
		advance(1);
		expect(onTime).toHaveBeenLastCalledWith(2.801, 3.501);
	});
	it("pauses source playback until a cut seek finishes", async () => {
		const { video, playback } = setup([
			{ id: "a", startMs: 0, endMs: 1_000, sourceStartMs: 0, speed: 1 },
			{ id: "b", startMs: 1_000, endMs: 2_000, sourceStartMs: 5_000, speed: 1 },
		]);
		await playback.play();
		const playCount = vi.mocked(video.play).mock.calls.length;
		let sourceTime = 0;
		Object.defineProperty(video, "currentTime", {
			get: () => sourceTime,
			set: (value: number) => {
				sourceTime = value;
				if (value === 5) Object.assign(video, { seeking: true });
			},
		});
		video.currentTime = 1;
		advance(1);
		expect(video.pause).toHaveBeenCalled();
		expect(video.currentTime).toBe(5);
		expect(video.play).toHaveBeenCalledTimes(playCount);
		Object.assign(video, { seeking: false });
		advance(1);
		expect(video.play).toHaveBeenCalledTimes(playCount + 1);
	});
	it("cannot simulate playback after the final clip is deleted", async () => {
		const { video, playback, onTime } = setup([]);
		await playback.play();
		advance(1000);
		expect(playback.isPlaying).toBe(false);
		expect(video.play).not.toHaveBeenCalled();
		expect(onTime).not.toHaveBeenCalled();
	});

	it("skips a deleted middle at 3x and resumes at the retained source in-point", async () => {
		const { video, playback, onTime } = setup();
		await playback.play();
		expect(video.playbackRate).toBe(3);
		video.currentTime = 3;
		advance(1000);
		expect(playback.isPlaying).toBe(true);
		expect(video.currentTime).toBe(6);
		expect(onTime).toHaveBeenLastCalledWith(2, 6);
		video.currentTime = 9;
		advance(1000);
		expect(onTime).toHaveBeenLastCalledWith(3, 9);
		video.currentTime = 12;
		advance(1000);
		expect(playback.isPlaying).toBe(false);
	});
	it("keeps paused gap seeks editable and skips to the next clip when play resumes", async () => {
		const { video, playback, onTime } = setup();
		playback.seek(1.25);
		expect(onTime).toHaveBeenLastCalledWith(1.25, null);
		await playback.play();
		expect(onTime).toHaveBeenLastCalledWith(2, 6);
		expect(video.play).toHaveBeenCalled();
		playback.pause();
		advance(5000);
		expect(onTime).toHaveBeenLastCalledWith(2, 6);
		await playback.play();
		video.currentTime = 6.75;
		advance(250);
		expect(onTime).toHaveBeenLastCalledWith(2.25, 6.75);
		playback.seek(1.5);
		expect(onTime).toHaveBeenLastCalledWith(2, 6);
	});
	it("skips a short gap without skipping the next clip in-point when a tick overshoots", async () => {
		const { video, playback, onTime } = setup([
			{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 3 },
			{ id: "b", startMs: 1010, endMs: 2000, sourceStartMs: 6000, speed: 3 },
		]);
		await playback.play();
		video.currentTime = 3.15;
		advance(1050);
		expect(onTime).toHaveBeenLastCalledWith(1.01, 6);
	});
	it("leaves a clip at source EOF even when metadata rounding extends its timeline end", async () => {
		const { video, playback, onTime } = setup([
			{ id: "a", startMs: 0, endMs: 4000, sourceStartMs: 0, speed: 3 },
		]);
		await playback.play();
		Object.assign(video, { currentTime: 11.999, ended: true });
		advance(4000);
		expect(onTime).toHaveBeenLastCalledWith(4, 12);
		expect(playback.isPlaying).toBe(false);
	});
	it("does not skip footage when source playback stalls or a seek is pending", async () => {
		const { video, playback, onTime } = setup();
		await playback.play();
		advance(5000);
		expect(onTime).toHaveBeenLastCalledWith(0, 0);
		playback.seek(3);
		Object.assign(video, { seeking: true, currentTime: 0 });
		advance(2000);
		expect(onTime).toHaveBeenLastCalledWith(3, 9);
	});
	it("skips leading gaps and plays clips from their source positions", async () => {
		const { video, playback, onTime } = setup([
			{ id: "moved", startMs: 1000, endMs: 2000, sourceStartMs: 9000, speed: 1 },
		]);
		await playback.play();
		expect(onTime).toHaveBeenLastCalledWith(1, 9);
		expect(video.currentTime).toBe(9);
		expect(video.playbackRate).toBe(1);
	});
	it("stops and reports an actual source playback failure", async () => {
		const { video, playback, onError } = setup();
		const error = new DOMException("unsupported", "NotSupportedError");
		vi.mocked(video.play).mockRejectedValue(error);
		await playback.play();
		expect(onError).toHaveBeenCalledWith(error);
		expect(playback.isPlaying).toBe(false);
	});
	it.each([
		20, 30,
	])("reports unsupported %sx without crashing or scheduling playback", async (speed) => {
		const clips = [{ id: "fast", startMs: 0, endMs: 1000, speed }];
		const { video, playback, onError } = setup(clips);
		Object.defineProperty(video, "playbackRate", {
			get: () => 1,
			set: (rate: number) => {
				if (rate > 16)
					throw new DOMException("Unsupported playback rate", "NotSupportedError");
			},
		});
		expect(() => playback.refresh()).not.toThrow();
		expect(() => playback.seek(0.5)).not.toThrow();
		await playback.play();
		expect(playback.isPlaying).toBe(false);
		expect(tick).toBeUndefined();
		expect(video.play).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ name: "NotSupportedError" }),
		);
		expect(clips[0].speed).toBe(speed);
		clips[0].speed = 2;
		playback.refresh();
		await playback.play();
		expect(playback.isPlaying).toBe(true);
	});
	it("holds the final clip when seeking to the timeline end and restarts on play", async () => {
		const { playback, video, onTime } = setup();
		playback.seek(4);
		expect(onTime).toHaveBeenLastCalledWith(4, 12);
		expect(video.currentTime).toBeCloseTo(11.999999, 8);
		expect(video.play).not.toHaveBeenCalled();
		await playback.play();
		expect(onTime).toHaveBeenLastCalledWith(0, 0);
	});
	it("does not bounce back into a gap when the decoder lands just before a clip in-point", async () => {
		const { playback, video, onTime } = setup();
		playback.seek(2);
		await playback.play();
		video.currentTime = 5.999999;
		advance(16);
		expect(onTime).toHaveBeenLastCalledWith(2, 6);
		expect(playback.isPlaying).toBe(true);
	});

	it("does not restart decoder seeks when repeatedly selecting the start", () => {
		const { playback, video } = setup();
		let currentTime = 0;
		const setTime = vi.fn((value: number) => {
			currentTime = value;
		});
		Object.defineProperty(video, "currentTime", {
			get: () => currentTime,
			set: setTime,
		});
		playback.seek(0);
		playback.refresh();
		expect(setTime).not.toHaveBeenCalled();
		playback.seek(0.5);
		playback.seek(0);
		playback.seek(0);
		expect(setTime.mock.calls).toEqual([[1.5], [0]]);
	});
	it("holds footage inside a trimmed final out-point and selects the next in-point at a cut", () => {
		const { playback, video } = setup([
			{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
			{ id: "b", startMs: 1000, endMs: 2000, sourceStartMs: 6000, speed: 1 },
		]);
		playback.seek(1);
		expect(video.currentTime).toBe(6);
		playback.seek(2);
		expect(video.currentTime).toBeLessThan(7);
		expect(video.currentTime).toBeGreaterThan(6.999);
	});

	it("keeps real gaps black, chooses the next clip at cuts, and holds only the final endpoint", () => {
		const clips = [
			{ id: "a", startMs: 0, endMs: 1000, speed: 1 },
			{ id: "b", startMs: 1000, endMs: 2000, sourceStartMs: 4000, speed: 1 },
			{ id: "c", startMs: 3000, endMs: 4000, sourceStartMs: 6000, speed: 1 },
		];
		expect(findPreviewClipAtTimelineTime(999.9, clips)?.id).toBe("a");
		expect(findPreviewClipAtTimelineTime(1000, clips)?.id).toBe("b");
		expect(findPreviewClipAtTimelineTime(2000, clips)).toBeNull();
		expect(findPreviewClipAtTimelineTime(2500, clips)).toBeNull();
		expect(findPreviewClipAtTimelineTime(4000, clips)?.id).toBe("c");
		expect(findPreviewClipAtTimelineTime(4001, clips)).toBeNull();
		expect(findPreviewClipAtTimelineTime(0, [])).toBeNull();
	});
});
