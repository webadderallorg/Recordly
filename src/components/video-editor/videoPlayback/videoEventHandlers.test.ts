import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVideoEventHandlers } from "./videoEventHandlers";

type MockVideo = HTMLVideoElement;

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

	it("advances from currentTime between presented video frames", () => {
		let animationFrameCallback: FrameRequestCallback | null = null;
		requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
			animationFrameCallback = callback;
			return 19;
		});
		const requestVideoFrameCallback = vi.fn(() => 7);
		const video = createMockVideo({
			currentTime: 0.5,
			requestVideoFrameCallback,
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
		});

		handlers.handlePlay();
		expect(onPlayStateChange).toHaveBeenCalledWith(true);
		expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
		expect(requestVideoFrameCallback).not.toHaveBeenCalled();

		video.currentTime = 1.25;
		animationFrameCallback?.(0);

		expect(onTimeUpdate).toHaveBeenCalledWith(1.25);
		expect(currentTimeRef.current).toBe(1250);
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
		});

		handlers.handlePlay();
		animationFrameCallback?.(0);

		expect(video.currentTime).toBe(2);
		expect(video.pause).not.toHaveBeenCalled();
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2);
	});

	it("cancels a pending animation frame on pause and dispose", () => {
		const video = createMockVideo();
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
		});

		handlers.handlePlay();
		handlers.handlePause();
		expect(cancelAnimationFrameMock).toHaveBeenCalledWith(11);

		cancelAnimationFrameMock.mockClear();
		handlers.handlePlay();
		handlers.dispose();
		expect(cancelAnimationFrameMock).toHaveBeenCalledWith(11);
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
		});

		handlers.handleSeeked();

		expect(video.currentTime).toBe(2);
		expect(onTimeUpdate).toHaveBeenLastCalledWith(2);
	});
});
