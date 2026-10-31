/* biome-ignore-all lint/correctness/useExhaustiveDependencies: grouped editor domain objects contain the thumbnail renderer dependencies. */
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { PROJECT_THUMBNAIL_WIDTH, PROJECT_THUMBNAIL_HEIGHT } from "@/lib/projectThumbnail";
import { FrameRenderer } from "@/lib/exporter/frameRenderer";
import { toFileUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { getClipSourceEndMs, getClipSourceStartMs, type SpeedRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { findPreviewClipAtTimelineTime } from "../videoPlayback/clipPlayback";

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
	effectiveShowCursor,
}: Input) {
	const { setProjectLibraryEntries, setProjectLibraryLoading } = project;
	const {
		backgroundBlur,
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
	const thumbnailUpdates = useRef(
		new Map<string, { thumbnailPath: string; updatedAt: number }>(),
	);
	const refreshProjectLibrary = useCallback(async () => {
		setProjectLibraryLoading(true);
		try {
			const result = await window.electronAPI.listProjectFiles();
			if (!result.success) {
				throw new Error(result.error || "Failed to load project library");
			}

			setProjectLibraryEntries(
				result.entries.map((entry) => {
					const ready = thumbnailUpdates.current.get(entry.path);
					return ready?.updatedAt === entry.updatedAt
						? { ...entry, thumbnailPath: ready.thumbnailPath }
						: entry;
				}),
			);
			const paths = new Set(result.entries.map((entry) => entry.path));
			for (const key of thumbnailUpdates.current.keys()) {
				if (!paths.has(key)) thumbnailUpdates.current.delete(key);
			}
		} catch (projectLibraryError) {
			console.warn("Unable to refresh project library:", projectLibraryError);
		} finally {
			setProjectLibraryLoading(false);
		}
	}, []);

	useEffect(
		() =>
			window.electronAPI.onProjectThumbnailReady?.((ready) => {
				thumbnailUpdates.current.set(ready.path, ready);
				setProjectLibraryEntries((entries) =>
					entries.map((entry) =>
						entry.path === ready.path && entry.updatedAt === ready.updatedAt
							? { ...entry, thumbnailPath: ready.thumbnailPath }
							: entry,
					),
				);
			}),
		[setProjectLibraryEntries],
	);

	const captureProjectThumbnail = useCallback(async () => {
		const previewHandle = videoPlaybackRef.current;
		const previewVideo = previewHandle?.video ?? null;

		const targetWidth = PROJECT_THUMBNAIL_WIDTH;
		const targetHeight = PROJECT_THUMBNAIL_HEIGHT;

		const previewWidth = previewHandle?.containerRef.current?.clientWidth || 1920;
		const previewHeight = previewHandle?.containerRef.current?.clientHeight || 1080;
		const frameTimestampUs = 0;

		if (previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0) {
			let videoFrame: VideoFrame | null = null;
			let frameRenderer: FrameRenderer | null = null;
			const thumbnailVideo = document.createElement("video");

			try {
				const firstClip = findPreviewClipAtTimelineTime(0, clipRegions);
				const sourceSeconds = firstClip ? getClipSourceStartMs(firstClip) / 1000 : 0;
				thumbnailVideo.muted = true;
				thumbnailVideo.preload = "auto";
				await new Promise<void>((resolve, reject) => {
					const timeout = window.setTimeout(
						() => finish(new Error("Thumbnail decode timed out")),
						10000,
					);
					const finish = (error?: Error) => {
						clearTimeout(timeout);
						thumbnailVideo.onloadeddata = null;
						thumbnailVideo.onseeked = null;
						thumbnailVideo.onerror = null;
						error ? reject(error) : resolve();
					};
					thumbnailVideo.onerror = () =>
						finish(new Error("Thumbnail source unavailable"));
					thumbnailVideo.onloadeddata = () => {
						if (sourceSeconds > 0) {
							thumbnailVideo.onseeked = () => finish();
							thumbnailVideo.currentTime = sourceSeconds;
						} else finish();
					};
					thumbnailVideo.src = previewVideo.currentSrc || previewVideo.src;
				});
				const sourceTimestampUs = sourceSeconds * 1_000_000;
				if (findPreviewClipAtTimelineTime(frameTimestampUs / 1000, clipRegions)) {
					videoFrame = new VideoFrame(thumbnailVideo, { timestamp: sourceTimestampUs });
				}
				frameRenderer = new FrameRenderer({
					timelineEffects: true,
					width: targetWidth,
					height: targetHeight,
					wallpaper,
					zoomRegions,
					showShadow: shadowIntensity > 0,
					shadowIntensity,
					backgroundBlur,
					zoomMotionBlur,
					zoomMotionBlurTuning,
					connectZooms,
					zoomInDurationMs,
					zoomInOverlapMs,
					zoomOutDurationMs,
					connectedZoomGapMs,
					connectedZoomDurationMs,
					zoomInEasing,
					zoomOutEasing,
					connectedZoomEasing,
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
								startMs: getClipSourceStartMs(clip),
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
				await frameRenderer.renderFrame(
					videoFrame,
					sourceTimestampUs,
					sourceTimestampUs,
					undefined,
					frameTimestampUs,
				);
				return frameRenderer.getCanvas().toDataURL("image/png");
			} catch (thumbnailRenderError) {
				console.warn(
					"Unable to render thumbnail from composed frame:",
					thumbnailRenderError,
				);
			} finally {
				videoFrame?.close();
				frameRenderer?.destroy();
				thumbnailVideo.removeAttribute("src");
				thumbnailVideo.load();
			}
		}

		return null;
	}, [
		annotationRegions,
		autoCaptionSettings,
		autoCaptions,
		backgroundBlur,
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
		zoomOutDurationMs,
		zoomOutEasing,
		zoomRegions,
		zoomClassicMode,
	]);

	return { refreshProjectLibrary, captureProjectThumbnail };
}
