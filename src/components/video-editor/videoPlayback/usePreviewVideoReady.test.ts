import { afterEach, expect, it, vi } from "vitest";
import { usePreviewVideoReady } from "./usePreviewVideoReady";

const state = vi.hoisted(() => ({
	setReady: vi.fn(),
	cleanup: undefined as (() => void) | undefined,
}));
vi.mock("react", () => ({
	useState: () => [false, state.setReady],
	useLayoutEffect: (effect: () => () => void) => {
		state.cleanup = effect();
	},
}));
class Video extends EventTarget {
	readyState = 0;
	videoWidth = 0;
	videoHeight = 0;
}
afterEach(() => {
	state.cleanup?.();
	state.setReady.mockClear();
	vi.unstubAllGlobals();
});
it("becomes ready after every source change without a polling callback", () => {
	vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
	const video = new Video();
	const ref = { current: video as unknown as HTMLVideoElement };
	for (let index = 0; index < 10; index++) {
		state.cleanup?.();
		video.readyState = 0;
		// biome-ignore lint/correctness/useHookAtTopLevel: Mocked React effects simulate successive source subscriptions.
		usePreviewVideoReady(ref, `project-${index}.mp4`);
		expect(state.setReady).toHaveBeenLastCalledWith(false);
		video.readyState = 2;
		video.videoWidth = 1920;
		video.videoHeight = 1080;
		video.dispatchEvent(new Event("loadeddata"));
		expect(state.setReady).toHaveBeenLastCalledWith(true);
	}
	state.cleanup?.();
	state.setReady.mockClear();
	video.dispatchEvent(new Event("loadeddata"));
	expect(state.setReady).not.toHaveBeenCalled();
});
it("recognizes an already loaded source when subscribing", () => {
	vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
	const video = new Video();
	Object.assign(video, { readyState: 4, videoWidth: 1920, videoHeight: 1080 });
	usePreviewVideoReady({ current: video as unknown as HTMLVideoElement }, "cached.mp4");
	expect(state.setReady).toHaveBeenLastCalledWith(true);
	video.readyState = 0;
	video.dispatchEvent(new Event("emptied"));
	expect(state.setReady).toHaveBeenLastCalledWith(false);
});

it("retains the preview through transient readiness drops during boundary seeks", () => {
	vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
	const video = new Video();
	Object.assign(video, { readyState: 4, videoWidth: 1920, videoHeight: 1080 });
	usePreviewVideoReady({ current: video as unknown as HTMLVideoElement }, "recording.mp4");
	state.setReady.mockClear();
	for (let i = 0; i < 10; i++) {
		video.readyState = 1;
		video.dispatchEvent(new Event("seeked"));
		video.readyState = 2;
		video.dispatchEvent(new Event("loadeddata"));
	}
	expect(state.setReady).not.toHaveBeenCalledWith(false);
	video.dispatchEvent(new Event("error"));
	expect(state.setReady).toHaveBeenLastCalledWith(false);
});
