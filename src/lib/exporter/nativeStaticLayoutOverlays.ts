import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import { DEFAULT_WEBCAM_ROUNDNESS } from "@/components/video-editor/types";
import { computeCameraTransform } from "@/components/video-editor/videoPlayback/cameraTransform";
import { createCursorFollowCameraState } from "@/components/video-editor/videoPlayback/cursorFollowCamera";
import { getCursorViewportScale } from "@/components/video-editor/videoPlayback/cursorScale";
import { computePaddedLayout } from "@/components/video-editor/videoPlayback/layoutUtils";
import { createSpringState } from "@/components/video-editor/videoPlayback/motionSmoothing";
import { resolveSceneZoomTarget } from "@/components/video-editor/videoPlayback/sceneMotion";
import { getCursorStyleSizeMultiplier } from "@/components/video-editor/videoPlayback/uploadedCursorAssets";
import {
	getWebcamCornerRadiusPx,
	getWebcamOverlayPosition,
	getWebcamOverlaySizePx,
} from "@/components/video-editor/webcamOverlay";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import { buildNativeStaticLayoutCursorTelemetry } from "./nativeStaticLayoutTelemetry";
import { getWebcamShadowStrength } from "./shadowProfile";

export type NativeStaticLayoutWebcamOverlay = {
	inputPath: string;
	left: number;
	top: number;
	size: number;
	radius: number;
	shadowIntensity: number;
	mirror: boolean;
	timeOffsetMs: number;
};

export type NativeStaticLayoutZoomSample = {
	timeMs: number;
	scale: number;
	x: number;
	y: number;
};

export function getNativeStaticLayoutWebcamOverlay(
	config: VideoExporterConfig,
	inputPath: string | null,
): NativeStaticLayoutWebcamOverlay | null {
	const webcam = config.webcam;
	if (!webcam?.enabled) {
		return null;
	}

	if (!inputPath) {
		return null;
	}

	const margin = webcam.margin ?? 24;
	const rawSize = getWebcamOverlaySizePx({
		containerWidth: config.width,
		containerHeight: config.height,
		sizePercent: webcam.width ?? webcam.size ?? 40,
		margin,
		zoomScale: 1,
		reactToZoom: webcam.reactToZoom ?? true,
	});
	const size = Math.max(2, Math.round(rawSize / 2) * 2);
	const position = getWebcamOverlayPosition({
		containerWidth: config.width,
		containerHeight: config.height,
		size,
		margin,
		positionPreset: webcam.positionPreset ?? webcam.corner,
		positionX: webcam.positionX ?? 1,
		positionY: webcam.positionY ?? 1,
		legacyCorner: webcam.corner,
	});

	return {
		inputPath,
		left: Math.round(position.x),
		top: Math.round(position.y),
		size,
		radius: getWebcamCornerRadiusPx(
			webcam.roundness ?? DEFAULT_WEBCAM_ROUNDNESS,
			size,
			size,
			webcam.shape,
		),
		shadowIntensity: getWebcamShadowStrength(webcam.shadow ?? 0),
		mirror: webcam.mirror !== false,
		timeOffsetMs: Number.isFinite(webcam.timeOffsetMs) ? webcam.timeOffsetMs : 0,
	};
}

export function getNativeStaticLayoutCursorTelemetry(
	config: VideoExporterConfig,
	effectiveDurationSec: number,
):
	| Array<{
			timeMs: number;
			cx: number;
			cy: number;
			cursorType?: CursorTelemetryPoint["cursorType"];
			cursorTypeIndex?: number;
			bounceScale?: number;
	  }>
	| undefined {
	const telemetry = config.cursorTelemetry ?? [];
	if (config.showCursor !== true || telemetry.length === 0) {
		return undefined;
	}

	return buildNativeStaticLayoutCursorTelemetry(telemetry, {
		frameRate: config.frameRate,
		durationSec: effectiveDurationSec || 0,
		cursorStyle: config.cursorStyle,
		clickBounce: config.cursorClickBounce,
		clickBounceDurationMs: config.cursorClickBounceDuration,
		sourceCrop: config.cropRegion,
	});
}

export function getNativeStaticLayoutCursorSize(config: VideoExporterConfig, contentWidth: number) {
	const cursorStyle = config.cursorStyle ?? "tahoe";
	const viewportScale = getCursorViewportScale(contentWidth);
	return (
		28 * (config.cursorSize ?? 3) * viewportScale * getCursorStyleSizeMultiplier(cursorStyle)
	);
}

export function getNativeStaticLayoutZoomTelemetry(
	config: VideoExporterConfig,
	layout: ReturnType<typeof computePaddedLayout>,
	totalFrames: number,
): NativeStaticLayoutZoomSample[] | undefined {
	const zoomRegions = config.zoomRegions ?? [];
	if (zoomRegions.length === 0 || totalFrames <= 0) {
		return undefined;
	}

	const stageSize = { width: config.width, height: config.height };
	const baseMask = {
		x: layout.centerOffsetX,
		y: layout.centerOffsetY,
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
		sourceCrop: config.cropRegion,
	};
	const cursorFollowCamera = createCursorFollowCameraState();
	const springScale = createSpringState(1);
	const springX = createSpringState(0);
	const springY = createSpringState(0);
	const frameDurationMs = 1000 / Math.max(1, config.frameRate);
	const samples: NativeStaticLayoutZoomSample[] = [];
	let lastContentTimeMs: number | null = null;

	for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
		const timeMs = frameIndex * frameDurationMs;
		const target = resolveSceneZoomTarget({
			zoomRegions,
			timeMs,
			connectZooms: config.connectZooms,
			zoomInDurationMs: config.zoomInDurationMs,
			zoomOutDurationMs: config.zoomOutDurationMs,
			connectedZoomGapMs: config.connectedZoomGapMs,
			connectedZoomDurationMs: config.connectedZoomDurationMs,
			zoomClassicMode: config.zoomClassicMode,
			cursorTelemetry: config.cursorTelemetry ?? [],
			cursorFollowCamera,
			sourceCrop: config.cropRegion,
		});

		const deltaMs = lastContentTimeMs !== null ? timeMs - lastContentTimeMs : frameDurationMs;
		lastContentTimeMs = timeMs;
		const transform = computeCameraTransform({
			target,
			stageSize,
			baseMask,
			springScale,
			springX,
			springY,
			deltaMs,
			snap: config.zoomClassicMode,
			zoomSmoothness: config.zoomSmoothness,
			tuning: {
				stiffnessMultiplier: config.cameraSpringStiffnessMultiplier,
				dampingMultiplier: config.cameraSpringDampingMultiplier,
				massMultiplier: config.cameraSpringMassMultiplier,
			},
		});

		samples.push({
			timeMs,
			...transform,
		});
	}

	return samples;
}
