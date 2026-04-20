import { Sprite } from "pixi.js";
import {
	getWebcamOverlayPosition,
	getWebcamOverlaySizePx,
} from "@/components/video-editor/webcamOverlay";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import type { MutableVideoTextureSource, WebcamLayoutCache, WebcamRenderSource } from "./frameRendererTypes";
import type { FrameRenderer } from "./modernFrameRenderer";
import {
	applyCoverLayoutToSprite,
	areNearlyEqual,
	clampUnitInterval,
	configureHighQuality2DContext,
	createTextureFromSource,
	replaceSpriteTexture,
} from "./frameRendererHelpers";
import { rasterizeShadowLayer } from "./frameRendererHelpers";

function getWebcamSourceDimensions(source: HTMLVideoElement | VideoFrame): {
	width: number;
	height: number;
} {
	if ("displayWidth" in source && "displayHeight" in source) {
		return {
			width: source.displayWidth,
			height: source.displayHeight,
		};
	}

	return {
		width: source.videoWidth,
		height: source.videoHeight,
	};
}

export function closeWebcamDecodedFrame(self: FrameRenderer): void {
	if (!self.webcamDecodedFrame) {
		return;
	}

	self.webcamDecodedFrame.close();
	self.webcamDecodedFrame = null;
}

export function ensureWebcamSprite(
	self: FrameRenderer,
	source: CanvasImageSource | VideoFrame,
	sourceWidth: number,
	sourceHeight: number,
): void {
	if (!self.webcamContainer) {
		return;
	}

	const resolvedSource =
		typeof VideoFrame !== "undefined" && source instanceof VideoFrame
			? self.stageVideoFrameForTexture(source, "webcam", sourceWidth, sourceHeight)
			: source;
	const usesStartupStaging = resolvedSource !== source;

	if (!self.webcamSprite) {
		const texture = createTextureFromSource(resolvedSource);
		self.webcamSprite = new Sprite(texture);
		self.webcamTextureSource = texture.source as unknown as MutableVideoTextureSource;
		self.webcamContainer.addChildAt(self.webcamSprite, 0);
		self.webcamTextureUsesStartupStaging = usesStartupStaging;
	} else if (self.webcamTextureUsesStartupStaging !== usesStartupStaging) {
		self.webcamTextureSource = replaceSpriteTexture(self.webcamSprite, resolvedSource);
		self.webcamTextureUsesStartupStaging = usesStartupStaging;
	} else if (self.webcamTextureSource) {
		self.webcamTextureSource.resource = resolvedSource;
		self.webcamTextureSource.update();
	}

	if (self.webcamRootContainer) {
		self.webcamRootContainer.visible = sourceWidth > 0 && sourceHeight > 0;
	}
}

function setWebcamRenderMode(self: FrameRenderer, nextMode: "hidden" | "live" | "cached"): void {
	if (self.webcamRenderMode === nextMode) {
		return;
	}

	if (nextMode === "cached") {
		console.log("[FrameRenderer] Webcam export source fell back to the last synced frame");
	} else if (self.webcamRenderMode === "cached" && nextMode === "live") {
		console.log("[FrameRenderer] Webcam export source resynchronized");
	}

	self.webcamRenderMode = nextMode;
}

function shouldRefreshWebcamFrameCache(
	self: FrameRenderer,
	width: number,
	height: number,
): boolean {
	const targetWidth = Math.max(1, Math.ceil(width));
	const targetHeight = Math.max(1, Math.ceil(height));

	if (
		!self.webcamFrameCacheCanvas ||
		self.webcamFrameCacheCanvas.width !== targetWidth ||
		self.webcamFrameCacheCanvas.height !== targetHeight
	) {
		return true;
	}

	if (self.lastWebcamCacheRefreshTime === null) {
		return true;
	}

	return Math.abs(self.currentVideoTime - self.lastWebcamCacheRefreshTime) >= 0.25;
}

function ensureWebcamFrameCache(self: FrameRenderer, width: number, height: number): boolean {
	const targetWidth = Math.max(1, Math.ceil(width));
	const targetHeight = Math.max(1, Math.ceil(height));

	if (
		self.webcamFrameCacheCanvas &&
		self.webcamFrameCacheCanvas.width === targetWidth &&
		self.webcamFrameCacheCanvas.height === targetHeight &&
		self.webcamFrameCacheCtx
	) {
		return true;
	}

	self.webcamFrameCacheCanvas = document.createElement("canvas");
	self.webcamFrameCacheCanvas.width = targetWidth;
	self.webcamFrameCacheCanvas.height = targetHeight;
	self.webcamFrameCacheCtx = configureHighQuality2DContext(
		self.webcamFrameCacheCanvas.getContext("2d"),
	);

	return !!self.webcamFrameCacheCtx;
}

function refreshWebcamFrameCache(
	self: FrameRenderer,
	source: CanvasImageSource | VideoFrame,
	width: number,
	height: number,
): boolean {
	if (!ensureWebcamFrameCache(self, width, height)) {
		return false;
	}

	if (!self.webcamFrameCacheCanvas || !self.webcamFrameCacheCtx) {
		return false;
	}

	self.webcamFrameCacheCtx.clearRect(
		0,
		0,
		self.webcamFrameCacheCanvas.width,
		self.webcamFrameCacheCanvas.height,
	);
	self.webcamFrameCacheCtx.drawImage(
		source,
		0,
		0,
		self.webcamFrameCacheCanvas.width,
		self.webcamFrameCacheCanvas.height,
	);
	self.lastWebcamCacheRefreshTime = self.currentVideoTime;
	return true;
}

function getCachedWebcamRenderSource(self: FrameRenderer): WebcamRenderSource | null {
	if (
		!self.webcamFrameCacheCanvas ||
		self.webcamFrameCacheCanvas.width <= 0 ||
		self.webcamFrameCacheCanvas.height <= 0
	) {
		return null;
	}

	return {
		source: self.webcamFrameCacheCanvas,
		width: self.webcamFrameCacheCanvas.width,
		height: self.webcamFrameCacheCanvas.height,
		mode: "cached",
	};
}

function resolveRenderableWebcamSource(
	self: FrameRenderer,
	liveSource: CanvasImageSource | VideoFrame | null,
	liveSourceWidth: number,
	liveSourceHeight: number,
	canUseLiveSource: boolean,
): WebcamRenderSource | null {
	if (canUseLiveSource && liveSource && liveSourceWidth > 0 && liveSourceHeight > 0) {
		if (shouldRefreshWebcamFrameCache(self, liveSourceWidth, liveSourceHeight)) {
			refreshWebcamFrameCache(self, liveSource, liveSourceWidth, liveSourceHeight);
		}
		setWebcamRenderMode(self, "live");
		return {
			source: liveSource,
			width: liveSourceWidth,
			height: liveSourceHeight,
			mode: "live",
		};
	}

	const cachedSource = getCachedWebcamRenderSource(self);
	if (cachedSource) {
		setWebcamRenderMode(self, "cached");
		return cachedSource;
	}

	if (canUseLiveSource && liveSource && liveSourceWidth > 0 && liveSourceHeight > 0) {
		setWebcamRenderMode(self, "live");
		return {
			source: liveSource,
			width: liveSourceWidth,
			height: liveSourceHeight,
			mode: "live",
		};
	}

	setWebcamRenderMode(self, "hidden");
	return null;
}

function hasMatchingWebcamLayout(
	self: FrameRenderer,
	nextLayout: WebcamLayoutCache,
): boolean {
	const previousLayout = self.webcamLayoutCache;
	if (!previousLayout) {
		return false;
	}

	return (
		previousLayout.mirror === nextLayout.mirror &&
		areNearlyEqual(previousLayout.sourceWidth, nextLayout.sourceWidth) &&
		areNearlyEqual(previousLayout.sourceHeight, nextLayout.sourceHeight) &&
		areNearlyEqual(previousLayout.size, nextLayout.size) &&
		areNearlyEqual(previousLayout.positionX, nextLayout.positionX) &&
		areNearlyEqual(previousLayout.positionY, nextLayout.positionY) &&
		areNearlyEqual(previousLayout.radius, nextLayout.radius) &&
		areNearlyEqual(previousLayout.shadowStrength, nextLayout.shadowStrength)
	);
}

function applyWebcamLayout(self: FrameRenderer, nextLayout: WebcamLayoutCache): void {
	if (!self.webcamRootContainer || !self.webcamSprite || !self.webcamMaskGraphics) {
		return;
	}

	self.webcamRootContainer.position.set(nextLayout.positionX, nextLayout.positionY);

	applyCoverLayoutToSprite(
		self.webcamSprite,
		nextLayout.sourceWidth,
		nextLayout.sourceHeight,
		nextLayout.size,
		nextLayout.size,
		nextLayout.size / 2,
		nextLayout.size / 2,
		nextLayout.mirror,
	);

	self.webcamMaskGraphics.clear();
	drawSquircleOnGraphics(self.webcamMaskGraphics, {
		x: 0,
		y: 0,
		width: nextLayout.size,
		height: nextLayout.size,
		radius: nextLayout.radius,
	});
	self.webcamMaskGraphics.fill({ color: 0xffffff });

	for (const layer of self.webcamShadowLayers) {
		if (nextLayout.shadowStrength <= 0) {
			layer.container.visible = false;
			continue;
		}

		const offsetY = nextLayout.size * layer.offsetScale * nextLayout.shadowStrength;
		rasterizeShadowLayer(layer, {
			x: 0,
			y: 0,
			width: nextLayout.size,
			height: nextLayout.size,
			radius: nextLayout.radius,
			offsetY,
			alpha: layer.alphaScale * nextLayout.shadowStrength,
			blur: Math.max(0, nextLayout.size * layer.blurScale * nextLayout.shadowStrength),
		});
	}

	self.webcamLayoutCache = { ...nextLayout };
}

export function updateWebcamOverlay(self: FrameRenderer): void {
	const webcam = self.config.webcam;
	if (!webcam?.enabled || !self.webcamRootContainer || !self.webcamMaskGraphics) {
		if (self.webcamRootContainer) {
			self.webcamRootContainer.visible = false;
		}
		self.webcamLayoutCache = null;
		setWebcamRenderMode(self, "hidden");
		return;
	}

	const webcamSource = self.webcamDecodedFrame ?? self.webcamVideoElement;
	const liveSourceDimensions = webcamSource
		? getWebcamSourceDimensions(webcamSource)
		: { width: 0, height: 0 };
	const activeWebcamVideoElement =
		webcamSource === self.webcamVideoElement ? self.webcamVideoElement : null;
	const webcamTimeDrift =
		self.lastSyncedWebcamTime === null
			? 0
			: Math.abs(self.lastSyncedWebcamTime - self.currentVideoTime);
	const canUseLiveSource =
		!!webcamSource &&
		liveSourceDimensions.width > 0 &&
		liveSourceDimensions.height > 0 &&
		webcamTimeDrift <= 0.08 &&
		(!activeWebcamVideoElement ||
			(activeWebcamVideoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
				!activeWebcamVideoElement.seeking));
	const renderableWebcamSource = resolveRenderableWebcamSource(
		self,
		webcamSource,
		liveSourceDimensions.width,
		liveSourceDimensions.height,
		canUseLiveSource,
	);

	if (!renderableWebcamSource) {
		self.webcamRootContainer.visible = false;
		self.webcamLayoutCache = null;
		return;
	}

	ensureWebcamSprite(
		self,
		renderableWebcamSource.source,
		renderableWebcamSource.width,
		renderableWebcamSource.height,
	);
	if (!self.webcamSprite) {
		self.webcamRootContainer.visible = false;
		return;
	}

	const margin = webcam.margin ?? 24;
	const size = getWebcamOverlaySizePx({
		containerWidth: self.config.width,
		containerHeight: self.config.height,
		sizePercent: webcam.size ?? 50,
		margin,
		zoomScale: self.animationState.appliedScale || 1,
		reactToZoom: webcam.reactToZoom ?? true,
	});
	const position = getWebcamOverlayPosition({
		containerWidth: self.config.width,
		containerHeight: self.config.height,
		size,
		margin,
		positionPreset: webcam.positionPreset ?? webcam.corner,
		positionX: webcam.positionX ?? 1,
		positionY: webcam.positionY ?? 1,
		legacyCorner: webcam.corner,
	});
	const radius = Math.max(0, webcam.cornerRadius ?? 18);
	const shadowStrength = clampUnitInterval(webcam.shadow ?? 0);

	self.webcamRootContainer.visible = true;

	const nextLayout: WebcamLayoutCache = {
		sourceWidth: renderableWebcamSource.width,
		sourceHeight: renderableWebcamSource.height,
		size,
		positionX: position.x,
		positionY: position.y,
		radius,
		shadowStrength,
		mirror: webcam.mirror,
	};

	if (!hasMatchingWebcamLayout(self, nextLayout)) {
		applyWebcamLayout(self, nextLayout);
	}
}
