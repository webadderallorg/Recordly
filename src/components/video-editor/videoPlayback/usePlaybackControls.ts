import type React from "react";
import { useImperativeHandle } from "react";
import { type ZoomFocus } from "../types";
import { clamp01 } from "./mathUtils";
import { annotationPlacement } from "../annotationPlacement";
import type { PlaybackProps } from "./playbackProps";
import { type VideoPlaybackRef } from "./playbackTypes";
import type { usePlaybackCaptions } from "./usePlaybackCaptions";
import type { usePlaybackLayout } from "./usePlaybackLayout";
import type { usePlaybackState } from "./usePlaybackState";
export type usePlaybackControlsInput = Pick<
	ReturnType<typeof usePlaybackState> &
		ReturnType<typeof usePlaybackLayout> &
		ReturnType<typeof usePlaybackCaptions> &
		PlaybackProps,
	| "clipPlaybackRef"
	| "containerRef"
	| "cancelCaptionEdit"
	| "videoRef"
	| "appRef"
	| "videoSpriteRef"
	| "videoContainerRef"
	| "overlayRef"
	| "selectedZoomIdRef"
	| "zoomRegionsRef"
	| "stageSizeRef"
	| "baseMaskRef"
	| "clampFocusToStage"
	| "onZoomFocusChange"
	| "updateOverlayForRegion"
	| "isPlayingRef"
	| "onSelectZoom"
	| "isDraggingFocusRef"
	| "shouldSnapPausedFrameRef"
	| "annotationFrameStore"
> & { ref: React.ForwardedRef<VideoPlaybackRef> };
export function usePlaybackControls(input: usePlaybackControlsInput) {
	const {
		ref,
		containerRef,
		cancelCaptionEdit,
		clipPlaybackRef,
		videoRef,
		appRef,
		videoSpriteRef,
		videoContainerRef,
		overlayRef,
		selectedZoomIdRef,
		zoomRegionsRef,
		stageSizeRef,
		baseMaskRef,
		clampFocusToStage,
		onZoomFocusChange,
		updateOverlayForRegion,
		isPlayingRef,
		onSelectZoom,
		isDraggingFocusRef,
		shouldSnapPausedFrameRef,
		annotationFrameStore,
	} = input;

	useImperativeHandle(ref, () => ({
		get isPlaying() {
			return clipPlaybackRef.current?.isPlaying ?? false;
		},
		seekTimeline: (time) => {
			// Seeking to an already-decoded source frame may emit no media event.
			shouldSnapPausedFrameRef.current = true;
			clipPlaybackRef.current?.seek(time);
		},
		get video() {
			return videoRef.current;
		},
		get app() {
			return appRef.current;
		},
		get videoSprite() {
			return videoSpriteRef.current;
		},
		get videoContainer() {
			return videoContainerRef.current;
		},
		containerRef,
		play: async () => {
			await clipPlaybackRef.current?.play();
		},
		pause: () => {
			clipPlaybackRef.current?.pause();
		},
		cancelCaptionEdit,
		getAnnotationPlacement: () =>
			annotationPlacement(
				stageSizeRef.current,
				baseMaskRef.current,
				annotationFrameStore.getSnapshot().transform,
			),
		refreshFrame: async () => {
			const video = videoRef.current;
			if (!video || Number.isNaN(video.currentTime)) {
				return;
			}

			const restoreTime = video.currentTime;
			const duration = Number.isFinite(video.duration) ? video.duration : 0;
			const epsilon = duration > 0 ? Math.min(1 / 120, duration / 1000 || 1 / 120) : 1 / 120;
			const nudgeTarget =
				restoreTime > epsilon
					? restoreTime - epsilon
					: Math.min(duration || restoreTime + epsilon, restoreTime + epsilon);

			if (Math.abs(nudgeTarget - restoreTime) < 0.000001) {
				return;
			}

			await new Promise<void>((resolve) => {
				const handleFirstSeeked = () => {
					video.removeEventListener("seeked", handleFirstSeeked);
					const handleSecondSeeked = () => {
						video.removeEventListener("seeked", handleSecondSeeked);
						video.pause();
						resolve();
					};

					video.addEventListener("seeked", handleSecondSeeked, {
						once: true,
					});
					video.currentTime = restoreTime;
				};

				video.addEventListener("seeked", handleFirstSeeked, { once: true });
				video.currentTime = nudgeTarget;
			});
		},
	}));

	const updateFocusFromClientPoint = (clientX: number, clientY: number) => {
		const overlayEl = overlayRef.current;
		if (!overlayEl) return;

		const regionId = selectedZoomIdRef.current;
		if (!regionId) return;

		const region = zoomRegionsRef.current.find((r) => r.id === regionId);
		if (!region) return;

		const rect = overlayEl.getBoundingClientRect();
		const stageWidth = rect.width;
		const stageHeight = rect.height;

		if (!stageWidth || !stageHeight) {
			return;
		}

		stageSizeRef.current = { width: stageWidth, height: stageHeight };

		const localX = clientX - rect.left;
		const localY = clientY - rect.top;
		const baseMask = baseMaskRef.current;

		const unclampedFocus: ZoomFocus = {
			cx: clamp01((localX - baseMask.x) / Math.max(1, baseMask.width)),
			cy: clamp01((localY - baseMask.y) / Math.max(1, baseMask.height)),
		};
		const clampedFocus = clampFocusToStage(unclampedFocus, region.depth);

		onZoomFocusChange(region.id, clampedFocus);
		updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
	};

	const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (isPlayingRef.current) return;
		const regionId = selectedZoomIdRef.current;
		if (!regionId) return;
		const region = zoomRegionsRef.current.find((r) => r.id === regionId);
		if (!region || region.mode !== "manual") return;
		onSelectZoom(region.id);
		event.preventDefault();
		isDraggingFocusRef.current = true;
		event.currentTarget.setPointerCapture(event.pointerId);
		updateFocusFromClientPoint(event.clientX, event.clientY);
	};

	const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!isDraggingFocusRef.current) return;
		event.preventDefault();
		updateFocusFromClientPoint(event.clientX, event.clientY);
	};

	const endFocusDrag = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!isDraggingFocusRef.current) return;
		isDraggingFocusRef.current = false;
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {
			/* Pointer capture may already be released during drag cleanup. */
		}
	};

	const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		endFocusDrag(event);
	};

	const handleOverlayPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
		endFocusDrag(event);
	};
	return {
		updateFocusFromClientPoint,
		handleOverlayPointerDown,
		handleOverlayPointerMove,
		endFocusDrag,
		handleOverlayPointerUp,
		handleOverlayPointerLeave,
	};
}
