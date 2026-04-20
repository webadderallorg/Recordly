import type React from "react";
import { FrameRenderer } from "@/lib/exporter";
import { toFileUrl } from "./projectPersistence";
import type { VideoPlaybackRef } from "./VideoPlayback";
import type { CursorTelemetryPoint } from "./types";
import type { useEditorPreferences } from "./hooks/useEditorPreferences";
import type { useEditorRegions } from "./hooks/useEditorRegions";
import type { useEditorCaptions } from "./hooks/useEditorCaptions";

type Prefs = ReturnType<typeof useEditorPreferences>;
type Regions = ReturnType<typeof useEditorRegions>;
type Captions = ReturnType<typeof useEditorCaptions>;

export async function captureProjectThumbnail(
	videoPlaybackRef: React.RefObject<VideoPlaybackRef | null>,
	currentTime: number,
	cursorTelemetry: CursorTelemetryPoint[],
	prefs: Prefs,
	regions: Regions,
	captions: Captions,
): Promise<string | null> {
	const previewHandle = videoPlaybackRef.current;
	const previewVideo = previewHandle?.video ?? null;

	if (previewHandle && previewVideo && previewVideo.paused) {
		try {
			await previewHandle.refreshFrame();
			await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
		} catch {
			// no-op
		}
	}

	const canvas = document.createElement("canvas");
	const targetWidth = 320;
	const targetHeight = 180;
	canvas.width = targetWidth;
	canvas.height = targetHeight;

	const context = canvas.getContext("2d");
	if (!context) return null;
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.fillStyle = "#111113";
	context.fillRect(0, 0, targetWidth, targetHeight);

	const previewWidth = previewHandle?.containerRef.current?.clientWidth || 1920;
	const previewHeight = previewHandle?.containerRef.current?.clientHeight || 1080;
	const frameTimestampUs = Math.max(0, Math.round(currentTime * 1_000_000));

	if (previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0) {
		let videoFrame: VideoFrame | null = null;
		let frameRenderer: FrameRenderer | null = null;
		try {
			videoFrame = new VideoFrame(previewVideo, { timestamp: frameTimestampUs });
			frameRenderer = new FrameRenderer({
				width: targetWidth,
				height: targetHeight,
				wallpaper: prefs.wallpaper,
				zoomRegions: regions.effectiveZoomRegions,
				showShadow: prefs.shadowIntensity > 0,
				shadowIntensity: prefs.shadowIntensity,
				backgroundBlur: prefs.backgroundBlur,
				zoomMotionBlur: prefs.zoomMotionBlur,
				connectZooms: prefs.connectZooms,
				zoomInDurationMs: prefs.zoomInDurationMs,
				zoomInOverlapMs: prefs.zoomInOverlapMs,
				zoomOutDurationMs: prefs.zoomOutDurationMs,
				connectedZoomGapMs: prefs.connectedZoomGapMs,
				connectedZoomDurationMs: prefs.connectedZoomDurationMs,
				zoomInEasing: prefs.zoomInEasing,
				zoomOutEasing: prefs.zoomOutEasing,
				connectedZoomEasing: prefs.connectedZoomEasing,
				borderRadius: prefs.borderRadius,
				padding: prefs.padding,
				cropRegion: prefs.cropRegion,
				webcam: prefs.webcam,
				webcamUrl: prefs.webcam.sourcePath ? toFileUrl(prefs.webcam.sourcePath) : null,
				videoWidth: previewVideo.videoWidth,
				videoHeight: previewVideo.videoHeight,
				annotationRegions: regions.annotationRegions,
				autoCaptions: captions.autoCaptions,
				autoCaptionSettings: captions.autoCaptionSettings,
				speedRegions: regions.effectiveSpeedRegions,
				previewWidth,
				previewHeight,
				cursorTelemetry,
				showCursor: prefs.showCursor,
				cursorStyle: prefs.cursorStyle,
				cursorSize: prefs.cursorSize,
				cursorSmoothing: prefs.cursorSmoothing,
				zoomSmoothness: prefs.zoomSmoothness,
				zoomClassicMode: prefs.zoomClassicMode,
				cursorMotionBlur: prefs.cursorMotionBlur,
				cursorClickBounce: prefs.cursorClickBounce,
				cursorClickBounceDuration: prefs.cursorClickBounceDuration,
				cursorSway: prefs.cursorSway,
			});
			await frameRenderer.initialize();
			await frameRenderer.renderFrame(videoFrame, frameTimestampUs);
			return frameRenderer.getCanvas().toDataURL("image/png");
		} catch {
			// fallback below
		} finally {
			videoFrame?.close();
			frameRenderer?.destroy();
		}
	}

	const previewCanvas = previewHandle?.app?.canvas ?? null;
	const drawableSource =
		previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0
			? previewCanvas
			: previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0
				? previewVideo
				: null;
	if (!drawableSource) return null;

	const sourceWidth =
		drawableSource instanceof HTMLVideoElement
			? drawableSource.videoWidth
			: drawableSource.width;
	const sourceHeight =
		drawableSource instanceof HTMLVideoElement
			? drawableSource.videoHeight
			: drawableSource.height;
	if (sourceWidth <= 0 || sourceHeight <= 0) return null;

	const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
	const drawWidth = Math.round(sourceWidth * scale);
	const drawHeight = Math.round(sourceHeight * scale);
	const offsetX = Math.round((targetWidth - drawWidth) / 2);
	const offsetY = Math.round((targetHeight - drawHeight) / 2);

	try {
		context.drawImage(drawableSource, offsetX, offsetY, drawWidth, drawHeight);
		return canvas.toDataURL("image/png");
	} catch {
		return null;
	}
}
