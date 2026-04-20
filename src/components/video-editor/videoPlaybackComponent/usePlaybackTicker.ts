import { useEffect } from "react";
import { extensionHost } from "@/lib/extensions";
import { mapCursorToCanvasNormalized, mapSmoothedCursorToCanvasNormalized } from "@/lib/extensions/cursorCoordinates";
import {
	clearCursorEffects,
	executeExtensionCursorEffects,
	executeExtensionRenderHooks,
	notifyCursorInteraction,
} from "@/lib/extensions/renderHooks";
import { applyCanvasSceneTransform } from "@/lib/extensions/sceneTransform";
import { DEFAULT_FOCUS } from "../videoPlayback/constants";
import { computeCursorFollowFocus, SNAP_TO_EDGES_RATIO_AUTO } from "../videoPlayback/cursorFollowCamera";
import { applyZoomTransform, computeFocusFromTransform, computeZoomTransform } from "../videoPlayback/zoomTransform";
import { getZoomSpringConfig, resetSpringState, stepSpringValue } from "../videoPlayback/motionSmoothing";
import { findDominantRegion } from "../videoPlayback/zoomRegionUtils";
import { ZOOM_DEPTH_SCALES } from "../types";
import { getCursorPositionAtTime, type VideoPlaybackRuntimeRefs } from "./shared";

interface UsePlaybackTickerParams {
	refs: VideoPlaybackRuntimeRefs;
	pixiReady: boolean;
	videoReady: boolean;
	borderRadius: number;
	padding: number;
	showShadow?: boolean;
	shadowIntensity: number;
	applyWebcamBubbleLayout: (zoomScale: number) => void;
}

export function usePlaybackTicker({
	refs,
	pixiReady,
	videoReady,
	borderRadius,
	padding,
	showShadow,
	shadowIntensity,
	applyWebcamBubbleLayout,
}: UsePlaybackTickerParams) {
	useEffect(() => {
		if (!pixiReady || !videoReady) return;

		const app = refs.appRef.current;
		const videoSprite = refs.videoSpriteRef.current;
		const videoContainer = refs.videoContainerRef.current;
		if (!app || !videoSprite || !videoContainer) return;

		const applyTransform = (
			transform: { scale: number; x: number; y: number },
			focus: { cx: number; cy: number },
			motionIntensity: number,
			motionVector: { x: number; y: number },
		) => {
			const cameraContainer = refs.cameraContainerRef.current;
			if (!cameraContainer) return;

			const state = refs.animationStateRef.current;
			const appliedTransform = applyZoomTransform({
				cameraContainer,
				blurFilter: refs.blurFilterRef.current,
				stageSize: refs.stageSizeRef.current,
				baseMask: refs.baseMaskRef.current,
				zoomScale: state.scale,
				zoomProgress: state.progress,
				focusX: focus.cx,
				focusY: focus.cy,
				motionIntensity,
				motionVector,
				isPlaying: refs.isPlayingRef.current,
				motionBlurAmount: refs.zoomMotionBlurRef.current,
				motionBlurFilter: refs.motionBlurFilterRef.current,
				transformOverride: transform,
				motionBlurState: refs.motionBlurStateRef.current,
				frameTimeMs: performance.now(),
			});

			state.x = appliedTransform.x;
			state.y = appliedTransform.y;
			state.appliedScale = appliedTransform.scale;
		};

		const ticker = () => {
			const { region, strength, blendedScale, transition } = findDominantRegion(
				refs.zoomRegionsRef.current,
				refs.currentTimeRef.current,
				{ connectZooms: refs.connectZoomsRef.current },
			);

			let targetScaleFactor = 1;
			let targetFocus = DEFAULT_FOCUS;
			let targetProgress = 0;
			const hasSelectedZoom = refs.selectedZoomIdRef.current !== null;
			const shouldShowUnzoomedView = hasSelectedZoom && !refs.isPlayingRef.current;

			if (region && strength > 0 && !shouldShowUnzoomedView) {
				const zoomScale = blendedScale ?? ZOOM_DEPTH_SCALES[region.depth] ?? 1;
				let regionFocus = region.focus;
				if (
					!refs.zoomClassicModeRef.current &&
					region.mode !== "manual" &&
					refs.cursorTelemetryRef.current.length > 0
				) {
					regionFocus = computeCursorFollowFocus(
						refs.cursorFollowCameraRef.current,
						refs.cursorTelemetryRef.current,
						refs.currentTimeRef.current,
						zoomScale,
						strength,
						region.focus,
						{ snapToEdgesRatio: SNAP_TO_EDGES_RATIO_AUTO },
					);
				}

				targetScaleFactor = zoomScale;
				targetFocus = regionFocus;
				targetProgress = strength;

				if (transition) {
					const startTransform = computeZoomTransform({
						stageSize: refs.stageSizeRef.current,
						baseMask: refs.baseMaskRef.current,
						zoomScale: transition.startScale,
						zoomProgress: 1,
						focusX: transition.startFocus.cx,
						focusY: transition.startFocus.cy,
					});
					const endTransform = computeZoomTransform({
						stageSize: refs.stageSizeRef.current,
						baseMask: refs.baseMaskRef.current,
						zoomScale: transition.endScale,
						zoomProgress: 1,
						focusX: transition.endFocus.cx,
						focusY: transition.endFocus.cy,
					});

					const interpolatedTransform = {
						scale: startTransform.scale + (endTransform.scale - startTransform.scale) * transition.progress,
						x: startTransform.x + (endTransform.x - startTransform.x) * transition.progress,
						y: startTransform.y + (endTransform.y - startTransform.y) * transition.progress,
					};

					targetScaleFactor = interpolatedTransform.scale;
					targetFocus = computeFocusFromTransform({
						stageSize: refs.stageSizeRef.current,
						baseMask: refs.baseMaskRef.current,
						zoomScale: interpolatedTransform.scale,
						x: interpolatedTransform.x,
						y: interpolatedTransform.y,
					});
					targetProgress = 1;
				}
			}

			const state = refs.animationStateRef.current;
			const prevScale = state.appliedScale;
			const prevX = state.x;
			const prevY = state.y;

			state.scale = targetScaleFactor;
			state.focusX = targetFocus.cx;
			state.focusY = targetFocus.cy;
			state.progress = targetProgress;

			extensionHost.setZoomState({
				scale: targetScaleFactor,
				focusX: targetFocus.cx,
				focusY: targetFocus.cy,
				progress: targetProgress,
			});

			const projectedTransform = computeZoomTransform({
				stageSize: refs.stageSizeRef.current,
				baseMask: refs.baseMaskRef.current,
				zoomScale: state.scale,
				zoomProgress: state.progress,
				focusX: state.focusX,
				focusY: state.focusY,
			});

			const now = performance.now();
			const deltaMs = refs.lastTickTimeRef.current !== null ? now - refs.lastTickTimeRef.current : 1000 / 60;
			refs.lastTickTimeRef.current = now;

			const zoomSpringConfig = getZoomSpringConfig(refs.zoomSmoothnessRef.current);
			const useSpring = refs.isPlayingRef.current && !refs.isSeekingRef.current && !refs.zoomClassicModeRef.current;

			let appliedScale: number;
			let appliedX: number;
			let appliedY: number;

			if (useSpring) {
				appliedScale = stepSpringValue(refs.springScaleRef.current, projectedTransform.scale, deltaMs, zoomSpringConfig);
				appliedX = stepSpringValue(refs.springXRef.current, projectedTransform.x, deltaMs, zoomSpringConfig);
				appliedY = stepSpringValue(refs.springYRef.current, projectedTransform.y, deltaMs, zoomSpringConfig);
			} else {
				appliedScale = projectedTransform.scale;
				appliedX = projectedTransform.x;
				appliedY = projectedTransform.y;
				resetSpringState(refs.springScaleRef.current, appliedScale);
				resetSpringState(refs.springXRef.current, appliedX);
				resetSpringState(refs.springYRef.current, appliedY);
			}

			const motionIntensity = Math.max(
				Math.abs(appliedScale - prevScale),
				Math.abs(appliedX - prevX) / Math.max(1, refs.stageSizeRef.current.width),
				Math.abs(appliedY - prevY) / Math.max(1, refs.stageSizeRef.current.height),
			);

			const motionVector = { x: appliedX - prevX, y: appliedY - prevY };
			applyTransform({ scale: appliedScale, x: appliedX, y: appliedY }, targetFocus, motionIntensity, motionVector);
			applyWebcamBubbleLayout(refs.animationStateRef.current.appliedScale || 1);

			const timeMs = refs.currentTimeRef.current;
			const effectsCanvas = refs.cursorEffectsCanvasRef.current;
			const extensionCanvasWidth = effectsCanvas?.width || refs.stageSizeRef.current.width;
			const extensionCanvasHeight = effectsCanvas?.height || refs.stageSizeRef.current.height;
			let smoothedCursorForHooks: { cx: number; cy: number; trail: Array<{ cx: number; cy: number }> } | null = null;

			const cursorOverlay = refs.cursorOverlayRef.current;
			if (cursorOverlay) {
				const telemetry = refs.cursorTelemetryRef.current;
				cursorOverlay.update(
					telemetry,
					timeMs,
					refs.baseMaskRef.current,
					refs.showCursorRef.current,
					!refs.isPlayingRef.current || refs.isSeekingRef.current,
				);

				smoothedCursorForHooks = mapSmoothedCursorToCanvasNormalized(cursorOverlay.getSmoothedCursorSnapshot(), {
					maskRect: refs.baseMaskRef.current,
					canvasWidth: extensionCanvasWidth,
					canvasHeight: extensionCanvasHeight,
				});
				extensionHost.setSmoothedCursor(
					smoothedCursorForHooks
						? {
								timeMs,
								cx: smoothedCursorForHooks.cx,
								cy: smoothedCursorForHooks.cy,
								trail: smoothedCursorForHooks.trail,
							}
						: null,
				);

				if (refs.isPlayingRef.current && telemetry.length > 0) {
					for (let index = telemetry.length - 1; index >= 0; index--) {
						const point = telemetry[index];
						if (point.timeMs > timeMs) continue;
						if (point.timeMs < timeMs - 100) break;
						if (point.interactionType && point.interactionType !== "move" && point.timeMs !== refs.lastEmittedClickTimeMsRef.current) {
							const extensionCursor = mapCursorToCanvasNormalized(
								{
									cx: point.cx,
									cy: point.cy,
									interactionType: point.interactionType,
								},
								{
									maskRect: refs.baseMaskRef.current,
									canvasWidth: extensionCanvasWidth,
									canvasHeight: extensionCanvasHeight,
								},
							);
							refs.lastEmittedClickTimeMsRef.current = point.timeMs;
							extensionHost.emitEvent({
								type: "cursor:click",
								timeMs: point.timeMs,
								data: extensionCursor,
							});
							if (extensionCursor) {
								notifyCursorInteraction(point.timeMs, extensionCursor.cx, extensionCursor.cy, point.interactionType);
							}
						}
						break;
					}
				}
			} else {
				extensionHost.setSmoothedCursor(null);
			}

			if (effectsCanvas && effectsCanvas.width > 0 && effectsCanvas.height > 0) {
				const context2d = effectsCanvas.getContext("2d");
				if (context2d) {
					context2d.clearRect(0, 0, effectsCanvas.width, effectsCanvas.height);

					const maskRect = refs.baseMaskRef.current;
					const animationState = refs.animationStateRef.current;
					const videoInfo = extensionHost.getVideoInfoSnapshot();
					const rawCursor = getCursorPositionAtTime(refs.cursorTelemetryRef.current, timeMs, {
						maskRect,
						canvasWidth: effectsCanvas.width,
						canvasHeight: effectsCanvas.height,
					});

					const hookParams = {
						width: effectsCanvas.width,
						height: effectsCanvas.height,
						timeMs,
						durationMs: videoInfo?.durationMs ?? 0,
						cursor: smoothedCursorForHooks
							? { cx: smoothedCursorForHooks.cx, cy: smoothedCursorForHooks.cy, interactionType: rawCursor?.interactionType }
							: rawCursor,
						smoothedCursor: smoothedCursorForHooks,
						videoLayout:
							maskRect.width > 0 && maskRect.height > 0
								? {
									maskRect: {
										x: maskRect.x,
										y: maskRect.y,
										width: maskRect.width,
										height: maskRect.height,
									},
									borderRadius,
									padding,
								}
								: undefined,
						zoom: {
							scale: animationState.scale,
							focusX: animationState.focusX,
							focusY: animationState.focusY,
							progress: animationState.progress,
						},
						shadow: {
							enabled: Boolean(showShadow) && shadowIntensity > 0,
							intensity: shadowIntensity,
						},
						sceneTransform: {
							scale: animationState.appliedScale,
							x: animationState.x,
							y: animationState.y,
						},
					};

					context2d.save();
					applyCanvasSceneTransform(context2d, hookParams.sceneTransform);
					executeExtensionRenderHooks("post-video", context2d, hookParams);
					executeExtensionRenderHooks("post-zoom", context2d, hookParams);
					executeExtensionRenderHooks("post-cursor", context2d, hookParams);

					if (refs.isSeekingRef.current) {
						clearCursorEffects();
					} else {
						executeExtensionCursorEffects(context2d, timeMs, effectsCanvas.width, effectsCanvas.height, {
							zoom: hookParams.zoom,
							sceneTransform: hookParams.sceneTransform,
							videoLayout: hookParams.videoLayout,
						});
					}
					context2d.restore();
					executeExtensionRenderHooks("post-webcam", context2d, hookParams);
					executeExtensionRenderHooks("post-annotations", context2d, hookParams);
					executeExtensionRenderHooks("final", context2d, hookParams);
				}
			}
		};

		app.ticker.add(ticker);
		return () => {
			if (app.ticker) {
				app.ticker.remove(ticker);
			}
		};
	}, [applyWebcamBubbleLayout, borderRadius, padding, pixiReady, refs, shadowIntensity, showShadow, videoReady]);
}