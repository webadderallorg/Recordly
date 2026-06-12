import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/extensions", () => ({
	extensionHost: {
		emitEvent: vi.fn(),
	},
}));

import { extensionHost } from "@/lib/extensions";
import { createVideoEventHandlers } from "./videoEventHandlers";

type PresentedFrameCallback = (now: DOMHighResTimeStamp, metadata: { mediaTime?: number }) => void;

type MockVideo = HTMLVideoElement & {
	requestVideoFrameCallback?: (callback: PresentedFrameCallback) => number;
	cancelVideoFrameCallback?: (handle: number) => void;
};

function createMutableRef<T>(value: T) {
	return { current: value };
}

function createMockVideo(overrides: Partial<MockVideo> = {}): MockVideo {
	const video = {
		currentTime: 0.5,
		duration: 10,
		paused: false,
		ended: false,
		playbackRate: 1,
		pause: vi.fn(),
	} as unknown as MockVideo;

	return Object.assign(video, overrides);
}

describe("createVideoEventHandlers", () => {
	const emitEventMock = vi.mocked(extensionHost.emitEvent);
	let requestAnimationFrameMock: ReturnType<typeof vi.fn>;
	let cancelAnimationFrameMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		requestAnimationFrameMock = vi.fn(() => 11);
		cancelAnimationFrameMock = vi.fn();
		vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
		vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
		emitEventMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("prefers requestVideoFrameCallback mediaTime when available", () => {
		let presentedFrameCallback: PresentedFrameCallback | null = null;
		const video = createMockVideo({
			requestVideoFrameCallback: vi.fn((callback) => {
				presentedFrameCallback = callback;
				return 7;
			}),
			cancelVideoFrameCallback: vi.fn(),
		});
		const onPlayStateChange = vi.fn();
		const onTimeUpdate = vi.fn();
		const currentTimeRef = createMutableRef(0);
		const timeUpdateAnimationRef = createMutableRef<number | null>(null);

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef,
			timeUpdateAnimationRef,
			onPlayStateChange,
			onTimeUpdate,
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
			magnetEnabledRef: createMutableRef(true),
		});

		handlers.handlePlay();
		expect(onPlayStateChange).toHaveBeenCalledWith(true);
		expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
		expect(requestAnimationFrameMock).not.toHaveBeenCalled();

		presentedFrameCallback?.(0, { mediaTime: 1.25 });

		expect(onTimeUpdate).toHaveBeenCalledWith(1.25);
		expect(currentTimeRef.current).toBe(1250);
		expect(emitEventMock).toHaveBeenLastCalledWith({
			type: "playback:timeupdate",
			timeMs: 1250,
		});
	});

	it("falls back to requestAnimationFrame when requestVideoFrameCallback is unavailable", () => {
		let animationFrameCallback: FrameRequestCallback | null = null;
		requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
			animationFrameCallback = callback;
			return 19;
		});
		const video = createMockVideo({ currentTime: 0.75 });
		const onTimeUpdate = vi.fn();

		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
			magnetEnabledRef: createMutableRef(true),
		});

		handlers.handlePlay();
		expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);

		video.paused = true;
		animationFrameCallback?.(0);

		expect(onTimeUpdate).toHaveBeenCalledWith(0.75);
	});

	it("skips removed footage when playback reaches a cut region", () => {
		let animationFrameCallback: FrameRequestCallback | null = null;
		requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
			animationFrameCallback = callback;
			return 29;
		});
		const video = createMockVideo({ currentTime: 1.25, duration: 10 });
		const onTimeUpdate = vi.fn();
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([{ id: "trim-1", startMs: 1000, endMs: 2000 }]),
			speedRegionsRef: createMutableRef([]),
			magnetEnabledRef: createMutableRef(true),
		});

		handlers.handlePlay();
		animationFrameCallback?.(0);

		expect(video.currentTime).toBe(2);
		expect(video.pause).not.toHaveBeenCalled();
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2);
	});

	it("cancels a pending requestVideoFrameCallback on pause and dispose", () => {
		const cancelVideoFrameCallback = vi.fn();
		const video = createMockVideo({
			requestVideoFrameCallback: vi.fn(() => 23),
			cancelVideoFrameCallback,
		});
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate: vi.fn(),
			trimRegionsRef: createMutableRef([]),
			speedRegionsRef: createMutableRef([]),
			magnetEnabledRef: createMutableRef(true),
		});

		handlers.handlePlay();
		handlers.handlePause();
		expect(cancelVideoFrameCallback).toHaveBeenCalledWith(23);

		cancelVideoFrameCallback.mockClear();
		handlers.handlePlay();
		handlers.dispose();
		expect(cancelVideoFrameCallback).toHaveBeenCalledWith(23);
	});

	function createSeekTrackingVideo({ duration = 20 }: { duration?: number } = {}) {
		let backingTime = 0;
		const assignedTimes: number[] = [];
		let frameCallback: PresentedFrameCallback | null = null;
		const video = {
			duration,
			paused: false,
			ended: false,
			playbackRate: 1,
			pause: vi.fn(),
			requestVideoFrameCallback: vi.fn((callback: PresentedFrameCallback) => {
				frameCallback = callback;
				return 31;
			}),
			cancelVideoFrameCallback: vi.fn(),
		} as unknown as MockVideo;
		Object.defineProperty(video, "currentTime", {
			get: () => backingTime,
			set: (value: number) => {
				assignedTimes.push(value);
				backingTime = value;
			},
		});

		return {
			video,
			assignedTimes,
			fireFrame: (mediaTime: number) => frameCallback?.(0, { mediaTime }),
			setCurrentTimeSilently: (value: number) => {
				backingTime = value;
			},
		};
	}

	function createTrimGuardHandlers(
		video: MockVideo,
		trimRegions: { id: string; startMs: number; endMs: number }[],
	) {
		const onTimeUpdate = vi.fn();
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(false),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef(trimRegions),
			speedRegionsRef: createMutableRef([]),
			magnetEnabledRef: createMutableRef(true),
		});
		return { handlers, onTimeUpdate };
	}

	describe("trim skip re-entry guard", () => {
		it("does not re-skip the same trim region from a stale frame callback", () => {
			const { video, assignedTimes, fireFrame } = createSeekTrackingVideo();
			const { handlers, onTimeUpdate } = createTrimGuardHandlers(video, [
				{ id: "trim-1", startMs: 5000, endMs: 9000 },
			]);

			handlers.handlePlay();
			fireFrame(5.2);

			expect(assignedTimes).toEqual([9]);
			expect(onTimeUpdate).toHaveBeenLastCalledWith(9);

			// A late frame callback still reporting the pre-seek media time must
			// not trigger a second seek or move the playhead backwards.
			fireFrame(5.2);

			expect(assignedTimes).toEqual([9]);
			expect(onTimeUpdate).toHaveBeenLastCalledWith(9);
		});

		it("clears the pending skip once playback passes the target", () => {
			const { video, assignedTimes, fireFrame } = createSeekTrackingVideo();
			const { handlers, onTimeUpdate } = createTrimGuardHandlers(video, [
				{ id: "trim-1", startMs: 5000, endMs: 9000 },
				{ id: "trim-2", startMs: 12000, endMs: 15000 },
			]);

			handlers.handlePlay();
			fireFrame(5.2);
			fireFrame(5.2); // stale, ignored
			fireFrame(9.0); // reaches the target -> pending state clears

			expect(onTimeUpdate).toHaveBeenLastCalledWith(9);

			// With the pending state cleared, entering the next trim region
			// must trigger a fresh skip.
			fireFrame(12.5);

			expect(assignedTimes).toEqual([9, 15]);
			expect(onTimeUpdate).toHaveBeenLastCalledWith(15);
		});

		it("user scrubbing into a trim region still skips once", () => {
			const { video, assignedTimes, setCurrentTimeSilently } = createSeekTrackingVideo();
			video.paused = true;
			const { handlers, onTimeUpdate } = createTrimGuardHandlers(video, [
				{ id: "trim-1", startMs: 5000, endMs: 9000 },
			]);

			// User scrubs to 6.0s (external currentTime assignment).
			setCurrentTimeSilently(6.0);
			handlers.handleSeeking();
			handlers.handleSeeked();

			expect(assignedTimes).toEqual([9]);

			// Our own corrective seek fires seeking/seeked again in a real
			// browser; it must not seek a second time.
			handlers.handleSeeking();
			handlers.handleSeeked();

			expect(assignedTimes).toEqual([9]);
			expect(onTimeUpdate).toHaveBeenLastCalledWith(9);
		});

		it("a user scrub away from the pending target clears the guard", () => {
			const { video, assignedTimes, fireFrame, setCurrentTimeSilently } =
				createSeekTrackingVideo();
			const { handlers, onTimeUpdate } = createTrimGuardHandlers(video, [
				{ id: "trim-1", startMs: 5000, endMs: 9000 },
			]);

			handlers.handlePlay();
			fireFrame(5.2);
			expect(assignedTimes).toEqual([9]);

			// User scrubs back to 2.0s before playback reaches the target.
			setCurrentTimeSilently(2.0);
			handlers.handleSeeking();
			handlers.handleSeeked();

			expect(assignedTimes).toEqual([9]);
			expect(onTimeUpdate).toHaveBeenLastCalledWith(2);

			// Re-entering the trim region after the scrub must skip again.
			fireFrame(5.5);

			expect(assignedTimes).toEqual([9, 9]);
			expect(onTimeUpdate).toHaveBeenLastCalledWith(9);
		});
	});

	it("skips removed footage after a paused seek", () => {
		const video = createMockVideo({
			currentTime: 1.25,
			paused: true,
		});
		const onTimeUpdate = vi.fn();
		const handlers = createVideoEventHandlers({
			video,
			isSeekingRef: createMutableRef(true),
			isPlayingRef: createMutableRef(false),
			allowPlaybackRef: createMutableRef(true),
			currentTimeRef: createMutableRef(0),
			timeUpdateAnimationRef: createMutableRef<number | null>(null),
			onPlayStateChange: vi.fn(),
			onTimeUpdate,
			trimRegionsRef: createMutableRef([{ id: "trim-1", startMs: 1000, endMs: 2000 }]),
			speedRegionsRef: createMutableRef([]),
			magnetEnabledRef: createMutableRef(true),
		});

		handlers.handleSeeked();

		expect(video.currentTime).toBe(2);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2);
	});

	describe("wall-clock gap driver (magnet off)", () => {
		const gapRegion = { id: "trim-1", startMs: 5000, endMs: 9000 };
		let wallNowMs = 0;
		let nowSpy: ReturnType<typeof vi.spyOn>;
		let latestGapTick: FrameRequestCallback | null = null;

		const runGapTick = () => {
			const tick = latestGapTick;
			latestGapTick = null;
			tick?.(0);
		};

		beforeEach(() => {
			wallNowMs = 0;
			latestGapTick = null;
			requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
				latestGapTick = callback;
				return 51;
			});
			nowSpy = vi.spyOn(performance, "now").mockImplementation(() => wallNowMs);
		});

		afterEach(() => {
			nowSpy.mockRestore();
		});

		function createGapDriveSetup(
			trimRegions: { id: string; startMs: number; endMs: number }[],
		) {
			let backingTime = 0;
			const assignedTimes: number[] = [];
			let frameCallback: PresentedFrameCallback | null = null;
			const pauseMock = vi.fn();
			const playMock = vi.fn();
			const video = {
				duration: 20,
				paused: false,
				ended: false,
				playbackRate: 1,
				pause: pauseMock,
				play: playMock,
				requestVideoFrameCallback: vi.fn((callback: PresentedFrameCallback) => {
					frameCallback = callback;
					return 41;
				}),
				cancelVideoFrameCallback: vi.fn(),
			} as unknown as MockVideo;
			Object.defineProperty(video, "currentTime", {
				get: () => backingTime,
				set: (value: number) => {
					assignedTimes.push(value);
					backingTime = value;
				},
			});

			const onTimeUpdate = vi.fn();
			const onPlayStateChange = vi.fn();
			const onGapStateChange = vi.fn();
			const allowPlaybackRef = createMutableRef(true);
			const magnetEnabledRef = createMutableRef(false);
			const handlers = createVideoEventHandlers({
				video,
				isSeekingRef: createMutableRef(false),
				isPlayingRef: createMutableRef(false),
				allowPlaybackRef,
				currentTimeRef: createMutableRef(0),
				timeUpdateAnimationRef: createMutableRef<number | null>(null),
				onPlayStateChange,
				onTimeUpdate,
				trimRegionsRef: createMutableRef(trimRegions),
				speedRegionsRef: createMutableRef([]),
				magnetEnabledRef,
				onGapStateChange,
			});

			// Mirror a real media element: pause()/play() flip `paused` and fire
			// the matching event handler the way the browser queues pause/play
			// events after the call.
			pauseMock.mockImplementation(() => {
				if (video.paused) return;
				video.paused = true;
				handlers.handlePause();
			});
			playMock.mockImplementation(() => {
				if (!video.paused) return;
				video.paused = false;
				handlers.handlePlay();
			});

			return {
				video,
				assignedTimes,
				pauseMock,
				playMock,
				fireFrame: (mediaTime: number) => frameCallback?.(0, { mediaTime }),
				setCurrentTimeSilently: (value: number) => {
					backingTime = value;
				},
				handlers,
				onTimeUpdate,
				onPlayStateChange,
				onGapStateChange,
				allowPlaybackRef,
				magnetEnabledRef,
				lastTime: () => onTimeUpdate.mock.lastCall?.[0],
			};
		}

		it("entering a gap pauses the video and advances time on the wall clock", () => {
			const s = createGapDriveSetup([gapRegion]);

			s.handlers.handlePlay();
			s.setCurrentTimeSilently(5.25);
			wallNowMs = 1000;
			s.fireFrame(5.25);

			expect(s.pauseMock).toHaveBeenCalledTimes(1);
			expect(s.onGapStateChange).toHaveBeenLastCalledWith(true);
			expect(s.lastTime()).toBe(5.25);
			// The gap is played as time, not skipped: no seek is issued.
			expect(s.assignedTimes).toEqual([]);
			// Entering the gap must not flip the editor to "paused".
			expect(s.onPlayStateChange).not.toHaveBeenCalledWith(false);

			wallNowMs = 1500;
			runGapTick();
			expect(s.lastTime()).toBe(5.75);

			wallNowMs = 2350;
			runGapTick();
			expect(s.lastTime()).toBe(6.6);
			expect(s.playMock).not.toHaveBeenCalled();
		});

		it("reaching the gap end seeks to the gap end and resumes playback exactly once", () => {
			const s = createGapDriveSetup([gapRegion]);

			s.handlers.handlePlay();
			s.setCurrentTimeSilently(5.25);
			wallNowMs = 1000;
			s.fireFrame(5.25);

			wallNowMs = 1000 + (9000 - 5250);
			runGapTick();

			expect(s.assignedTimes).toEqual([9]);
			expect(s.playMock).toHaveBeenCalledTimes(1);
			expect(s.onGapStateChange).toHaveBeenLastCalledWith(false);
			expect(s.lastTime()).toBe(9);

			// A stale frame callback reporting a pre-seek time must not re-enter
			// the gap (Task-2 pending-skip guard).
			s.fireFrame(5.3);
			expect(s.assignedTimes).toEqual([9]);
			expect(s.playMock).toHaveBeenCalledTimes(1);
		});

		it("a user pause mid-gap freezes the emitted time and play resumes from the stored position", () => {
			const s = createGapDriveSetup([gapRegion]);

			s.handlers.handlePlay();
			s.setCurrentTimeSilently(5.25);
			wallNowMs = 0;
			s.fireFrame(5.25);
			wallNowMs = 550;
			runGapTick();
			expect(s.lastTime()).toBe(5.8);

			s.handlers.handlePause();
			expect(s.onPlayStateChange).toHaveBeenLastCalledWith(false);

			// Wall clock keeps running but the frozen driver must not advance.
			wallNowMs = 9000;
			runGapTick();
			expect(s.lastTime()).toBe(5.8);
			expect(s.assignedTimes).toEqual([]);

			// Resume: playback restarts the driver from the stored position, not
			// from the media element's parked time.
			wallNowMs = 20000;
			s.video.play();
			s.fireFrame(5.25);
			expect(s.lastTime()).toBe(5.8);
			expect(s.onGapStateChange).toHaveBeenLastCalledWith(true);

			wallNowMs = 20100;
			runGapTick();
			expect(s.lastTime()).toBe(5.9);
		});

		it("the editor pause control freezes the driver via the allow-playback ref", () => {
			const s = createGapDriveSetup([gapRegion]);

			s.handlers.handlePlay();
			s.setCurrentTimeSilently(5.25);
			wallNowMs = 0;
			s.fireFrame(5.25);
			wallNowMs = 250;
			runGapTick();
			expect(s.lastTime()).toBe(5.5);

			// The imperative pause() cannot fire a media "pause" event while the
			// driver already holds the element paused; the ref is the signal.
			s.allowPlaybackRef.current = false;
			runGapTick();

			expect(s.onPlayStateChange).toHaveBeenLastCalledWith(false);
			expect(s.lastTime()).toBe(5.5);

			wallNowMs = 9000;
			runGapTick();
			expect(s.lastTime()).toBe(5.5);
		});

		it("scrubbing out of a gap cancels the driver and continues playback", () => {
			const s = createGapDriveSetup([gapRegion]);

			s.handlers.handlePlay();
			s.setCurrentTimeSilently(5.25);
			wallNowMs = 0;
			s.fireFrame(5.25);
			wallNowMs = 250;
			runGapTick();
			expect(s.lastTime()).toBe(5.5);

			s.setCurrentTimeSilently(2.0);
			s.handlers.handleSeeking();
			expect(s.onGapStateChange).toHaveBeenLastCalledWith(false);
			s.handlers.handleSeeked();

			expect(s.lastTime()).toBe(2);
			// No skip-past-gap seek was issued by the driver.
			expect(s.assignedTimes).toEqual([]);
			// Playback was logically running, so leaving the gap resumes the video.
			expect(s.playMock).toHaveBeenCalledTimes(1);

			// Any stale gap tick is inert after cancellation.
			wallNowMs = 9000;
			runGapTick();
			expect(s.lastTime()).toBe(2);
		});

		it("a paused scrub into a gap parks on black without skipping", () => {
			const s = createGapDriveSetup([gapRegion]);
			s.video.paused = true;

			s.setCurrentTimeSilently(6.0);
			s.handlers.handleSeeking();
			s.handlers.handleSeeked();

			expect(s.assignedTimes).toEqual([]);
			expect(s.lastTime()).toBe(6);
			expect(s.playMock).not.toHaveBeenCalled();
			expect(s.onGapStateChange).not.toHaveBeenCalledWith(true);
		});

		it("re-enabling the magnet mid-gap cancels the drive, seeks to the gap end and resumes", () => {
			const s = createGapDriveSetup([gapRegion]);

			s.handlers.handlePlay();
			s.setCurrentTimeSilently(5.25);
			wallNowMs = 1000;
			s.fireFrame(5.25);
			wallNowMs = 1500;
			runGapTick();
			expect(s.lastTime()).toBe(5.75);

			// The user flips the magnet back on while black time is playing: gaps
			// are collapsed/skipped again, so the drive must finish immediately.
			s.magnetEnabledRef.current = true;
			wallNowMs = 2000;
			runGapTick();

			expect(s.assignedTimes).toEqual([9]);
			expect(s.lastTime()).toBe(9);
			expect(s.onGapStateChange).toHaveBeenLastCalledWith(false);
			expect(s.playMock).toHaveBeenCalledTimes(1);

			// The canceled drive must not keep ticking.
			wallNowMs = 9000;
			runGapTick();
			expect(s.lastTime()).toBe(9);
			expect(s.assignedTimes).toEqual([9]);
		});

		it("scrubbing into a gap while playing starts the driver from the scrub position", () => {
			const s = createGapDriveSetup([gapRegion]);

			s.handlers.handlePlay();
			s.setCurrentTimeSilently(7.0);
			wallNowMs = 100;
			s.handlers.handleSeeking();
			s.handlers.handleSeeked();

			expect(s.pauseMock).toHaveBeenCalledTimes(1);
			expect(s.onGapStateChange).toHaveBeenLastCalledWith(true);
			expect(s.lastTime()).toBe(7);
			expect(s.assignedTimes).toEqual([]);

			wallNowMs = 600;
			runGapTick();
			expect(s.lastTime()).toBe(7.5);
		});
	});
});
