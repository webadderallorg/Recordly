import { forwardRef, useImperativeHandle, useMemo } from "react";
import {
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_EASING,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_CURSOR_SMOOTHING,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_IN_EASING,
	DEFAULT_ZOOM_IN_OVERLAP_MS,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_OUT_EASING,
} from "../types";
import { getEffectiveNativeAspectRatio, type VideoPlaybackProps, type VideoPlaybackRef } from "./shared";
import { useVideoPlaybackRefs } from "./useVideoPlaybackRefs";
import { useCaptionLayout } from "./useCaptionLayout";
import { useResolvedWallpaper } from "./useResolvedWallpaper";
import { useVideoPlaybackLayout } from "./useVideoPlaybackLayout";
import { useVideoPlaybackSync } from "./useVideoPlaybackSync";
import { usePixiApp } from "./usePixiApp";
import { useVideoElementLifecycle } from "./useVideoElementLifecycle";
import { usePixiVideoScene } from "./usePixiVideoScene";
import { usePlaybackTicker } from "./usePlaybackTicker";
import { useCursorOverlayRefresh } from "./useCursorOverlayRefresh";
import { VideoPlaybackOverlay } from "./VideoPlaybackOverlay";

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(function VideoPlayback(
	{
		videoPath,
		onDurationChange,
		onPreviewReadyChange,
		onTimeUpdate,
		currentTime,
		onPlayStateChange,
		onError,
		wallpaper,
		zoomRegions,
		selectedZoomId,
		onSelectZoom,
		onZoomFocusChange,
		isPlaying,
		showShadow,
		shadowIntensity = 0,
		backgroundBlur = 0,
		zoomMotionBlur = 0,
		connectZooms = true,
		zoomInDurationMs = DEFAULT_ZOOM_IN_DURATION_MS,
		zoomInOverlapMs = DEFAULT_ZOOM_IN_OVERLAP_MS,
		zoomOutDurationMs = DEFAULT_ZOOM_OUT_DURATION_MS,
		connectedZoomGapMs = DEFAULT_CONNECTED_ZOOM_GAP_MS,
		connectedZoomDurationMs = DEFAULT_CONNECTED_ZOOM_DURATION_MS,
		zoomInEasing = DEFAULT_ZOOM_IN_EASING,
		zoomOutEasing = DEFAULT_ZOOM_OUT_EASING,
		connectedZoomEasing = DEFAULT_CONNECTED_ZOOM_EASING,
		borderRadius = 0,
		padding = 50,
		frame = null,
		cropRegion,
		webcam,
		webcamVideoPath,
		trimRegions = [],
		speedRegions = [],
		aspectRatio,
		annotationRegions = [],
		autoCaptions = [],
		autoCaptionSettings,
		selectedAnnotationId,
		onSelectAnnotation,
		onAnnotationPositionChange,
		onAnnotationSizeChange,
		cursorTelemetry = [],
		showCursor = false,
		cursorStyle = "tahoe",
		cursorSize = DEFAULT_CURSOR_SIZE,
		cursorSmoothing = DEFAULT_CURSOR_SMOOTHING,
		zoomSmoothness = 0.5,
		zoomClassicMode = false,
		cursorMotionBlur = DEFAULT_CURSOR_MOTION_BLUR,
		cursorClickBounce = DEFAULT_CURSOR_CLICK_BOUNCE,
		cursorClickBounceDuration = DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
		cursorSway = DEFAULT_CURSOR_SWAY,
		volume = 1,
	},
	ref,
) {
	const {
		refs,
		pixiReady,
		setPixiReady,
		videoReady,
		setVideoReady,
		resolvedWallpaper,
		setResolvedWallpaper,
		resolvedWallpaperKind,
		setResolvedWallpaperKind,
	} = useVideoPlaybackRefs({
		frame,
		isPlaying,
		zoomRegions,
		selectedZoomId,
		trimRegions,
		speedRegions,
		zoomMotionBlur,
		connectZooms,
		zoomInDurationMs,
		zoomInOverlapMs,
		zoomOutDurationMs,
		connectedZoomGapMs,
		connectedZoomDurationMs,
		zoomInEasing,
		zoomOutEasing,
		connectedZoomEasing,
		cursorTelemetry,
		showCursor,
		cursorStyle,
		cursorSize,
		cursorSmoothing,
		cursorMotionBlur,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSway,
		zoomSmoothness,
		zoomClassicMode,
	});

	const selectedZoom = useMemo(() => {
		if (!selectedZoomId) return null;
		return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
	}, [selectedZoomId, zoomRegions]);

	const activeCaptionLayout = useCaptionLayout({
		autoCaptionSettings,
		autoCaptions,
		currentTime,
		overlayRef: refs.overlayRef,
		captionBoxRef: refs.captionBoxRef,
	});

	const layout = useVideoPlaybackLayout({
		refs,
		cropRegion,
		borderRadius,
		padding,
		frame,
		showShadow,
		shadowIntensity,
		selectedZoom,
		webcam,
		webcamVideoPath,
		onZoomFocusChange,
		onSelectZoom,
	});

	useResolvedWallpaper({
		wallpaper,
		setResolvedWallpaper,
		setResolvedWallpaperKind,
	});

	useVideoPlaybackSync({
		refs,
		videoPath,
		frame,
		currentTime,
		isPlaying,
		zoomRegions,
		selectedZoomId,
		trimRegions,
		speedRegions,
		zoomMotionBlur,
		connectZooms,
		zoomInDurationMs,
		zoomInOverlapMs,
		zoomOutDurationMs,
		connectedZoomGapMs,
		connectedZoomDurationMs,
		zoomInEasing,
		zoomOutEasing,
		connectedZoomEasing,
		cursorTelemetry,
		showCursor,
		cursorStyle,
		cursorSize,
		cursorSmoothing,
		zoomSmoothness,
		zoomClassicMode,
		cursorMotionBlur,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSway,
		volume,
		pixiReady,
		videoReady,
		selectedZoom,
		webcam,
		webcamVideoPath,
		layoutVideoContent: layout.layoutVideoContent,
		updateOverlayForRegion: layout.updateOverlayForRegion,
		applyWebcamBubbleLayout: layout.applyWebcamBubbleLayout,
	});

	usePixiApp({ refs, onError, setPixiReady });

	const { handleLoadedMetadata } = useVideoElementLifecycle({
		refs,
		videoPath,
		currentTime,
		onDurationChange,
		onPreviewReadyChange,
		setVideoReady,
		videoReady,
	});

	usePixiVideoScene({
		refs,
		pixiReady,
		videoReady,
		onTimeUpdate,
		onPlayStateChange,
		layoutVideoContent: layout.layoutVideoContent,
		updateOverlayForRegion: () => layout.updateOverlayForRegion(null),
	});

	usePlaybackTicker({
		refs,
		pixiReady,
		videoReady,
		borderRadius,
		padding,
		showShadow,
		shadowIntensity,
		applyWebcamBubbleLayout: layout.applyWebcamBubbleLayout,
	});

	useCursorOverlayRefresh({
		refs,
		cursorStyle,
		cursorSize,
		cursorSmoothing,
		cursorMotionBlur,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSway,
	});

	useImperativeHandle(
		ref,
		() => ({
			video: refs.videoRef.current,
			app: refs.appRef.current,
			videoSprite: refs.videoSpriteRef.current,
			videoContainer: refs.videoContainerRef.current,
			containerRef: refs.containerRef as React.RefObject<HTMLDivElement>,
			play: async () => {
				const video = refs.videoRef.current;
				if (!video) return;
				try {
					refs.allowPlaybackRef.current = true;
					await video.play();
				} catch (error) {
					refs.allowPlaybackRef.current = false;
					throw error;
				}
			},
			pause: () => {
				const video = refs.videoRef.current;
				refs.allowPlaybackRef.current = false;
				if (!video) return;
				video.pause();
			},
			refreshFrame: async () => {
				const video = refs.videoRef.current;
				if (!video || Number.isNaN(video.currentTime)) return;

				const restoreTime = video.currentTime;
				const duration = Number.isFinite(video.duration) ? video.duration : 0;
				const epsilon = duration > 0 ? Math.min(1 / 120, duration / 1000 || 1 / 120) : 1 / 120;
				const nudgeTarget =
					restoreTime > epsilon
						? restoreTime - epsilon
						: Math.min(duration || restoreTime + epsilon, restoreTime + epsilon);

				if (Math.abs(nudgeTarget - restoreTime) < 0.000001) return;

				await new Promise<void>((resolve) => {
					const handleFirstSeeked = () => {
						video.removeEventListener("seeked", handleFirstSeeked);
						const handleSecondSeeked = () => {
							video.removeEventListener("seeked", handleSecondSeeked);
							video.pause();
							resolve();
						};

						video.addEventListener("seeked", handleSecondSeeked, { once: true });
						video.currentTime = restoreTime;
					};

					video.addEventListener("seeked", handleFirstSeeked, { once: true });
					video.currentTime = nudgeTarget;
				});
			},
		}),
		[refs],
	);

	const nativeAspectRatio = (() => {
		const locked = refs.lockedVideoDimensionsRef.current;
		if (locked) {
			return getEffectiveNativeAspectRatio(locked, cropRegion);
		}
		const video = refs.videoRef.current;
		if (video && video.videoHeight > 0 && video.videoWidth > 0) {
			return getEffectiveNativeAspectRatio({ width: video.videoWidth, height: video.videoHeight }, cropRegion);
		}
		return 16 / 9;
	})();

	return (
		<VideoPlaybackOverlay
			aspectRatio={aspectRatio}
			nativeAspectRatio={nativeAspectRatio}
			resolvedWallpaper={resolvedWallpaper}
			resolvedWallpaperKind={resolvedWallpaperKind}
			backgroundBlur={backgroundBlur}
			showShadow={showShadow}
			shadowIntensity={shadowIntensity}
			pixiReady={pixiReady}
			videoReady={videoReady}
			videoPath={videoPath}
			onDurationChange={onDurationChange}
			onError={onError}
			handleLoadedMetadata={handleLoadedMetadata}
			containerRef={refs.containerRef}
			cursorEffectsCanvasRef={refs.cursorEffectsCanvasRef}
			overlayRef={refs.overlayRef}
			focusIndicatorRef={refs.focusIndicatorRef}
			webcamVideoRef={refs.webcamVideoRef}
			webcamBubbleRef={refs.webcamBubbleRef}
			webcamBubbleInnerRef={refs.webcamBubbleInnerRef}
			bgVideoRef={refs.bgVideoRef}
			captionBoxRef={refs.captionBoxRef}
			handleOverlayPointerDown={layout.handleOverlayPointerDown}
			handleOverlayPointerMove={layout.handleOverlayPointerMove}
			handleOverlayPointerUp={layout.handleOverlayPointerUp}
			handleOverlayPointerLeave={layout.handleOverlayPointerLeave}
			webcam={webcam}
			webcamVideoPath={webcamVideoPath}
			autoCaptionSettings={autoCaptionSettings}
			activeCaptionLayout={activeCaptionLayout}
			annotationRegions={annotationRegions}
			selectedAnnotationId={selectedAnnotationId}
			currentTime={currentTime}
			onSelectAnnotation={onSelectAnnotation}
			onAnnotationPositionChange={onAnnotationPositionChange}
			onAnnotationSizeChange={onAnnotationSizeChange}
			videoRef={refs.videoRef}
		/>
	);
});

VideoPlayback.displayName = "VideoPlayback";

export type { VideoPlaybackRef } from "./shared";
export default VideoPlayback;