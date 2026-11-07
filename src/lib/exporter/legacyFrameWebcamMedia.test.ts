import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syncWebcamFrame } from "./legacyFrameWebcamMedia";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), initialize: vi.fn() }));
vi.mock("./localMediaSource", () => ({ resolveMediaElementSource: mocks.resolve }));
vi.mock("./forwardFrameSource", () => ({
	ForwardFrameSource: class {
		initialize = mocks.initialize;
	},
}));
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolve.mockResolvedValue({ src: "blob:webcam", revoke: vi.fn() });
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
function context(readyState = 2) {
	const video = {
		readyState,
		currentTime: 0,
		duration: 10,
		crossOrigin: "",
		src: "",
		muted: false,
		preload: "",
		playsInline: false,
		seeking: false,
		load: vi.fn(),
		pause: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	};
	const failed = {
		getFrameAtTime: vi.fn().mockRejectedValue(new Error("Decoder lost frame")),
		cancel: vi.fn(),
		destroy: vi.fn().mockResolvedValue(undefined),
	};
	const state = {
		config: {
			webcam: { enabled: true, timeOffsetMs: 0 },
			webcamUrl: "file:///tmp/webcam.webm",
		},
		webcamForwardFrameSource: failed,
		closeWebcamDecodedFrame: vi.fn(),
		cleanupWebcamSource: null,
		webcamVideoElement: null,
		webcamFrameCacheCanvas: null,
		webcamFrameCacheCtx: null,
		lastSyncedWebcamTime: null,
		webcamSeekPromise: null,
		webcamDecodedFrame: null,
		pendingMediaCancellations: new Set(),
		mediaCancelled: false,
	};
	vi.stubGlobal("document", { createElement: () => video });
	vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
	vi.stubGlobal("window", { setTimeout, clearTimeout });
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		callback(0);
		return 1;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	return { state: state as unknown as Parameters<typeof syncWebcamFrame>[0], video, failed };
}
it("recovers a post-initialize decoder rejection through media-element sampling", async () => {
	const { state, video, failed } = context();
	await expect(syncWebcamFrame(state, 1)).resolves.toBeUndefined();
	expect(failed.cancel).toHaveBeenCalledOnce();
	expect(failed.destroy).toHaveBeenCalledOnce();
	expect(state.webcamForwardFrameSource).toBeNull();
	expect(state.webcamVideoElement).toBe(video);
	expect(video.currentTime).toBe(1);
	expect(state.lastSyncedWebcamTime).toBe(1);
	expect(mocks.initialize).not.toHaveBeenCalled();
});
it("keeps export alive and clears the failed decoder when media fallback cannot resolve", async () => {
	const { state } = context();
	mocks.resolve.mockRejectedValue(new Error("Missing media"));
	await expect(syncWebcamFrame(state, 1)).resolves.toBeUndefined();
	expect(state.webcamForwardFrameSource).toBeNull();
	expect(state.webcamVideoElement).toBeNull();
});
it("does not reopen webcam media after export cancellation", async () => {
	const { state } = context();
	state.mediaCancelled = true;
	await expect(syncWebcamFrame(state, 1)).resolves.toBeUndefined();
	expect(mocks.resolve).not.toHaveBeenCalled();
	expect(state.webcamForwardFrameSource).toBeNull();
});
it("handles a decoder rejected after cancellation clears the active source", async () => {
	const { state, failed } = context();
	let rejectFrame!: (error: Error) => void;
	failed.getFrameAtTime.mockReturnValueOnce(
		new Promise((_resolve, reject) => {
			rejectFrame = reject;
		}),
	);
	const syncing = syncWebcamFrame(state, 1);
	state.mediaCancelled = true;
	state.webcamForwardFrameSource = null;
	rejectFrame(new Error("Canceled decoder"));
	await expect(syncing).resolves.toBeUndefined();
	expect(mocks.resolve).not.toHaveBeenCalled();
	expect(failed.destroy).toHaveBeenCalledOnce();
});
it("bounds media fallback readiness and releases a source that never loads", async () => {
	vi.useFakeTimers();
	const { state, video } = context(0);
	const revoke = vi.fn();
	mocks.resolve.mockResolvedValue({ src: "blob:stalled", revoke });
	const syncing = syncWebcamFrame(state, 1);
	await vi.advanceTimersByTimeAsync(5001);
	await expect(syncing).resolves.toBeUndefined();
	expect(state.webcamVideoElement).toBeNull();
	expect(revoke).toHaveBeenCalledOnce();
	expect(video.pause).toHaveBeenCalledOnce();
	expect(state.pendingMediaCancellations.size).toBe(0);
});
