import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	let requestAnimationFrameMock: ReturnType<typeof vi.fn>;
	let cancelAnimationFrameMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		requestAnimationFrameMock = vi.fn(() => 11);
		cancelAnimationFrameMock = vi.fn();
		vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
		vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
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
			freezeRegionsRef: createMutableRef([]),
			onFreezeHoldChange: vi.fn(),
		});

		handlers.handlePlay();
		expect(onPlayStateChange).toHaveBeenCalledWith(true);
		expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
		expect(requestAnimationFrameMock).not.toHaveBeenCalled();

		presentedFrameCallback?.(0, { mediaTime: 1.25 });

		expect(onTimeUpdate).toHaveBeenCalledWith(1.25);
		expect(currentTimeRef.current).toBe(1250);
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
			freezeRegionsRef: createMutableRef([]),
			onFreezeHoldChange: vi.fn(),
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
			freezeRegionsRef: createMutableRef([]),
			onFreezeHoldChange: vi.fn(),
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
			freezeRegionsRef: createMutableRef([]),
			onFreezeHoldChange: vi.fn(),
		});

		handlers.handlePlay();
		handlers.handlePause();
		expect(cancelVideoFrameCallback).toHaveBeenCalledWith(23);

		cancelVideoFrameCallback.mockClear();
		handlers.handlePlay();
		handlers.dispose();
		expect(cancelVideoFrameCallback).toHaveBeenCalledWith(23);
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
			freezeRegionsRef: createMutableRef([]),
			onFreezeHoldChange: vi.fn(),
		});

		handlers.handleSeeked();

		expect(video.currentTime).toBe(2);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2);
	});

	describe("freeze frames", () => {
		const freezeRegion = { id: "freeze-1", sourceMs: 1_000, durationMs: 500 };
		let frameCallbacks: Map<number, FrameRequestCallback>;
		let nextFrameHandle: number;
		let nowMs: number;

		beforeEach(() => {
			frameCallbacks = new Map();
			nextFrameHandle = 1;
			nowMs = 0;
			requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
				const handle = nextFrameHandle++;
				frameCallbacks.set(handle, callback);
				return handle;
			});
			cancelAnimationFrameMock.mockImplementation((handle: number) => {
				frameCallbacks.delete(handle);
			});
			vi.spyOn(performance, "now").mockImplementation(() => nowMs);
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		function advanceHoldClock(ms: number) {
			nowMs += ms;
			const pending = [...frameCallbacks.values()];
			frameCallbacks.clear();
			for (const callback of pending) callback(nowMs);
		}

		function createFreezeHandlers(videoOverrides: Partial<MockVideo> = {}) {
			let presentedFrameCallback: PresentedFrameCallback | null = null;
			const video = createMockVideo({
				currentTime: 0.9,
				play: vi.fn(() => Promise.resolve()),
				requestVideoFrameCallback: vi.fn((callback: PresentedFrameCallback) => {
					presentedFrameCallback = callback;
					return 5;
				}),
				cancelVideoFrameCallback: vi.fn(),
				...videoOverrides,
			});
			const onPlayStateChange = vi.fn();
			const onTimeUpdate = vi.fn();
			const onFreezeHoldChange = vi.fn();
			const handlers = createVideoEventHandlers({
				video,
				isSeekingRef: createMutableRef(false),
				isPlayingRef: createMutableRef(false),
				allowPlaybackRef: createMutableRef(true),
				currentTimeRef: createMutableRef(0),
				timeUpdateAnimationRef: createMutableRef<number | null>(null),
				onPlayStateChange,
				onTimeUpdate,
				trimRegionsRef: createMutableRef([]),
				speedRegionsRef: createMutableRef([]),
				freezeRegionsRef: createMutableRef([freezeRegion]),
				onFreezeHoldChange,
			});

			return {
				video,
				handlers,
				onPlayStateChange,
				onTimeUpdate,
				onFreezeHoldChange,
				presentFrame: (mediaTime: number) => {
					const callback = presentedFrameCallback as PresentedFrameCallback | null;
					callback?.(0, { mediaTime });
				},
			};
		}

		it("holds the crossed frame for the freeze duration, then resumes playback", () => {
			const {
				video,
				handlers,
				onPlayStateChange,
				onTimeUpdate,
				onFreezeHoldChange,
				presentFrame,
			} = createFreezeHandlers();

			handlers.handlePlay();
			presentFrame(1.016);

			expect(video.pause).toHaveBeenCalledTimes(1);
			expect(video.currentTime).toBe(1);
			expect(onTimeUpdate).toHaveBeenLastCalledWith(1);
			expect(onFreezeHoldChange).toHaveBeenLastCalledWith(0);

			// The pause and seek events caused by the hold itself.
			handlers.handlePause();
			handlers.handleSeeking();
			handlers.handleSeeked();
			expect(onPlayStateChange).not.toHaveBeenCalledWith(false);

			advanceHoldClock(300);
			expect(onFreezeHoldChange).toHaveBeenLastCalledWith(300);
			expect(video.play).not.toHaveBeenCalled();

			advanceHoldClock(250);
			expect(onFreezeHoldChange).toHaveBeenLastCalledWith(null);
			expect(video.play).toHaveBeenCalledTimes(1);
		});

		it("pauses and resumes a hold without restarting the video", () => {
			const { video, handlers, onPlayStateChange, onFreezeHoldChange, presentFrame } =
				createFreezeHandlers();

			handlers.handlePlay();
			presentFrame(1.016);
			advanceHoldClock(200);

			expect(handlers.pauseFreezeHold()).toBe(true);
			expect(onPlayStateChange).toHaveBeenLastCalledWith(false);
			advanceHoldClock(1_000);
			expect(onFreezeHoldChange).toHaveBeenLastCalledWith(200);
			expect(video.play).not.toHaveBeenCalled();

			expect(handlers.resumeFreezeHold()).toBe(true);
			expect(onPlayStateChange).toHaveBeenLastCalledWith(true);
			advanceHoldClock(350);
			expect(onFreezeHoldChange).toHaveBeenLastCalledWith(null);
			expect(video.play).toHaveBeenCalledTimes(1);
		});

		it("drops the hold and keeps playing when the user seeks during it", () => {
			const { video, handlers, onFreezeHoldChange, presentFrame } = createFreezeHandlers();

			handlers.handlePlay();
			presentFrame(1.016);
			handlers.handleSeeking();
			handlers.handleSeeked();
			expect(onFreezeHoldChange).toHaveBeenLastCalledWith(0);

			video.currentTime = 3;
			handlers.handleSeeking();

			expect(onFreezeHoldChange).toHaveBeenLastCalledWith(null);
			expect(video.play).toHaveBeenCalledTimes(1);
		});

		it("starts holding immediately when playback starts on a freeze frame", () => {
			const { video, handlers, onFreezeHoldChange } = createFreezeHandlers({
				currentTime: 1,
			});

			handlers.handlePlay();

			expect(onFreezeHoldChange).toHaveBeenCalledWith(0);
			expect(video.requestVideoFrameCallback).not.toHaveBeenCalled();
		});

		it("does not hold the same freeze frame again when playback resumes on it", () => {
			const { handlers, onFreezeHoldChange, presentFrame } = createFreezeHandlers();

			handlers.handlePlay();
			presentFrame(1.016);
			handlers.handleSeeking();
			handlers.handleSeeked();
			advanceHoldClock(600);

			handlers.handlePlay();
			presentFrame(0.995);
			presentFrame(1.02);

			expect(
				onFreezeHoldChange.mock.calls.filter(([elapsedMs]) => elapsedMs === 0),
			).toHaveLength(1);
		});
	});
});
