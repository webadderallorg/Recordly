import { computeCameraTransform } from "@/components/video-editor/videoPlayback/cameraTransform";
import {
	computePaddedLayout,
	scalePreviewBorderRadius,
} from "@/components/video-editor/videoPlayback/layoutUtils";
import { resolveSceneZoomTarget } from "@/components/video-editor/videoPlayback/sceneMotion";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";

export function updateLayout(
	context: Pick<
		LegacyFrameRendererContext,
		"app" | "videoSprite" | "maskGraphics" | "videoContainer" | "config" | "layoutCache"
	>,
): void {
	if (!context.app || !context.videoSprite || !context.maskGraphics || !context.videoContainer)
		return;

	const {
		width,
		height,
		cropRegion,
		borderRadius = 0,
		padding = 0,
		videoWidth,
		videoHeight,
	} = context.config;

	const layout = computePaddedLayout({
		width,
		height,
		padding,
		frameInsets: null,
		cropRegion,
		videoWidth,
		videoHeight,
	});

	context.videoSprite.scale.set(layout.scale);
	context.videoSprite.position.set(layout.spriteX, layout.spriteY);

	context.videoContainer.position.set(0, 0);

	const scaledBorderRadius = scalePreviewBorderRadius(
		layout.croppedDisplayWidth,
		layout.croppedDisplayHeight,
		borderRadius,
		{ width, height },
	);

	context.maskGraphics.clear();
	drawSquircleOnGraphics(context.maskGraphics, {
		x: layout.centerOffsetX,
		y: layout.centerOffsetY,
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
		radius: scaledBorderRadius,
	});
	context.maskGraphics.fill({ color: 0xffffff });

	// Cache layout info
	context.layoutCache = {
		stageSize: { width, height },
		videoSize: {
			width: videoWidth * cropRegion.width,
			height: videoHeight * cropRegion.height,
		},
		baseScale: layout.scale,
		baseOffset: { x: layout.spriteX, y: layout.spriteY },
		maskRect: {
			x: layout.centerOffsetX,
			y: layout.centerOffsetY,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			sourceCrop: cropRegion,
		},
	};
}

export function updateAnimationState(
	context: Pick<
		LegacyFrameRendererContext,
		| "cameraContainer"
		| "layoutCache"
		| "config"
		| "cursorFollowCamera"
		| "animationState"
		| "lastContentTimeMs"
		| "springScale"
		| "springX"
		| "springY"
	>,
	timeMs: number,
	cursorTimeMs: number = timeMs,
): number {
	if (!context.cameraContainer || !context.layoutCache) return 0;

	const target = resolveSceneZoomTarget({
		zoomRegions: context.config.zoomRegions,
		timeMs,
		cursorTimeMs,
		connectZooms: context.config.connectZooms,
		zoomInDurationMs: context.config.zoomInDurationMs,
		zoomOutDurationMs: context.config.zoomOutDurationMs,
		connectedZoomGapMs: context.config.connectedZoomGapMs,
		connectedZoomDurationMs: context.config.connectedZoomDurationMs,
		zoomClassicMode: context.config.zoomClassicMode,
		cursorTelemetry: context.config.cursorTelemetry,
		cursorFollowCamera: context.cursorFollowCamera,
		sourceCrop: context.config.cropRegion,
	});

	const state = context.animationState;

	const prevScale = state.appliedScale;
	const prevX = state.x;
	const prevY = state.y;

	state.scale = target.scale;
	state.focusX = target.focus.cx;
	state.focusY = target.focus.cy;
	state.progress = target.progress;

	const deltaMs =
		context.lastContentTimeMs !== null ? timeMs - context.lastContentTimeMs : 1000 / 60;
	context.lastContentTimeMs = timeMs;
	const transform = computeCameraTransform({
		target,
		stageSize: context.layoutCache.stageSize,
		baseMask: context.layoutCache.maskRect,
		springScale: context.springScale,
		springX: context.springX,
		springY: context.springY,
		deltaMs,
		snap: context.config.zoomClassicMode,
		zoomSmoothness: context.config.zoomSmoothness,
		tuning: {
			stiffnessMultiplier: context.config.cameraSpringStiffnessMultiplier,
			dampingMultiplier: context.config.cameraSpringDampingMultiplier,
			massMultiplier: context.config.cameraSpringMassMultiplier,
		},
	});
	state.appliedScale = transform.scale;
	state.x = transform.x;
	state.y = transform.y;

	return Math.max(
		Math.abs(state.appliedScale - prevScale),
		Math.abs(state.x - prevX) / Math.max(1, context.layoutCache.stageSize.width),
		Math.abs(state.y - prevY) / Math.max(1, context.layoutCache.stageSize.height),
	);
}
