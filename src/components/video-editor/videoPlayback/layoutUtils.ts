import { Application, Graphics, Sprite } from "pixi.js";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import type { CropRegion, Padding } from "../types";

export const PADDING_SCALE_FACTOR = 0.2;

export function isZeroPadding(padding: Padding | number): boolean {
	if (typeof padding === "number") {
		return padding === 0;
	}
	return (
		padding.top === 0 &&
		padding.bottom === 0 &&
		padding.left === 0 &&
		padding.right === 0
	);
}

export interface PaddedLayoutResult {
	scale: number;
	viewportScale: number;
	centerOffsetX: number;
	centerOffsetY: number;
	spriteX: number;
	spriteY: number;
	fullFrameDisplayW: number;
	fullFrameDisplayH: number;
	fullVideoDisplayWidth: number;
	fullVideoDisplayHeight: number;
	croppedDisplayWidth: number;
	croppedDisplayHeight: number;
	cropStartX: number;
	cropStartY: number;
	visibleSourceCrop: CropRegion;
}

export function computePaddedLayout(params: {
	width: number;
	height: number;
	padding: Padding | number;
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
	cropRegion: CropRegion;
	sceneScale?: number;
	videoWidth: number;
	videoHeight: number;
}): PaddedLayoutResult {
	const { width, height, padding, frameInsets, cropRegion, videoWidth, videoHeight } = params;
	const sceneScale =
		typeof params.sceneScale === "number" && Number.isFinite(params.sceneScale)
			? Math.max(1, params.sceneScale)
			: 1;

	// Apply asymmetrical padding
	const p =
		typeof padding === "number"
			? { top: padding, bottom: padding, left: padding, right: padding }
			: padding;

	// Padding is a percentage (0-100)
	// Clamp to ensure we don't have overlapping padding that exceeds 100% of a dimension
	const clampPercent = (v: number) => Math.min(100, Math.max(0, v));
	const leftPadFrac = (clampPercent(p.left) / 100) * PADDING_SCALE_FACTOR;
	const rightPadFrac = (clampPercent(p.right) / 100) * PADDING_SCALE_FACTOR;
	const topPadFrac = (clampPercent(p.top) / 100) * PADDING_SCALE_FACTOR;
	const bottomPadFrac = (clampPercent(p.bottom) / 100) * PADDING_SCALE_FACTOR;

	const availableFracW = Math.max(0, 1.0 - leftPadFrac - rightPadFrac);
	const availableFracH = Math.max(0, 1.0 - topPadFrac - bottomPadFrac);

	const maxDisplayWidth = width * availableFracW;
	const maxDisplayHeight = height * availableFracH;

	const crop = cropRegion;
	const croppedVideoWidth = videoWidth * crop.width;
	const croppedVideoHeight = videoHeight * crop.height;

	const insets = frameInsets;
	const screenFracW = insets ? 1 - insets.left - insets.right : 1;
	const screenFracH = insets ? 1 - insets.top - insets.bottom : 1;

	const fullFrameVideoW = croppedVideoWidth / screenFracW;
	const fullFrameVideoH = croppedVideoHeight / screenFracH;

	const viewportScale = Math.min(
		fullFrameVideoW > 0 ? maxDisplayWidth / fullFrameVideoW : 0,
		fullFrameVideoH > 0 ? maxDisplayHeight / fullFrameVideoH : 0,
	);
	const scale = viewportScale * sceneScale;

	const fullVideoDisplayWidth = videoWidth * scale;
	const fullVideoDisplayHeight = videoHeight * scale;
	const croppedDisplayWidth = croppedVideoWidth * viewportScale;
	const croppedDisplayHeight = croppedVideoHeight * viewportScale;

	const fullFrameDisplayW = fullFrameVideoW * viewportScale;
	const fullFrameDisplayH = fullFrameVideoH * viewportScale;

	const availableCenterX = leftPadFrac * width + maxDisplayWidth / 2;
	const availableCenterY = topPadFrac * height + maxDisplayHeight / 2;

	const frameCenterX = availableCenterX - fullFrameDisplayW / 2;
	const frameCenterY = availableCenterY - fullFrameDisplayH / 2;

	const centerOffsetX = insets
		? frameCenterX + insets.left * fullFrameDisplayW
		: frameCenterX;
	const centerOffsetY = insets
		? frameCenterY + insets.top * fullFrameDisplayH
		: frameCenterY;

	const visibleWidth = crop.width / sceneScale;
	const visibleHeight = crop.height / sceneScale;
	const visibleSourceCrop = {
		x: crop.x + (crop.width - visibleWidth) / 2,
		y: crop.y + (crop.height - visibleHeight) / 2,
		width: visibleWidth,
		height: visibleHeight,
	};

	const spriteX = centerOffsetX - visibleSourceCrop.x * fullVideoDisplayWidth;
	const spriteY = centerOffsetY - visibleSourceCrop.y * fullVideoDisplayHeight;

	return {
		scale,
		viewportScale,
		centerOffsetX,
		centerOffsetY,
		spriteX,
		spriteY,
		fullFrameDisplayW,
		fullFrameDisplayH,
		fullVideoDisplayWidth,
		fullVideoDisplayHeight,
		croppedDisplayWidth,
		croppedDisplayHeight,
		cropStartX: visibleSourceCrop.x * videoWidth,
		cropStartY: visibleSourceCrop.y * videoHeight,
		visibleSourceCrop,
	};
}

interface LayoutParams {
	container: HTMLDivElement;
	app: Application;
	videoSprite: Sprite;
	maskGraphics: Graphics;
	videoElement: HTMLVideoElement;
	cropRegion?: CropRegion;
	lockedVideoDimensions?: { width: number; height: number } | null;
	borderRadius?: number;
	padding?: Padding | number;
	sceneScale?: number;
	/** Screen insets from the active device frame, used to scale/center the full frame */
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
}

interface LayoutResult {
	stageSize: { width: number; height: number };
	videoSize: { width: number; height: number };
	baseScale: number;
	baseOffset: { x: number; y: number };
	maskRect: {
		x: number;
		y: number;
		width: number;
		height: number;
		sourceCrop?: CropRegion;
	};
	cropBounds: { startX: number; endX: number; startY: number; endY: number };
}

export function layoutVideoContent(params: LayoutParams): LayoutResult | null {
	const {
		container,
		app,
		videoSprite,
		maskGraphics,
		videoElement,
		cropRegion,
		lockedVideoDimensions,
		borderRadius = 0,
		padding = 0,
		sceneScale = 1,
		frameInsets,
	} = params;

	const videoWidth = lockedVideoDimensions?.width || videoElement.videoWidth;
	const videoHeight = lockedVideoDimensions?.height || videoElement.videoHeight;

	if (!videoWidth || !videoHeight) {
		return null;
	}

	const width = container.clientWidth;
	const height = container.clientHeight;

	if (!width || !height) {
		return null;
	}

	app.renderer.resize(width, height);
	app.canvas.style.width = "100%";
	app.canvas.style.height = "100%";

	const crop = cropRegion || { x: 0, y: 0, width: 1, height: 1 };
	const layout = computePaddedLayout({
		width,
		height,
		padding,
		frameInsets,
		cropRegion: crop,
		sceneScale,
		videoWidth,
		videoHeight,
	});

	videoSprite.scale.set(layout.scale);
	videoSprite.position.set(layout.spriteX, layout.spriteY);

	maskGraphics.clear();
	drawSquircleOnGraphics(maskGraphics, {
		x: layout.centerOffsetX,
		y: layout.centerOffsetY,
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
		radius: borderRadius,
	});
	maskGraphics.fill({ color: 0xffffff });

	return {
		stageSize: { width, height },
		videoSize: { width: videoWidth * crop.width, height: videoHeight * crop.height },
		baseScale: layout.scale,
		baseOffset: { x: layout.spriteX, y: layout.spriteY },
		maskRect: {
			x: layout.centerOffsetX,
			y: layout.centerOffsetY,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			sourceCrop: layout.visibleSourceCrop,
		},
		cropBounds: {
			startX: layout.cropStartX,
			endX: layout.cropStartX + videoWidth * crop.width,
			startY: layout.cropStartY,
			endY: layout.cropStartY + videoHeight * crop.height,
		},
	};
}
