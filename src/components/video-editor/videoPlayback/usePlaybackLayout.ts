import { Rectangle } from "pixi.js";
import { useCallback, useEffect, useMemo } from "react";
import { enablePitchPreservingPlayback } from "@/lib/mediaTiming";
import { type ZoomDepth, type ZoomFocus, type ZoomRegion } from "../types";
import { clampFocusToStage as clampFocusToStageUtil } from "./focusUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "./layoutUtils";
import { updateOverlayIndicator } from "./overlayUtils";
import type { PlaybackProps } from "./playbackProps";
import type { usePlaybackState } from "./usePlaybackState";
import type { usePlaybackWebcamLayout } from "./usePlaybackWebcamLayout";
export type usePlaybackLayoutInput = Pick<
	ReturnType<typeof usePlaybackState> &
		ReturnType<typeof usePlaybackWebcamLayout> &
		PlaybackProps,
	| "stageSizeRef"
	| "overlayRef"
	| "focusIndicatorRef"
	| "baseMaskRef"
	| "isPlayingRef"
	| "appRef"
	| "videoEffectsContainerRef"
	| "zoomBlurFilterRef"
	| "motionBlurFilterRef"
	| "cursorOverlayRef"
	| "containerRef"
	| "updatePreviewTextureRef"
	| "videoSpriteRef"
	| "maskGraphicsRef"
	| "videoRef"
	| "cameraContainerRef"
	| "lockedVideoDimensionsRef"
	| "setPreviewViewportWidth"
	| "videoSizeRef"
	| "baseScaleRef"
	| "baseOffsetRef"
	| "setAnnotationRecordingRect"
	| "cropBoundsRef"
	| "selectedZoomIdRef"
	| "zoomRegionsRef"
	| "applyWebcamBubbleLayout"
	| "animationStateRef"
	| "cropRegion"
	| "borderRadius"
	| "padding"
	| "volume"
	| "layoutVideoContentRef"
	| "selectedZoomId"
	| "zoomRegions"
>;
export function usePlaybackLayout(input: usePlaybackLayoutInput) {
	const {
		stageSizeRef,
		overlayRef,
		focusIndicatorRef,
		baseMaskRef,
		isPlayingRef,
		appRef,
		videoEffectsContainerRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		cursorOverlayRef,
		containerRef,
		updatePreviewTextureRef,
		videoSpriteRef,
		maskGraphicsRef,
		videoRef,
		cameraContainerRef,
		lockedVideoDimensionsRef,
		setPreviewViewportWidth,
		videoSizeRef,
		baseScaleRef,
		baseOffsetRef,
		setAnnotationRecordingRect,
		cropBoundsRef,
		selectedZoomIdRef,
		zoomRegionsRef,
		applyWebcamBubbleLayout,
		animationStateRef,
		cropRegion,
		borderRadius,
		padding,
		volume,
		layoutVideoContentRef,
		selectedZoomId,
		zoomRegions,
	} = input;

	const clampFocusToStage = useCallback(
		(focus: ZoomFocus, depth: ZoomDepth) => {
			return clampFocusToStageUtil(focus, depth, stageSizeRef.current);
		},
		[stageSizeRef],
	);

	const updateOverlayForRegion = useCallback(
		(region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
			const overlayEl = overlayRef.current;
			const indicatorEl = focusIndicatorRef.current;

			if (!overlayEl || !indicatorEl) {
				return;
			}

			// Update stage size from overlay dimensions
			const stageWidth = overlayEl.clientWidth;
			const stageHeight = overlayEl.clientHeight;
			if (stageWidth && stageHeight) {
				stageSizeRef.current = { width: stageWidth, height: stageHeight };
			}

			updateOverlayIndicator({
				overlayEl,
				indicatorEl,
				region,
				focusOverride,
				baseMask: baseMaskRef.current,
				isPlaying: isPlayingRef.current,
			});
		},
		[overlayRef, focusIndicatorRef, stageSizeRef, baseMaskRef, isPlayingRef],
	);

	const syncPreviewMotionBlurQuality = useCallback(() => {
		const app = appRef.current;
		const videoEffectsContainer = videoEffectsContainerRef.current;
		const zoomBlurFilter = zoomBlurFilterRef.current;
		const motionBlurFilter = motionBlurFilterRef.current;

		if (!app || !videoEffectsContainer || !motionBlurFilter || !zoomBlurFilter) {
			return;
		}

		const filterResolution = Math.max(
			1,
			app.renderer.resolution || window.devicePixelRatio || 1,
		);
		const stageWidth = Math.max(1, stageSizeRef.current.width || app.screen.width);
		const stageHeight = Math.max(1, stageSizeRef.current.height || app.screen.height);

		motionBlurFilter.resolution = filterResolution;
		zoomBlurFilter.resolution = filterResolution;
		cursorOverlayRef.current?.setFilterResolution(filterResolution);
		videoEffectsContainer.filterArea = new Rectangle(0, 0, stageWidth, stageHeight);
	}, [
		appRef,
		videoEffectsContainerRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		stageSizeRef,
		cursorOverlayRef,
	]);

	const layoutVideoContent = useCallback(() => {
		const container = containerRef.current;
		const app = appRef.current;
		const videoSprite = videoSpriteRef.current;
		const maskGraphics = maskGraphicsRef.current;
		const videoElement = videoRef.current;
		const cameraContainer = cameraContainerRef.current;

		if (
			!container ||
			!app ||
			!videoSprite ||
			!maskGraphics ||
			!videoElement ||
			!cameraContainer
		) {
			return;
		}

		// Lock video dimensions on first layout to prevent resize issues
		if (
			!lockedVideoDimensionsRef.current &&
			videoElement.videoWidth > 0 &&
			videoElement.videoHeight > 0
		) {
			lockedVideoDimensionsRef.current = {
				width: videoElement.videoWidth,
				height: videoElement.videoHeight,
			};
		}

		const result = layoutVideoContentUtil({
			container,
			app,
			videoSprite,
			maskGraphics,
			videoElement,
			cropRegion,
			lockedVideoDimensions: lockedVideoDimensionsRef.current,
			borderRadius,
			padding,
			frameInsets: null,
		});

		if (result) {
			stageSizeRef.current = result.stageSize;
			setPreviewViewportWidth((current) =>
				Math.abs(current - result.stageSize.width) < 0.5 ? current : result.stageSize.width,
			);
			syncPreviewMotionBlurQuality();
			videoSizeRef.current = result.videoSize;
			baseScaleRef.current = result.baseScale;
			baseOffsetRef.current = result.baseOffset;
			const renderResolution = app.renderer.resolution || window.devicePixelRatio || 1;
			baseMaskRef.current = {
				...result.maskRect,
				renderWidth: result.maskRect.width * renderResolution,
				renderHeight: result.maskRect.height * renderResolution,
			};
			setAnnotationRecordingRect((current) => {
				if (
					Math.abs(current.x - result.maskRect.x) < 0.1 &&
					Math.abs(current.y - result.maskRect.y) < 0.1 &&
					Math.abs(current.width - result.maskRect.width) < 0.1 &&
					Math.abs(current.height - result.maskRect.height) < 0.1
				) {
					return current;
				}

				return {
					x: result.maskRect.x,
					y: result.maskRect.y,
					width: result.maskRect.width,
					height: result.maskRect.height,
				};
			});
			cropBoundsRef.current = result.cropBounds;

			// Layout updates the media geometry, not the composed camera pose.
			// In particular, a ResizeObserver notification while paused must not
			// replace the exported spring position with an unzoomed frame.

			const selectedId = selectedZoomIdRef.current;
			const activeRegion = selectedId
				? (zoomRegionsRef.current.find((region) => region.id === selectedId) ?? null)
				: null;

			updateOverlayForRegion(activeRegion);
			applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);
			// Crop geometry and source privacy coordinates must become visible together.
			updatePreviewTextureRef.current?.();
			if (!app.ticker.started) app.render();
		}
	}, [
		updateOverlayForRegion,
		cropRegion,
		borderRadius,
		padding,
		applyWebcamBubbleLayout,
		syncPreviewMotionBlurQuality,
		containerRef,
		appRef,
		updatePreviewTextureRef,
		videoSpriteRef,
		maskGraphicsRef,
		videoRef,
		cameraContainerRef,
		lockedVideoDimensionsRef,
		stageSizeRef,
		setPreviewViewportWidth,
		videoSizeRef,
		baseScaleRef,
		baseOffsetRef,
		baseMaskRef,
		setAnnotationRecordingRect,
		cropBoundsRef,
		selectedZoomIdRef,
		zoomRegionsRef,
		animationStateRef,
	]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		enablePitchPreservingPlayback(video);
		const nextVolume = Math.max(0, Math.min(1, volume));
		video.volume = nextVolume;
		video.muted = nextVolume <= 0.001;
	}, [volume, videoRef]);

	useEffect(() => {
		layoutVideoContentRef.current = layoutVideoContent;
	}, [layoutVideoContent, layoutVideoContentRef]);

	// Always re-run geometric layout when layout props change, even if frame sprite isn't reloaded.
	useEffect(() => {
		layoutVideoContent();
	}, [layoutVideoContent]);

	const selectedZoom = useMemo(() => {
		if (!selectedZoomId) return null;
		return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
	}, [zoomRegions, selectedZoomId]);
	return {
		clampFocusToStage,
		updateOverlayForRegion,
		syncPreviewMotionBlurQuality,
		layoutVideoContent,
		selectedZoom,
	};
}
