import { useEffect } from "react";
import { extensionHost } from "@/lib/extensions";
import { clampMediaTimeToDuration } from "@/lib/mediaTiming";
import { resetCursorFollowCamera } from "../videoPlayback/cursorFollowCamera";
import { resetSpringState } from "../videoPlayback/motionSmoothing";
import { createMotionBlurState } from "../videoPlayback/zoomTransform";
import type { CursorStyle, CursorTelemetryPoint, SpeedRegion, TrimRegion, ZoomRegion, ZoomTransitionEasing } from "../types";
import type { VideoPlaybackRuntimeRefs } from "./shared";

interface UseVideoPlaybackSyncParams {
	refs: VideoPlaybackRuntimeRefs;
	videoPath: string;
	frame: string | null;
	currentTime: number;
	isPlaying: boolean;
	zoomRegions: ZoomRegion[];
	selectedZoomId: string | null;
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	zoomMotionBlur: number;
	connectZooms: boolean;
	zoomInDurationMs: number;
	zoomInOverlapMs: number;
	zoomOutDurationMs: number;
	connectedZoomGapMs: number;
	connectedZoomDurationMs: number;
	zoomInEasing: ZoomTransitionEasing;
	zoomOutEasing: ZoomTransitionEasing;
	connectedZoomEasing: ZoomTransitionEasing;
	cursorTelemetry: CursorTelemetryPoint[];
	showCursor: boolean;
	cursorStyle: CursorStyle;
	cursorSize: number;
	cursorSmoothing: number;
	zoomSmoothness: number;
	zoomClassicMode: boolean;
	cursorMotionBlur: number;
	cursorClickBounce: number;
	cursorClickBounceDuration: number;
	cursorSway: number;
	volume: number;
	pixiReady: boolean;
	videoReady: boolean;
	selectedZoom: ZoomRegion | null;
	webcam?: { enabled?: boolean } | null;
	webcamVideoPath?: string | null;
	layoutVideoContent: () => void;
	updateOverlayForRegion: (region: ZoomRegion | null) => void;
	applyWebcamBubbleLayout: (zoomScale: number) => void;
}

export function useVideoPlaybackSync({
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
	layoutVideoContent,
	updateOverlayForRegion,
	applyWebcamBubbleLayout,
}: UseVideoPlaybackSyncParams) {
	useEffect(() => {
		const video = refs.videoRef.current;
		if (!video) return;

		const nextVolume = Math.max(0, Math.min(1, volume));
		video.volume = nextVolume;
		video.muted = nextVolume <= 0.001;
	}, [refs.videoRef, videoPath, volume]);

	useEffect(() => {
		refs.layoutVideoContentRef.current = layoutVideoContent;
	}, [layoutVideoContent, refs.layoutVideoContentRef]);

	useEffect(() => {
		refs.frameIdRef.current = frame;
		extensionHost.setActiveFrame(frame ?? null);
	}, [frame, refs.frameIdRef]);

	useEffect(() => {
		refs.zoomRegionsRef.current = zoomRegions;
	}, [refs.zoomRegionsRef, zoomRegions]);

	useEffect(() => {
		refs.selectedZoomIdRef.current = selectedZoomId;
	}, [refs.selectedZoomIdRef, selectedZoomId]);

	useEffect(() => {
		refs.isPlayingRef.current = isPlaying;
		extensionHost.emitEvent({
			type: isPlaying ? "playback:play" : "playback:pause",
			timeMs: refs.currentTimeRef.current,
		});
		if (!isPlaying) {
			resetSpringState(refs.springScaleRef.current);
			resetSpringState(refs.springXRef.current);
			resetSpringState(refs.springYRef.current);
			resetCursorFollowCamera(refs.cursorFollowCameraRef.current);
			refs.lastTickTimeRef.current = null;
		}
		const bgVideo = refs.bgVideoRef.current;
		if (bgVideo) {
			if (isPlaying) {
				bgVideo.play().catch(() => undefined);
			} else {
				bgVideo.pause();
			}
		}
	}, [isPlaying, refs]);

	useEffect(() => {
		const bgVideo = refs.bgVideoRef.current;
		if (!bgVideo) return;
		if (!isPlaying && bgVideo.duration && Number.isFinite(bgVideo.duration)) {
			bgVideo.currentTime = currentTime % bgVideo.duration;
		}
	}, [currentTime, isPlaying, refs.bgVideoRef]);

	useEffect(() => {
		refs.trimRegionsRef.current = trimRegions;
	}, [refs.trimRegionsRef, trimRegions]);

	useEffect(() => {
		refs.speedRegionsRef.current = speedRegions;
	}, [refs.speedRegionsRef, speedRegions]);

	useEffect(() => {
		refs.zoomMotionBlurRef.current = zoomMotionBlur;
	}, [refs.zoomMotionBlurRef, zoomMotionBlur]);

	useEffect(() => {
		refs.connectZoomsRef.current = connectZooms;
	}, [connectZooms, refs.connectZoomsRef]);

	useEffect(() => {
		refs.zoomInDurationMsRef.current = zoomInDurationMs;
	}, [refs.zoomInDurationMsRef, zoomInDurationMs]);

	useEffect(() => {
		refs.zoomInOverlapMsRef.current = zoomInOverlapMs;
	}, [refs.zoomInOverlapMsRef, zoomInOverlapMs]);

	useEffect(() => {
		refs.zoomOutDurationMsRef.current = zoomOutDurationMs;
	}, [refs.zoomOutDurationMsRef, zoomOutDurationMs]);

	useEffect(() => {
		refs.connectedZoomGapMsRef.current = connectedZoomGapMs;
	}, [connectedZoomGapMs, refs.connectedZoomGapMsRef]);

	useEffect(() => {
		refs.connectedZoomDurationMsRef.current = connectedZoomDurationMs;
	}, [connectedZoomDurationMs, refs.connectedZoomDurationMsRef]);

	useEffect(() => {
		refs.zoomInEasingRef.current = zoomInEasing;
	}, [refs.zoomInEasingRef, zoomInEasing]);

	useEffect(() => {
		refs.zoomOutEasingRef.current = zoomOutEasing;
	}, [refs.zoomOutEasingRef, zoomOutEasing]);

	useEffect(() => {
		refs.connectedZoomEasingRef.current = connectedZoomEasing;
	}, [connectedZoomEasing, refs.connectedZoomEasingRef]);

	useEffect(() => {
		refs.cursorTelemetryRef.current = cursorTelemetry;
		extensionHost.setCursorTelemetry(
			cursorTelemetry.map((point) => ({
				timeMs: point.timeMs,
				cx: point.cx,
				cy: point.cy,
				interactionType: point.interactionType,
				pressure: point.pressure,
			})),
		);
	}, [cursorTelemetry, refs.cursorTelemetryRef]);

	useEffect(() => {
		refs.showCursorRef.current = showCursor;
	}, [refs.showCursorRef, showCursor]);

	useEffect(() => {
		refs.cursorStyleRef.current = cursorStyle;
	}, [cursorStyle, refs.cursorStyleRef]);

	useEffect(() => {
		refs.cursorSizeRef.current = cursorSize;
	}, [cursorSize, refs.cursorSizeRef]);

	useEffect(() => {
		refs.cursorSmoothingRef.current = cursorSmoothing;
	}, [cursorSmoothing, refs.cursorSmoothingRef]);

	useEffect(() => {
		refs.zoomSmoothnessRef.current = zoomSmoothness;
	}, [refs.zoomSmoothnessRef, zoomSmoothness]);

	useEffect(() => {
		refs.zoomClassicModeRef.current = zoomClassicMode;
	}, [refs.zoomClassicModeRef, zoomClassicMode]);

	useEffect(() => {
		refs.cursorMotionBlurRef.current = cursorMotionBlur;
	}, [cursorMotionBlur, refs.cursorMotionBlurRef]);

	useEffect(() => {
		refs.cursorClickBounceRef.current = cursorClickBounce;
	}, [cursorClickBounce, refs.cursorClickBounceRef]);

	useEffect(() => {
		refs.cursorClickBounceDurationRef.current = cursorClickBounceDuration;
	}, [cursorClickBounceDuration, refs.cursorClickBounceDurationRef]);

	useEffect(() => {
		refs.cursorSwayRef.current = cursorSway;
	}, [cursorSway, refs.cursorSwayRef]);

	useEffect(() => {
		const timeMs = currentTime * 1000;
		refs.currentTimeRef.current = timeMs;
		const videoInfo = extensionHost.getVideoInfoSnapshot();
		extensionHost.setPlaybackState({
			currentTimeMs: timeMs,
			durationMs: videoInfo?.durationMs ?? 0,
			isPlaying,
		});
	}, [currentTime, isPlaying, refs.currentTimeRef]);

	useEffect(() => {
		if (!pixiReady || !videoReady) return;
		const app = refs.appRef.current;
		const cameraContainer = refs.cameraContainerRef.current;
		const video = refs.videoRef.current;

		if (!app || !cameraContainer || !video) return;

		const tickerWasStarted = app.ticker?.started || false;
		if (tickerWasStarted && app.ticker) {
			app.ticker.stop();
		}

		const wasPlaying = !video.paused;
		if (wasPlaying) {
			video.pause();
		}

		refs.animationStateRef.current.scale = 1;
		refs.animationStateRef.current.appliedScale = 1;
		refs.animationStateRef.current.focusX = 0.5;
		refs.animationStateRef.current.focusY = 0.5;
		refs.animationStateRef.current.progress = 0;
		refs.animationStateRef.current.x = 0;
		refs.animationStateRef.current.y = 0;
		refs.cursorOverlayRef.current?.reset();
		refs.motionBlurStateRef.current = createMotionBlurState();

		if (refs.blurFilterRef.current) {
			refs.blurFilterRef.current.blur = 0;
		}

		requestAnimationFrame(() => {
			const container = refs.cameraContainerRef.current;
			const videoStage = refs.videoContainerRef.current;
			const sprite = refs.videoSpriteRef.current;
			const currentApp = refs.appRef.current;
			if (!container || !videoStage || !sprite || !currentApp) return;

			container.scale.set(1);
			container.position.set(0, 0);
			videoStage.scale.set(1);
			videoStage.position.set(0, 0);
			sprite.scale.set(1);
			sprite.position.set(0, 0);

			layoutVideoContent();

			requestAnimationFrame(() => {
				const finalApp = refs.appRef.current;
				if (wasPlaying && video) {
					video.play().catch(() => undefined);
				}
				if (tickerWasStarted && finalApp?.ticker) {
					finalApp.ticker.start();
				}
			});
		});
	}, [layoutVideoContent, pixiReady, refs, videoReady]);

	useEffect(() => {
		if (!pixiReady || !videoReady) return;
		const container = refs.containerRef.current;
		if (!container || typeof ResizeObserver === "undefined") return;

		const observer = new ResizeObserver(() => {
			layoutVideoContent();
		});

		observer.observe(container);
		return () => observer.disconnect();
	}, [layoutVideoContent, pixiReady, refs.containerRef, videoReady]);

	useEffect(() => {
		if (!pixiReady || !videoReady) return;
		updateOverlayForRegion(selectedZoom);
	}, [pixiReady, selectedZoom, updateOverlayForRegion, videoReady]);

	useEffect(() => {
		if (!pixiReady || !videoReady) return;
		applyWebcamBubbleLayout(refs.animationStateRef.current.appliedScale || 1);
	}, [applyWebcamBubbleLayout, pixiReady, refs.animationStateRef, videoReady, webcam, webcamVideoPath]);

	useEffect(() => {
		const webcamVideo = refs.webcamVideoRef.current;
		if (!webcamVideo || !webcam?.enabled || !webcamVideoPath) {
			return;
		}

		const targetTime = clampMediaTimeToDuration(
			currentTime,
			Number.isFinite(webcamVideo.duration) ? webcamVideo.duration : null,
		);

		const activeSpeedRegion = refs.speedRegionsRef.current.find(
			(region) => targetTime * 1000 >= region.startMs && targetTime * 1000 < region.endMs,
		);
		const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
		if (Math.abs(webcamVideo.playbackRate - targetPlaybackRate) > 0.001) {
			webcamVideo.playbackRate = targetPlaybackRate;
		}

		const previousTimelineTime = refs.lastWebcamSyncTimeRef.current;
		const timelineJumped = previousTimelineTime === null || Math.abs(targetTime - previousTimelineTime) > 0.25;
		const driftThreshold = isPlaying ? 0.35 : 0.01;
		if (timelineJumped || Math.abs(webcamVideo.currentTime - targetTime) > driftThreshold) {
			try {
				webcamVideo.currentTime = targetTime;
			} catch {
			}
		}

		if (isPlaying) {
			const playPromise = webcamVideo.play();
			if (playPromise) {
				playPromise.catch(() => undefined);
			}
		} else {
			webcamVideo.pause();
		}

		refs.lastWebcamSyncTimeRef.current = targetTime;
	}, [currentTime, isPlaying, refs, webcam, webcamVideoPath]);

	useEffect(() => {
		refs.lastWebcamSyncTimeRef.current = null;
	}, [refs.lastWebcamSyncTimeRef, webcamVideoPath]);

	useEffect(() => {
		const overlayEl = refs.overlayRef.current;
		if (!overlayEl) return;
		if (!selectedZoom || selectedZoom.mode !== "manual") {
			overlayEl.style.cursor = "default";
			overlayEl.style.pointerEvents = "none";
			return;
		}
		overlayEl.style.cursor = isPlaying ? "not-allowed" : "crosshair";
		overlayEl.style.pointerEvents = isPlaying ? "none" : "auto";
	}, [isPlaying, refs.overlayRef, selectedZoom]);
}