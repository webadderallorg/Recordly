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
			playbackRate: 1,
			play: vi.fn(async () => {}),
			pause: vi.fn(),
		} as unknown as HTMLVideoElement;
		const onTime = vi.fn();
		const onPlaying = vi.fn();
		const onError = vi.fn();
		const playback = createClipPlayback({
			video,
			getClips: () => clips,
			onTime,
			onPlaying,
			onError,
		});
		return { video, playback, onTime, onPlaying, onError };
	}
	it("takes real time through a deleted middle at 3x, then resumes at the retained source in-point", async () => {
		const { video, playback, onTime } = setup();
		await playback.play();
		expect(video.playbackRate).toBe(3);
		video.currentTime = 3;
		advance(1000);
		expect(onTime).toHaveBeenLastCalledWith(1, null);
		expect(playback.isPlaying).toBe(true);
		advance(500);
		expect(onTime).toHaveBeenLastCalledWith(1.5, null);
		advance(500);
		expect(video.currentTime).toBe(6);
		expect(onTime).toHaveBeenLastCalledWith(2, 6);
		video.currentTime = 9;
		advance(1000);
		expect(onTime).toHaveBeenLastCalledWith(3, 9);
		video.currentTime = 12;
		advance(1000);
		expect(playback.isPlaying).toBe(false);
	});
	it("seeks, pauses and resumes inside a gap without revealing source footage or restarting the gap", async () => {
		const { video, playback, onTime } = setup();
		playback.seek(1.25);
		expect(onTime).toHaveBeenLastCalledWith(1.25, null);
		await playback.play();
		expect(video.play).not.toHaveBeenCalled();
		advance(250);
		playback.pause();
		advance(5000);
		expect(onTime).toHaveBeenLastCalledWith(1.5, null);
		await playback.play();
		advance(250);
		expect(onTime).toHaveBeenLastCalledWith(1.75, null);
	});
	it("does not skip a short gap when a media tick overshoots the cut", async () => {
		const { video, playback, onTime } = setup([
			{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 3 },
			{ id: "b", startMs: 1010, endMs: 2000, sourceStartMs: 6000, speed: 3 },
		]);
		await playback.play();
		video.currentTime = 3.15;
		advance(1050);
		expect(onTime).toHaveBeenLastCalledWith(1, null);
		advance(10);
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
	it("plays leading gaps and clips placed earlier than their source positions", async () => {
		const { video, playback, onTime } = setup([
			{ id: "moved", startMs: 1000, endMs: 2000, sourceStartMs: 9000, speed: 1 },
		]);
		await playback.play();
		advance(500);
		expect(onTime).toHaveBeenLastCalledWith(0.5, null);
		advance(500);
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
		const setTime = vi.fn((value: number) => { currentTime = value; });
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
