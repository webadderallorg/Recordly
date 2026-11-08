import { useEffect } from "react";
import { createPlaybackAnimationState } from "./playbackTypes";
import type { usePlaybackLayout } from "./usePlaybackLayout";
import type { usePlaybackState } from "./usePlaybackState";
import { createMotionBlurState } from "./zoomTransform";
export type usePlaybackLayoutEffectsInput = Pick<
	ReturnType<typeof usePlaybackState> & ReturnType<typeof usePlaybackLayout>,
	| "requestPreviewRender"
	| "pixiReady"
	| "videoReady"
	| "animationStateRef"
	| "cursorOverlayRef"
	| "motionBlurStateRef"
	| "layoutVideoContent"
	| "shouldSnapPausedFrameRef"
	| "containerRef"
	| "updateOverlayForRegion"
	| "selectedZoom"
>;
export function usePlaybackLayoutEffects(input: usePlaybackLayoutEffectsInput) {
	const {
		requestPreviewRender,
		pixiReady,
		videoReady,
		animationStateRef,
		cursorOverlayRef,
		motionBlurStateRef,
		layoutVideoContent,
		shouldSnapPausedFrameRef,
		containerRef,
		updateOverlayForRegion,
		selectedZoom,
	} = input;

	useEffect(() => {
		if (!pixiReady || !videoReady) return;

		animationStateRef.current = createPlaybackAnimationState();
		cursorOverlayRef.current?.reset();
		motionBlurStateRef.current = createMotionBlurState();
		layoutVideoContent();
		// The next ticker frame applies the current zoom; layout must never stop playback.
		shouldSnapPausedFrameRef.current = true;
		requestPreviewRender();
	}, [
		pixiReady,
		videoReady,
		layoutVideoContent,
		animationStateRef,
		cursorOverlayRef,
		motionBlurStateRef,
		shouldSnapPausedFrameRef,
		requestPreviewRender,
	]);

	useEffect(() => {
		if (!pixiReady || !videoReady) return;
		const container = containerRef.current;
		if (!container) return;

		if (typeof ResizeObserver === "undefined") {
			return;
		}

		const observer = new ResizeObserver(() => {
			layoutVideoContent();
		});

		observer.observe(container);
		return () => {
			observer.disconnect();
		};
	}, [pixiReady, videoReady, layoutVideoContent, containerRef]);

	useEffect(() => {
		if (!pixiReady || !videoReady) return;
		updateOverlayForRegion(selectedZoom);
	}, [selectedZoom, pixiReady, videoReady, updateOverlayForRegion]);
	return {};
}
