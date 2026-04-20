/**
 * videoEditorUtils – pure helper functions extracted from VideoEditor.tsx.
 */
import type React from "react";
import {
	FrameRenderer,
	type ExportBackendPreference,
	type ExportEncodingMode,
	type ExportMp4FrameRate,
	type ExportPipelineModel,
	type ExportQuality,
} from "@/lib/exporter";
import { getAspectRatioValue } from "@/utils/aspectRatioUtils";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { toFileUrl } from "./projectPersistence";
import type { VideoPlaybackRef } from "./VideoPlayback";
import type {
	AnnotationRegion,
	AutoCaptionSettings,
	CaptionCue,
	ClipRegion,
	CropRegion,
	CursorStyle,
	CursorTelemetryPoint,
	SpeedRegion,
	WebcamOverlaySettings,
	ZoomRegion,
	ZoomTransitionEasing,
} from "./types";
import { getClipSourceEndMs, getClipSourceStartMs } from "./types";

export const DEFAULT_MP4_EXPORT_FRAME_RATE: ExportMp4FrameRate = 30;

export type SmokeExportConfig = {
	enabled: boolean;
	inputPath: string | null;
	outputPath: string | null;
	useNativeExport: boolean;
	encodingMode?: ExportEncodingMode;
	shadowIntensity?: number;
	webcamInputPath?: string | null;
	webcamShadow?: number;
	webcamSize?: number;
	pipelineModel?: ExportPipelineModel;
	backendPreference?: ExportBackendPreference;
	maxEncodeQueue?: number;
	maxDecodeQueue?: number;
	maxPendingFrames?: number;
};

function parseSmokeExportNumber(value: string | null): number | undefined {
	if (value === null) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseSmokeExportNonNegativeNumber(value: string | null): number | undefined {
	if (value === null) return undefined;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function getSmokeExportConfig(search: string): SmokeExportConfig {
	const params = new URLSearchParams(search);
	const enabled = params.get("smokeExport") === "1";
	return {
		enabled,
		inputPath: enabled ? params.get("smokeInput") : null,
		outputPath: enabled ? params.get("smokeOutput") : null,
		useNativeExport: enabled ? params.get("smokeUseNativeExport") === "1" : false,
		encodingMode:
			enabled && params.get("smokeEncodingMode") === "fast"
				? "fast"
				: enabled && params.get("smokeEncodingMode") === "balanced"
					? "balanced"
					: enabled && params.get("smokeEncodingMode") === "quality"
						? "quality"
						: undefined,
		shadowIntensity: enabled
			? parseSmokeExportNonNegativeNumber(params.get("smokeShadowIntensity"))
			: undefined,
		webcamInputPath: enabled ? params.get("smokeWebcamInput") : null,
		webcamShadow: enabled
			? parseSmokeExportNonNegativeNumber(params.get("smokeWebcamShadow"))
			: undefined,
		webcamSize: enabled
			? parseSmokeExportNonNegativeNumber(params.get("smokeWebcamSize"))
			: undefined,
		pipelineModel:
			enabled && params.get("smokePipelineModel") === "modern"
				? "modern"
				: enabled && params.get("smokePipelineModel") === "legacy"
					? "legacy"
					: undefined,
		backendPreference:
			enabled && params.get("smokeBackendPreference") === "auto"
				? "auto"
				: enabled && params.get("smokeBackendPreference") === "webcodecs"
					? "webcodecs"
					: enabled && params.get("smokeBackendPreference") === "breeze"
						? "breeze"
						: undefined,
		maxEncodeQueue: enabled ? parseSmokeExportNumber(params.get("smokeMaxEncodeQueue")) : undefined,
		maxDecodeQueue: enabled ? parseSmokeExportNumber(params.get("smokeMaxDecodeQueue")) : undefined,
		maxPendingFrames: enabled ? parseSmokeExportNumber(params.get("smokeMaxPendingFrames")) : undefined,
	};
}

export function getEncodingModeBitrateMultiplier(encodingMode: ExportEncodingMode): number {
	switch (encodingMode) {
		case "fast":
			return 0.1;
		case "quality":
			return 0.9;
		case "balanced":
		default:
			return 0.5;
	}
}

export function summarizeErrorMessage(message: string): string {
	const firstLine = message
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	return firstLine ?? message;
}

export function calculateMp4SourceDimensions(
	sourceWidth: number,
	sourceHeight: number,
	aspectRatio: AspectRatio,
): { width: number; height: number } {
	const safeWidth = Math.max(2, Math.floor(sourceWidth / 2) * 2);
	const safeHeight = Math.max(2, Math.floor(sourceHeight / 2) * 2);
	const sourceAspectRatio = safeHeight > 0 ? safeWidth / safeHeight : 16 / 9;
	const aspectRatioValue = getAspectRatioValue(aspectRatio, sourceAspectRatio);
	if (aspectRatio === "native") return { width: safeWidth, height: safeHeight };
	if (aspectRatioValue === 1) {
		const base = Math.max(2, Math.floor(Math.min(safeWidth, safeHeight) / 2) * 2);
		return { width: base, height: base };
	}
	if (aspectRatioValue > 1) {
		for (let width = safeWidth; width >= 100; width -= 2) {
			const height = Math.round(width / aspectRatioValue);
			if (height % 2 === 0 && Math.abs(width / height - aspectRatioValue) < 0.0001) {
				return { width, height };
			}
		}
		return {
			width: safeWidth,
			height: Math.max(2, Math.floor(safeWidth / aspectRatioValue / 2) * 2),
		};
	}
	for (let height = safeHeight; height >= 100; height -= 2) {
		const width = Math.round(height * aspectRatioValue);
		if (width % 2 === 0 && Math.abs(width / height - aspectRatioValue) < 0.0001) {
			return { width, height };
		}
	}
	return {
		height: safeHeight,
		width: Math.max(2, Math.floor((safeHeight * aspectRatioValue) / 2) * 2),
	};
}

export function calculateMp4ExportDimensions(
	baseWidth: number,
	baseHeight: number,
	quality: ExportQuality,
): { width: number; height: number } {
	if (quality === "source") {
		return {
			width: Math.max(2, Math.floor(baseWidth / 2) * 2),
			height: Math.max(2, Math.floor(baseHeight / 2) * 2),
		};
	}
	const scale = quality === "medium" ? 0.6 : quality === "good" ? 0.75 : 0.9;
	return {
		width: Math.max(2, Math.floor((baseWidth * scale) / 2) * 2),
		height: Math.max(2, Math.floor((baseHeight * scale) / 2) * 2),
	};
}

export function getSourceQualityBitrate(width: number, height: number): number {
	const pixels = width * height;
	if (pixels > 2560 * 1440) return 80_000_000;
	if (pixels > 1920 * 1080) return 50_000_000;
	return 30_000_000;
}

export async function writeSmokeExportReport(
	outputPath: string | null,
	report: Record<string, unknown>,
): Promise<void> {
	if (!outputPath || typeof window === "undefined") return;
	try {
		const bytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
		const buffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		await window.electronAPI.writeExportedVideoToPath(buffer, `${outputPath}.report.json`);
	} catch (error) {
		console.error("[smoke-export] Failed to write report", error);
	}
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error.replace(/^Error:\s*/i, "");
	return "Something went wrong";
}

// ─── Project thumbnail capture ───────────────────────────────────────────────

export interface ThumbnailRenderConfig {
	videoPlaybackRef: React.RefObject<VideoPlaybackRef | null>;
	currentTime: number;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	shadowIntensity: number;
	backgroundBlur: number;
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
	borderRadius: number;
	padding: number;
	cropRegion: CropRegion;
	webcam: WebcamOverlaySettings;
	annotationRegions: AnnotationRegion[];
	autoCaptions: CaptionCue[];
	autoCaptionSettings: AutoCaptionSettings;
	effectiveSpeedRegions: SpeedRegion[];
	clipRegions: ClipRegion[];
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
}

export async function captureVideoThumbnail(config: ThumbnailRenderConfig): Promise<string | null> {
	const { videoPlaybackRef, currentTime, ...params } = config;
	const previewHandle = videoPlaybackRef.current;
	const previewVideo = previewHandle?.video ?? null;
	const previewCanvas = previewHandle?.app?.canvas ?? null;

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

	const clipDerived: SpeedRegion[] = params.clipRegions
		.filter((clip) => clip.speed !== 1)
		.map((clip) => ({
			id: `clip-speed-${clip.id}`,
			startMs: getClipSourceStartMs(clip),
			endMs: getClipSourceEndMs(clip),
			speed: clip.speed as SpeedRegion["speed"],
		}));
	const speedRegions =
		clipDerived.length === 0
			? params.effectiveSpeedRegions
			: (() => {
					const result = [...params.effectiveSpeedRegions];
					for (const clipSpeed of clipDerived) {
						const overlaps = params.effectiveSpeedRegions.some(
							(speedRegion) => speedRegion.endMs > clipSpeed.startMs && speedRegion.startMs < clipSpeed.endMs,
						);
						if (!overlaps) result.push(clipSpeed);
					}
					return result;
			  })();

	if (previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0) {
		let videoFrame: VideoFrame | null = null;
		let frameRenderer: FrameRenderer | null = null;
		try {
			videoFrame = new VideoFrame(previewVideo, { timestamp: frameTimestampUs });
			frameRenderer = new FrameRenderer({
				width: targetWidth,
				height: targetHeight,
				wallpaper: params.wallpaper,
				zoomRegions: params.zoomRegions,
				showShadow: params.shadowIntensity > 0,
				shadowIntensity: params.shadowIntensity,
				backgroundBlur: params.backgroundBlur,
				zoomMotionBlur: params.zoomMotionBlur,
				connectZooms: params.connectZooms,
				zoomInDurationMs: params.zoomInDurationMs,
				zoomInOverlapMs: params.zoomInOverlapMs,
				zoomOutDurationMs: params.zoomOutDurationMs,
				connectedZoomGapMs: params.connectedZoomGapMs,
				connectedZoomDurationMs: params.connectedZoomDurationMs,
				zoomInEasing: params.zoomInEasing,
				zoomOutEasing: params.zoomOutEasing,
				connectedZoomEasing: params.connectedZoomEasing,
				borderRadius: params.borderRadius,
				padding: params.padding,
				cropRegion: params.cropRegion,
				webcam: params.webcam,
				webcamUrl: params.webcam.sourcePath ? toFileUrl(params.webcam.sourcePath) : null,
				videoWidth: previewVideo.videoWidth,
				videoHeight: previewVideo.videoHeight,
				annotationRegions: params.annotationRegions,
				autoCaptions: params.autoCaptions,
				autoCaptionSettings: params.autoCaptionSettings,
				speedRegions,
				previewWidth,
				previewHeight,
				cursorTelemetry: params.cursorTelemetry,
				showCursor: params.showCursor,
				cursorStyle: params.cursorStyle,
				cursorSize: params.cursorSize,
				cursorSmoothing: params.cursorSmoothing,
				zoomSmoothness: params.zoomSmoothness,
				zoomClassicMode: params.zoomClassicMode,
				cursorMotionBlur: params.cursorMotionBlur,
				cursorClickBounce: params.cursorClickBounce,
				cursorClickBounceDuration: params.cursorClickBounceDuration,
				cursorSway: params.cursorSway,
			});
			await frameRenderer.initialize();
			await frameRenderer.renderFrame(videoFrame, frameTimestampUs);
			return frameRenderer.getCanvas().toDataURL("image/png");
		} catch {
			// fall through to canvas draw
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
	if (!drawableSource) return null;

	const sourceWidth =
		drawableSource instanceof HTMLVideoElement ? drawableSource.videoWidth : drawableSource.width;
	const sourceHeight =
		drawableSource instanceof HTMLVideoElement ? drawableSource.videoHeight : drawableSource.height;
	if (sourceWidth <= 0 || sourceHeight <= 0) return null;

	const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
	const drawWidth = Math.round(sourceWidth * scale);
	const drawHeight = Math.round(sourceHeight * scale);
	try {
		context.drawImage(
			drawableSource,
			Math.round((targetWidth - drawWidth) / 2),
			Math.round((targetHeight - drawHeight) / 2),
			drawWidth,
			drawHeight,
		);
		return canvas.toDataURL("image/png");
	} catch {
		return null;
	}
}