import { Application, Graphics, Sprite } from "pixi.js";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import type { CropRegion, Padding } from "../types";

export const PADDING_SCALE_FACTOR = 0.2;
export const BASE_PREVIEW_WIDTH = 1920;
export const BASE_PREVIEW_HEIGHT = 1080;

export function scalePreviewBorderRadius(width: number, height: number, borderRadius = 0): number {
	if (width <= 0 || height <= 0) {
		return 0;
	}

	const canvasScaleFactor = Math.min(width / BASE_PREVIEW_WIDTH, height / BASE_PREVIEW_HEIGHT);
	return Math.max(0, borderRadius * canvasScaleFactor);
}

export function isZeroPadding(padding: Padding | number): boolean {
	if (typeof padding === "number") {
		return padding === 0;
	}
	return padding.top === 0 && padding.bottom === 0 && padding.left === 0 && padding.right === 0;
}

export interface PaddedLayoutResult {
	scale: number;
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
}

interface LayoutGeometryParams {
	width: number;
	height: number;
	cropRegion: CropRegion;
	videoWidth: number;
	videoHeight: number;
}

function computeLayoutVariant(
	params: LayoutGeometryParams,
	options: {
		padding: Padding | number;
		frameInsets: { top: number; right: number; bottom: number; left: number } | null;
		fit: "contain" | "cover";
	},
): PaddedLayoutResult {
	const { width, height, cropRegion, videoWidth, videoHeight } = params;
	const { padding, frameInsets, fit } = options;

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

	const scaleW = fullFrameVideoW > 0 ? maxDisplayWidth / fullFrameVideoW : 0;
	const scaleH = fullFrameVideoH > 0 ? maxDisplayHeight / fullFrameVideoH : 0;
	const scale = fit === "cover" ? Math.max(scaleW, scaleH) : Math.min(scaleW, scaleH);

	const fullVideoDisplayWidth = videoWidth * scale;
	const fullVideoDisplayHeight = videoHeight * scale;
	const croppedDisplayWidth = croppedVideoWidth * scale;
	const croppedDisplayHeight = croppedVideoHeight * scale;

	const fullFrameDisplayW = fullFrameVideoW * scale;
	const fullFrameDisplayH = fullFrameVideoH * scale;

	const availableCenterX = leftPadFrac * width + maxDisplayWidth / 2;
	const availableCenterY = topPadFrac * height + maxDisplayHeight / 2;

	const frameCenterX = availableCenterX - fullFrameDisplayW / 2;
	const frameCenterY = availableCenterY - fullFrameDisplayH / 2;

	const centerOffsetX = insets ? frameCenterX + insets.left * fullFrameDisplayW : frameCenterX;
	const centerOffsetY = insets ? frameCenterY + insets.top * fullFrameDisplayH : frameCenterY;

	const spriteX = centerOffsetX - crop.x * fullVideoDisplayWidth;
	const spriteY = centerOffsetY - crop.y * fullVideoDisplayHeight;

	return {
		scale,
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
		cropStartX: crop.x * videoWidth,
		cropStartY: crop.y * videoHeight,
	};
}

/**
 * Computes the framed (padded, contain-fit) layout. `fillFrameProgress`
 * animates toward a cover layout (no padding/insets, video covers the canvas,
 * overflow cropped): 0 is the framed result, 1 is the cover result, and
 * in-between values linearly interpolate every field. The caller passes
 * already-eased progress.
 */
export function computePaddedLayout(params: {
	width: number;
	height: number;
	padding: Padding | number;
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
	cropRegion: CropRegion;
	videoWidth: number;
	videoHeight: number;
	fillFrameProgress?: number;
}): PaddedLayoutResult {
	const rawProgress = params.fillFrameProgress;
	const progress = Number.isFinite(rawProgress)
		? Math.min(1, Math.max(0, rawProgress as number))
		: 0;

	const framed = computeLayoutVariant(params, {
		padding: params.padding,
		frameInsets: params.frameInsets ?? null,
		fit: "contain",
	});
	if (progress <= 0) return framed;

	const cover = computeLayoutVariant(params, {
		padding: 0,
		frameInsets: null,
		fit: "cover",
	});
	if (progress >= 1) return cover;

	const lerp = (a: number, b: number) => a + (b - a) * progress;
	return {
		scale: lerp(framed.scale, cover.scale),
		centerOffsetX: lerp(framed.centerOffsetX, cover.centerOffsetX),
		centerOffsetY: lerp(framed.centerOffsetY, cover.centerOffsetY),
		spriteX: lerp(framed.spriteX, cover.spriteX),
		spriteY: lerp(framed.spriteY, cover.spriteY),
		fullFrameDisplayW: lerp(framed.fullFrameDisplayW, cover.fullFrameDisplayW),
		fullFrameDisplayH: lerp(framed.fullFrameDisplayH, cover.fullFrameDisplayH),
		fullVideoDisplayWidth: lerp(framed.fullVideoDisplayWidth, cover.fullVideoDisplayWidth),
		fullVideoDisplayHeight: lerp(framed.fullVideoDisplayHeight, cover.fullVideoDisplayHeight),
		croppedDisplayWidth: lerp(framed.croppedDisplayWidth, cover.croppedDisplayWidth),
		croppedDisplayHeight: lerp(framed.croppedDisplayHeight, cover.croppedDisplayHeight),
		cropStartX: lerp(framed.cropStartX, cover.cropStartX),
		cropStartY: lerp(framed.cropStartY, cover.cropStartY),
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
	/** Screen insets from the active device frame, used to scale/center the full frame */
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
	/** Eased 0..1 fill-frame progress; 1 means the video covers the canvas. */
	fillFrameProgress?: number;
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
		frameInsets,
		fillFrameProgress = 0,
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
		videoWidth,
		videoHeight,
		fillFrameProgress,
	});

	videoSprite.scale.set(layout.scale);
	videoSprite.position.set(layout.spriteX, layout.spriteY);

	maskGraphics.clear();
	drawSquircleOnGraphics(maskGraphics, {
		x: layout.centerOffsetX,
		y: layout.centerOffsetY,
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
		radius:
			scalePreviewBorderRadius(width, height, borderRadius) *
			(1 - Math.min(1, Math.max(0, fillFrameProgress))),
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
			sourceCrop: crop,
		},
		cropBounds: {
			startX: layout.cropStartX,
			endX: layout.cropStartX + videoWidth * crop.width,
			startY: layout.cropStartY,
			endY: layout.cropStartY + videoHeight * crop.height,
		},
	};
}
