import { useEffect } from "react";
import { flushSync } from "react-dom";
import { type ZoomFocus } from "../types";
import { computeCameraTransform } from "./cameraTransform";
import { type CursorFollowCameraState, createCursorFollowCameraState } from "./cursorFollowCamera";
import { getFrameMotionSample } from "./frameMotionSample";
import type { PlaybackProps } from "./playbackProps";
import { createPreviewRenderLoop } from "./previewRenderLoop";
import {
	resolvePreviewMotionMode,
	resolveSceneZoomTarget,
	shouldComposePreviewFrame,
} from "./sceneMotion";
import type { usePlaybackState } from "./usePlaybackState";
import type { usePlaybackWebcamLayout } from "./usePlaybackWebcamLayout";
import { findDominantRegion } from "./zoomRegionUtils";
import { applyZoomTransform, computeZoomTransform } from "./zoomTransform";
export type usePlaybackTickerInput = Pick<
	ReturnType<typeof usePlaybackState> &
		ReturnType<typeof usePlaybackWebcamLayout> &
		PlaybackProps,
	| "isPlaying"
	| "suspendRendering"
	| "previewRenderLoopRef"
	| "pixiReady"
	| "videoReady"
	| "composedFrameRef"
	| "appRef"
	| "videoSpriteRef"
	| "videoEffectsContainerRef"
	| "videoContainerRef"
	| "cameraContainerRef"
	| "animationStateRef"
	| "zoomBlurFilterRef"
	| "motionBlurFilterRef"
	| "stageSizeRef"
	| "baseMaskRef"
	| "isPlayingRef"
	| "zoomMotionBlurRef"
	| "zoomMotionBlurTuningRef"
	| "motionBlurStateRef"
	| "timelineTimeRef"
	| "annotationFrameStore"
	| "suspendRenderingRef"
	| "lastRenderedContentTimeRef"
	| "isSeekingRef"
	| "shouldSnapPausedFrameRef"
	| "zoomClassicModeRef"
	| "videoRef"
	| "cursorFollowCameraNeedsResetRef"
	| "cursorFollowCameraRef"
	| "clipRegionsRef"
	| "zoomRegionsRef"
	| "connectZoomsRef"
	| "zoomInDurationMsRef"
	| "zoomOutDurationMsRef"
	| "connectedZoomGapMsRef"
	| "connectedZoomDurationMsRef"
	| "cursorTelemetryRef"
	| "currentTimeRef"
	| "zoomSmoothnessRef"
	| "cameraSpringStiffnessMultiplierRef"
	| "cameraSpringDampingMultiplierRef"
	| "cameraSpringMassMultiplierRef"
	| "springScaleRef"
	| "springXRef"
	| "springYRef"
	| "applyWebcamBubbleLayout"
	| "cursorOverlayRef"
	| "showCursorRef"
	| "updatePreviewTextureRef"
>;
export function usePlaybackTicker(input: usePlaybackTickerInput) {
	const {
		composedFrameRef,
		pixiReady,
		videoReady,
		appRef,
		videoSpriteRef,
		videoEffectsContainerRef,
		videoContainerRef,
		cameraContainerRef,
		animationStateRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		stageSizeRef,
		baseMaskRef,
		isPlayingRef,
		zoomMotionBlurRef,
		zoomMotionBlurTuningRef,
		motionBlurStateRef,
		timelineTimeRef,
		annotationFrameStore,
		suspendRenderingRef,
		lastRenderedContentTimeRef,
		isSeekingRef,
		shouldSnapPausedFrameRef,
		zoomClassicModeRef,
		videoRef,
		cursorFollowCameraNeedsResetRef,
		cursorFollowCameraRef,
		clipRegionsRef,
		zoomRegionsRef,
		connectZoomsRef,
		zoomInDurationMsRef,
		zoomOutDurationMsRef,
		connectedZoomGapMsRef,
		connectedZoomDurationMsRef,
		cursorTelemetryRef,
		currentTimeRef,
		zoomSmoothnessRef,
		cameraSpringStiffnessMultiplierRef,
		cameraSpringDampingMultiplierRef,
		cameraSpringMassMultiplierRef,
		springScaleRef,
		springXRef,
		springYRef,
		applyWebcamBubbleLayout,
		cursorOverlayRef,
		showCursorRef,
		updatePreviewTextureRef,
		previewRenderLoopRef,
		isPlaying,
		suspendRendering,
	} = input;

	useEffect(() => {
		if (!pixiReady || !videoReady) return;

		const app = appRef.current;
		const videoSprite = videoSpriteRef.current;
		const videoEffectsContainer = videoEffectsContainerRef.current;
		const videoContainer = videoContainerRef.current;
		if (!app || !videoSprite || !videoEffectsContainer || !videoContainer) return;

		const applyTransform = (
			transform: { scale: number; x: number; y: number },
			focus: ZoomFocus,
			motionSample?: {
				previousTransform: { scale: number; x: number; y: number };
				deltaMs: number;
			} | null,
		) => {
			const cameraContainer = cameraContainerRef.current;
			if (!cameraContainer) return;

			const state = animationStateRef.current;

			const appliedTransform = applyZoomTransform({
				cameraContainer,
				zoomBlurFilter: zoomBlurFilterRef.current,
				motionBlurFilter: motionBlurFilterRef.current,
				stageSize: stageSizeRef.current,
				baseMask: baseMaskRef.current,
				zoomScale: state.scale,
				zoomProgress: state.progress,
				focusX: focus.cx,
				focusY: focus.cy,
				isPlaying: isPlayingRef.current,
				motionBlurAmount: zoomMotionBlurRef.current,
				motionBlurTuning: zoomMotionBlurTuningRef.current,
				transformOverride: transform,
				motionBlurState: motionBlurStateRef.current,
				frameTimeMs: timelineTimeRef.current * 1000,
				motionSample,
			});

			state.x = appliedTransform.x;
			state.y = appliedTransform.y;
			state.appliedScale = appliedTransform.scale;
		};

		const ticker = () => {
			if (suspendRenderingRef.current) {
				return;
			}

			// The export compositor advances exactly once for each output timestamp.
			// Do the same here: repeated Pixi ticks at one media timestamp must not
			// advance cursor springs or clear the blur calculated for that frame.
			const contentTimeMs = timelineTimeRef.current * 1000;
			const previousContentTimeMs = lastRenderedContentTimeRef.current;
			const deltaMs =
				previousContentTimeMs !== null ? contentTimeMs - previousContentTimeMs : 1000 / 60;
			const contentTimeChanged = previousContentTimeMs === null || Math.abs(deltaMs) > 0.0001;
			const motionMode = resolvePreviewMotionMode({
				isPlaying: isPlayingRef.current,
				isSeeking: isSeekingRef.current,
				shouldSnapPausedFrame: shouldSnapPausedFrameRef.current,
				zoomClassicMode: zoomClassicModeRef.current,
			});
			// A delayed renderer may pause after the envelope ended while still
			// displaying its previous zoomed frame. Finish only that neutral frame;
			// ordinary pauses within a zoom continue to preserve their exact pose.
			const hasPendingNeutralFrame =
				motionMode === "preserve" &&
				contentTimeChanged &&
				animationStateRef.current.progress > 0 &&
				findDominantRegion(zoomRegionsRef.current, contentTimeMs, {
					connectZooms: connectZoomsRef.current,
					zoomInDurationMs: zoomInDurationMsRef.current,
					zoomOutDurationMs: zoomOutDurationMsRef.current,
					connectedZoomGapMs: connectedZoomGapMsRef.current,
					connectedZoomDurationMs: connectedZoomDurationMsRef.current,
				}).strength === 0;
			if (
				!shouldComposePreviewFrame({
					motionMode,
					isSeeking: isSeekingRef.current || Boolean(videoRef.current?.seeking),
					contentTimeChanged,
					shouldSnapPausedFrame: shouldSnapPausedFrameRef.current,
					hasPendingNeutralFrame,
				})
			) {
				return;
			}
			lastRenderedContentTimeRef.current = contentTimeMs;
			updatePreviewTextureRef.current?.();

			const sampleFrozenFrame =
				motionMode === "snap" &&
				(!isPlayingRef.current || shouldSnapPausedFrameRef.current);
			if (sampleFrozenFrame) {
				// Frozen frames use independent camera samples. Resume from that new
				// position instead of retaining full-zoom focus from before a seek.
				cursorFollowCameraNeedsResetRef.current = true;
			} else if (motionMode === "spring" && cursorFollowCameraNeedsResetRef.current) {
				cursorFollowCameraRef.current = createCursorFollowCameraState();
				cursorFollowCameraNeedsResetRef.current = false;
			}
			const frameSample = sampleFrozenFrame
				? getFrameMotionSample(contentTimeMs, clipRegionsRef.current)
				: null;
			const resolveTarget = (
				timeMs: number,
				cursorTimeMs: number,
				cursorFollowCamera: CursorFollowCameraState,
			) =>
				resolveSceneZoomTarget({
					zoomRegions: zoomRegionsRef.current,
					timeMs,
					cursorTimeMs,
					connectZooms: connectZoomsRef.current,
					zoomInDurationMs: zoomInDurationMsRef.current,
					zoomOutDurationMs: zoomOutDurationMsRef.current,
					connectedZoomGapMs: connectedZoomGapMsRef.current,
					connectedZoomDurationMs: connectedZoomDurationMsRef.current,
					zoomClassicMode: zoomClassicModeRef.current,
					cursorTelemetry: cursorTelemetryRef.current,
					cursorFollowCamera,
					sourceCrop: baseMaskRef.current.sourceCrop,
				});

			const target = resolveTarget(
				contentTimeMs,
				currentTimeRef.current,
				sampleFrozenFrame ? createCursorFollowCameraState() : cursorFollowCameraRef.current,
			);
			const previousTarget = frameSample
				? resolveTarget(
						frameSample.previousTimeMs,
						frameSample.previousSourceTimeMs,
						createCursorFollowCameraState(),
					)
				: null;
			const motionSample = sampleFrozenFrame
				? frameSample && previousTarget
					? {
							previousTransform: computeZoomTransform({
								stageSize: stageSizeRef.current,
								baseMask: baseMaskRef.current,
								zoomScale: previousTarget.scale,
								zoomProgress: previousTarget.progress,
								focusX: previousTarget.focus.cx,
								focusY: previousTarget.focus.cy,
							}),
							deltaMs: frameSample.deltaMs,
						}
					: null
				: undefined;

			const state = animationStateRef.current;

			state.scale = target.scale;
			state.focusX = target.focus.cx;
			state.focusY = target.focus.cy;
			state.progress = target.progress;

			// The timeline bounds zoom amplitude; connected focus/depth goals use
			// the live camera springs and retain their momentum across blocks.
			const transform = computeCameraTransform({
				target,
				stageSize: stageSizeRef.current,
				baseMask: baseMaskRef.current,
				springScale: springScaleRef.current,
				springX: springXRef.current,
				springY: springYRef.current,
				deltaMs,
				snap: motionMode === "snap",
				zoomSmoothness: zoomSmoothnessRef.current,
				tuning: {
					stiffnessMultiplier: cameraSpringStiffnessMultiplierRef.current,
					dampingMultiplier: cameraSpringDampingMultiplierRef.current,
					massMultiplier: cameraSpringMassMultiplierRef.current,
				},
			});
			applyTransform(transform, target.focus, motionSample);

			applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);

			const timeMs = currentTimeRef.current;
			const cursorOverlay = cursorOverlayRef.current;
			if (cursorOverlay) {
				cursorOverlay.update(
					cursorTelemetryRef.current,
					timeMs,
					baseMaskRef.current,
					showCursorRef.current,
					isSeekingRef.current || shouldSnapPausedFrameRef.current,
					sampleFrozenFrame ? (frameSample?.previousSourceTimeMs ?? null) : undefined,
				);
			}

			// Seeking events request one exact composition. Further Pixi ticks at the
			// same media timestamp must hold it just like an exported frame.
			if (shouldSnapPausedFrameRef.current) {
				shouldSnapPausedFrameRef.current = false;
			}

			// Synchronize only the subscribed overlay with the GPU frame. An empty
			// annotation list has no React subscribers and needs no synchronous commit.
			const frame = {
				timeMs: contentTimeMs,
				transform: { scale: state.appliedScale, x: state.x, y: state.y },
			};
			if (annotationFrameStore.hasSubscribers()) {
				flushSync(() => annotationFrameStore.publish(frame));
			} else {
				annotationFrameStore.publish(frame);
			}
			// A render/resize alone is not a new composition of the video and overlays.
			composedFrameRef.current = {
				revision: (composedFrameRef.current?.revision ?? 0) + 1,
				width: stageSizeRef.current.width,
				height: stageSizeRef.current.height,
				source: videoRef.current?.currentSrc ?? "",
			};
		};

		const loop = createPreviewRenderLoop({
			ticker: app.ticker,
			compose: ticker,
			render: () => app.render(),
			requestFrame: (callback) => requestAnimationFrame(callback),
			cancelFrame: (id) => cancelAnimationFrame(id),
		});
		previewRenderLoopRef.current = loop;
		app.ticker.add(ticker);
		loop.setState(isPlayingRef.current, suspendRenderingRef.current);
		loop.requestRender();
		return () => {
			if (previewRenderLoopRef.current === loop) previewRenderLoopRef.current = null;
			loop.dispose();
			app.ticker?.remove(ticker);
		};
	}, [
		composedFrameRef,
		pixiReady,
		videoReady,
		applyWebcamBubbleLayout,
		appRef,
		videoSpriteRef,
		videoEffectsContainerRef,
		videoContainerRef,
		cameraContainerRef,
		animationStateRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		stageSizeRef,
		baseMaskRef,
		isPlayingRef,
		zoomMotionBlurRef,
		zoomMotionBlurTuningRef,
		motionBlurStateRef,
		timelineTimeRef,
		annotationFrameStore,
		suspendRenderingRef,
		lastRenderedContentTimeRef,
		isSeekingRef,
		shouldSnapPausedFrameRef,
		zoomClassicModeRef,
		videoRef,
		cursorFollowCameraNeedsResetRef,
		cursorFollowCameraRef,
		clipRegionsRef,
		zoomRegionsRef,
		connectZoomsRef,
		zoomInDurationMsRef,
		zoomOutDurationMsRef,
		connectedZoomGapMsRef,
		connectedZoomDurationMsRef,
		cursorTelemetryRef,
		currentTimeRef,
		zoomSmoothnessRef,
		cameraSpringStiffnessMultiplierRef,
		cameraSpringDampingMultiplierRef,
		cameraSpringMassMultiplierRef,
		springScaleRef,
		springXRef,
		springYRef,
		cursorOverlayRef,
		showCursorRef,
		updatePreviewTextureRef,
		previewRenderLoopRef,
	]);

	useEffect(() => {
		if (!pixiReady || !videoReady) return;
		previewRenderLoopRef.current?.setState(isPlaying, suspendRendering);
	}, [isPlaying, suspendRendering, previewRenderLoopRef, pixiReady, videoReady]);
	return {};
}
