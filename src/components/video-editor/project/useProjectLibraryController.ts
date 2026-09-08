/* biome-ignore-all lint/correctness/useExhaustiveDependencies: grouped editor domain objects contain the thumbnail renderer dependencies. */
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { FrameRenderer } from "@/lib/exporter/frameRenderer";
import { toFileUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { getClipSourceEndMs, type SpeedRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

type Input = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	currentTime: number;
	effectiveShowCursor: boolean;
};

export function useProjectLibraryController({
	project,
	appearance,
	timeline,
	videoPlaybackRef,
	currentTime,
	effectiveShowCursor,
}: Input) {
	const currentTimeRef = useRef(currentTime);
	useEffect(() => {
		currentTimeRef.current = currentTime;
	}, [currentTime]);
	const { setProjectLibraryEntries } = project;
	const {
		backgroundBlur,
		deviceFrame,
		borderRadius,
		connectZooms,
		connectedZoomDurationMs,
		connectedZoomEasing,
		connectedZoomGapMs,
		cropRegion,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorClickEffect,
		cursorClickEffectColor,
		cursorClickEffectScale,
		cursorClickEffectOpacity,
		cursorClickEffectDurationMs,
		cursorMotionBlur,
		cursorSize,
		cursorSmoothing,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		cursorSpringStiffnessMultiplier,
		cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier,
		zoomSmoothness,
		cursorStyle,
		cursorSway,
		padding,
		resolvedWebcamVideoUrl,
		shadowIntensity,
		wallpaper,
		webcam,
		zoomInDurationMs,
		zoomInEasing,
		zoomInOverlapMs,
		zoomMotionBlur,
		zoomMotionBlurTuning,
		zoomTemporalMotionBlur,
		zoomMotionBlurSampleCount,
		zoomMotionBlurShutterFraction,
		zoomOutDurationMs,
		zoomOutEasing,
		zoomClassicMode,
	} = appearance;
	const {
		annotationRegions,
		autoCaptionSettings,
		autoCaptions,
		cursorTelemetry,
		clipRegions,
		speedRegions,
		zoomRegions,
	} = timeline;
	const refreshProjectLibrary = useCallback(async () => {
		try {
			const result = await window.electronAPI.listProjectFiles();
			if (!result.success) {
				throw new Error(result.error || "Failed to load project library");
			}

			setProjectLibraryEntries(result.entries);
		} catch (projectLibraryError) {
			console.warn("Unable to refresh project library:", projectLibraryError);
		}
	}, []);

	const captureProjectThumbnail = useCallback(async () => {
		const previewHandle = videoPlaybackRef.current;
		const previewVideo = previewHandle?.video ?? null;
		const previewCanvas = previewHandle?.app?.canvas ?? null;

		if (previewHandle && previewVideo && previewVideo.paused) {
			try {
				await previewHandle.refreshFrame();
				await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
			} catch (thumbnailRefreshError) {
				console.warn(
					"Unable to refresh preview frame before thumbnail capture:",
					thumbnailRefreshError,
				);
			}
		}

		const canvas = document.createElement("canvas");
		const targetWidth = 320;
		const targetHeight = 180;
		canvas.width = targetWidth;
		canvas.height = targetHeight;

		const context = canvas.getContext("2d");
		if (!context) {
			return null;
		}
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		const editorBgHsl = getComputedStyle(document.documentElement)
			.getPropertyValue("--editor-bg")
			.trim();
		context.fillStyle = editorBgHsl ? `hsl(${editorBgHsl})` : "#111113";
		context.fillRect(0, 0, targetWidth, targetHeight);

		const previewWidth = previewHandle?.containerRef.current?.clientWidth || 1920;
		const previewHeight = previewHandle?.containerRef.current?.clientHeight || 1080;
		const frameTimestampUs = Math.max(0, Math.round(currentTimeRef.current * 1_000_000));

		if (previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0) {
			let videoFrame: VideoFrame | null = null;
			let frameRenderer: FrameRenderer | null = null;

			try {
				videoFrame = new VideoFrame(previewVideo, { timestamp: frameTimestampUs });
				frameRenderer = new FrameRenderer({
					width: targetWidth,
					height: targetHeight,
					wallpaper,
					zoomRegions,
					showShadow: shadowIntensity > 0,
					shadowIntensity,
					backgroundBlur,
					zoomMotionBlur,
					zoomMotionBlurTuning,
					zoomTemporalMotionBlur,
					zoomMotionBlurSampleCount,
					zoomMotionBlurShutterFraction,
					connectZooms,
					zoomInDurationMs,
					zoomInOverlapMs,
					zoomOutDurationMs,
					connectedZoomGapMs,
					connectedZoomDurationMs,
					zoomInEasing,
					zoomOutEasing,
					connectedZoomEasing,
					deviceFrame,
					borderRadius,
					padding,
					cropRegion,
					webcam,
					webcamUrl:
						resolvedWebcamVideoUrl ??
						(webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null),
					videoWidth: previewVideo.videoWidth,
					videoHeight: previewVideo.videoHeight,
					annotationRegions,
					autoCaptions,
					autoCaptionSettings,
					speedRegions: (() => {
						const clipDerived: SpeedRegion[] = clipRegions
							.filter((clip) => clip.speed !== 1)
							.map((clip) => ({
								id: `clip-speed-${clip.id}`,
								startMs: clip.startMs,
								endMs: getClipSourceEndMs(clip),
								speed: clip.speed as SpeedRegion["speed"],
							}));
						if (clipDerived.length === 0) return speedRegions;
						const result = [...speedRegions];
						for (const cs of clipDerived) {
							const overlaps = speedRegions.some(
								(sr) => sr.endMs > cs.startMs && sr.startMs < cs.endMs,
							);
							if (!overlaps) {
								result.push(cs);
							}
						}
						return result;
					})(),
					previewWidth,
					previewHeight,
					cursorTelemetry,
					showCursor: effectiveShowCursor,
					cursorStyle,
					cursorSize,
					cursorSmoothing,
					cursorSpringStiffnessMultiplier,
					cursorSpringDampingMultiplier,
					cursorSpringMassMultiplier,
					cameraSpringStiffnessMultiplier,
					cameraSpringDampingMultiplier,
					cameraSpringMassMultiplier,
					zoomSmoothness,
					zoomClassicMode,
					cursorMotionBlur,
					cursorClickEffect,
					cursorClickEffectColor,
					cursorClickEffectScale,
					cursorClickEffectOpacity,
					cursorClickEffectDurationMs,
					cursorClickBounce,
					cursorClickBounceDuration,
					cursorSway,
				});
				await frameRenderer.initialize();
				await frameRenderer.renderFrame(videoFrame, frameTimestampUs);
				return frameRenderer.getCanvas().toDataURL("image/png");
			} catch (thumbnailRenderError) {
				console.warn(
					"Unable to render thumbnail from composed frame:",
					thumbnailRenderError,
				);
			} finally {
				videoFrame?.close();
				frameRenderer?.destroy();
			}
		}

		const drawableSource =
			previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0
				? previewCanvas
				: previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0
					? previewVideo
					: null;

		if (!drawableSource) {
			return null;
		}

		const sourceWidth =
			drawableSource instanceof HTMLVideoElement
				? drawableSource.videoWidth
				: drawableSource.width;
		const sourceHeight =
			drawableSource instanceof HTMLVideoElement
				? drawableSource.videoHeight
				: drawableSource.height;

		if (sourceWidth <= 0 || sourceHeight <= 0) {
			return null;
		}

		const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
		const drawWidth = Math.round(sourceWidth * scale);
		const drawHeight = Math.round(sourceHeight * scale);
		const offsetX = Math.round((targetWidth - drawWidth) / 2);
		const offsetY = Math.round((targetHeight - drawHeight) / 2);

		try {
			context.drawImage(drawableSource, offsetX, offsetY, drawWidth, drawHeight);
			return canvas.toDataURL("image/png");
		} catch (thumbnailError) {
			console.warn("Unable to capture project thumbnail:", thumbnailError);
			return null;
		}
	}, [
		annotationRegions,
		autoCaptionSettings,
		autoCaptions,
		backgroundBlur,
		deviceFrame,
		borderRadius,
		connectZooms,
		connectedZoomDurationMs,
		connectedZoomEasing,
		connectedZoomGapMs,
		cropRegion,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorClickEffect,
		cursorClickEffectColor,
		cursorClickEffectScale,
		cursorClickEffectOpacity,
		cursorClickEffectDurationMs,
		cursorMotionBlur,
		cursorSize,
		cursorSmoothing,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		cursorSpringStiffnessMultiplier,
		cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier,
		zoomSmoothness,
		cursorStyle,
		cursorSway,
		cursorTelemetry,
		clipRegions,
		padding,
		resolvedWebcamVideoUrl,
		shadowIntensity,
		effectiveShowCursor,
		speedRegions,
		wallpaper,
		webcam,
		zoomInDurationMs,
		zoomInEasing,
		zoomInOverlapMs,
		zoomMotionBlur,
		zoomMotionBlurTuning,
		zoomTemporalMotionBlur,
		zoomMotionBlurSampleCount,
		zoomMotionBlurShutterFraction,
		zoomOutDurationMs,
		zoomOutEasing,
		zoomRegions,
		zoomClassicMode,
	]);

	return { refreshProjectLibrary, captureProjectThumbnail };
}
