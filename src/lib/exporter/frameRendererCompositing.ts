import { Sprite, Texture } from "pixi.js";
import {
	mapCursorToCanvasNormalized,
	mapSmoothedCursorToCanvasNormalized,
} from "@/lib/extensions/cursorCoordinates";
import {
	executeExtensionCursorEffects,
	executeExtensionRenderHooks,
	notifyCursorInteraction,
} from "@/lib/extensions/renderHooks";
import { applyCanvasSceneTransform } from "@/lib/extensions/sceneTransform";
import { extensionHost } from "@/lib/extensions";
import type { ExportCompositeCanvasState } from "./frameRendererTypes";
import type { FrameRenderer } from "./modernFrameRenderer";
import {
	renderAnnotations,
	renderAnnotationToCanvas,
} from "./annotationRenderer";
import { configureHighQuality2DContext } from "./frameRendererHelpers";

export function calculateAnnotationScaleFactor(self: FrameRenderer): number {
	const previewWidth = self.config.previewWidth || 1920;
	const previewHeight = self.config.previewHeight || 1080;
	const scaleX = self.config.width / previewWidth;
	const scaleY = self.config.height / previewHeight;
	return (scaleX + scaleY) / 2;
}

export function hasActiveBlurAnnotations(self: FrameRenderer, timeMs: number): boolean {
	return (self.config.annotationRegions ?? []).some(
		(annotation) =>
			annotation.type === "blur" &&
			timeMs >= annotation.startMs &&
			timeMs <= annotation.endMs,
	);
}

function ensureExportCompositeCanvas(self: FrameRenderer): ExportCompositeCanvasState | null {
	const targetWidth = Math.max(1, Math.ceil(self.config.width));
	const targetHeight = Math.max(1, Math.ceil(self.config.height));

	if (
		self.exportCompositeCanvas &&
		self.exportCompositeCanvas.canvas.width === targetWidth &&
		self.exportCompositeCanvas.canvas.height === targetHeight
	) {
		return self.exportCompositeCanvas;
	}

	const canvas = document.createElement("canvas");
	canvas.width = targetWidth;
	canvas.height = targetHeight;

	const context = configureHighQuality2DContext(canvas.getContext("2d"));
	if (!context) {
		return null;
	}

	self.exportCompositeCanvas = { canvas, context };
	return self.exportCompositeCanvas;
}

export function drawCaptionOverlay(self: FrameRenderer, context: CanvasRenderingContext2D): void {
	if (
		!self.captionContainer?.visible ||
		!self.captionSprite?.visible ||
		!self.captionCanvas
	) {
		return;
	}

	const drawWidth = self.captionCanvas.width * self.captionSprite.scale.x;
	const drawHeight = self.captionCanvas.height * self.captionSprite.scale.y;
	const drawX = self.captionSprite.x - drawWidth * self.captionSprite.anchor.x;
	const drawY = self.captionSprite.y - drawHeight * self.captionSprite.anchor.y;

	context.save();
	context.globalAlpha = self.captionSprite.alpha;
	context.drawImage(self.captionCanvas, drawX, drawY, drawWidth, drawHeight);
	context.restore();
}

export async function composeBlurAnnotationFrame(
	self: FrameRenderer,
	timeMs: number,
): Promise<void> {
	if (!self.app) {
		self.outputCanvasOverride = null;
		return;
	}

	const compositeState = ensureExportCompositeCanvas(self);
	if (!compositeState) {
		self.outputCanvasOverride = null;
		return;
	}

	const { canvas, context } = compositeState;
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.drawImage(self.app.canvas as HTMLCanvasElement, 0, 0);

	await renderAnnotations(
		context,
		self.config.annotationRegions ?? [],
		self.config.width,
		self.config.height,
		timeMs,
		self.annotationScaleFactor,
		self.annotationAssets ?? undefined,
	);

	drawCaptionOverlay(self, context);
	self.outputCanvasOverride = canvas;
}

export async function setupAnnotationLayer(self: FrameRenderer): Promise<void> {
	if (!self.annotationContainer) {
		return;
	}

	for (const entry of self.annotationSprites) {
		entry.sprite.destroy({ texture: false, textureSource: false });
		entry.texture.destroy(true);
	}
	self.annotationSprites = [];
	self.annotationContainer.removeChildren();

	const annotations = [...(self.config.annotationRegions ?? [])].sort(
		(first, second) => first.zIndex - second.zIndex,
	);

	for (const annotation of annotations) {
		const x = (annotation.position.x / 100) * self.config.width;
		const y = (annotation.position.y / 100) * self.config.height;
		const width = (annotation.size.width / 100) * self.config.width;
		const height = (annotation.size.height / 100) * self.config.height;

		if (width <= 0 || height <= 0) {
			continue;
		}

		const canvas = await renderAnnotationToCanvas(
			annotation,
			width,
			height,
			self.annotationScaleFactor,
			self.annotationAssets ?? undefined,
		);
		if (!canvas) {
			continue;
		}

		const texture = Texture.from(canvas);
		const sprite = new Sprite(texture);
		sprite.position.set(x, y);
		sprite.visible = false;
		self.annotationContainer.addChild(sprite);
		self.annotationSprites.push({ annotation, sprite, texture });
	}
}

export function updateAnnotationLayer(self: FrameRenderer, currentTimeMs: number): void {
	for (const entry of self.annotationSprites) {
		entry.sprite.visible =
			currentTimeMs >= entry.annotation.startMs &&
			currentTimeMs <= entry.annotation.endMs;
	}
}

export function shouldCompositeExtensionFrame(): boolean {
	return (
		extensionHost.hasCursorEffects() ||
		extensionHost.hasRenderHooks("post-zoom") ||
		extensionHost.hasRenderHooks("post-cursor") ||
		extensionHost.hasRenderHooks("post-annotations") ||
		extensionHost.hasRenderHooks("final")
	);
}

export function compositeExtensions(
	self: FrameRenderer,
	timeMs: number,
	cursorTimeMs: number,
): void {
	if (!self.app || !self.compositeCtx || !self.compositeCanvas) {
		return;
	}

	if (!shouldCompositeExtensionFrame()) {
		return;
	}

	self.compositeCtx.clearRect(0, 0, self.config.width, self.config.height);
	self.compositeCtx.drawImage(self.app.canvas as HTMLCanvasElement, 0, 0);

	const maskRect = self.layoutCache?.maskRect;
	const smoothedCursor = mapSmoothedCursorToCanvasNormalized(
		self.cursorOverlay?.getSmoothedCursorSnapshot() ?? null,
		{
			maskRect,
			canvasWidth: self.config.width,
			canvasHeight: self.config.height,
		},
	);
	extensionHost.setSmoothedCursor(
		smoothedCursor
			? {
					timeMs,
					cx: smoothedCursor.cx,
					cy: smoothedCursor.cy,
					trail: smoothedCursor.trail,
				}
			: null,
	);
	const rawCursor = getCursorPosition(self, cursorTimeMs);
	const hookParams = {
		width: self.config.width,
		height: self.config.height,
		timeMs,
		durationMs: 0,
		cursor: smoothedCursor
			? {
					cx: smoothedCursor.cx,
					cy: smoothedCursor.cy,
					interactionType: rawCursor?.interactionType,
				}
			: rawCursor,
		smoothedCursor,
		videoLayout: maskRect
			? {
					maskRect: {
						x: maskRect.x,
						y: maskRect.y,
						width: maskRect.width,
						height: maskRect.height,
					},
					borderRadius: self.config.borderRadius ?? 0,
					padding: self.config.padding ?? 0,
				}
			: undefined,
		zoom: {
			scale: self.animationState.scale,
			focusX: self.animationState.focusX,
			focusY: self.animationState.focusY,
			progress: self.animationState.progress,
		},
		shadow: {
			enabled: self.config.showShadow,
			intensity: self.config.shadowIntensity,
		},
		sceneTransform: {
			scale: self.animationState.appliedScale,
			x: self.animationState.x,
			y: self.animationState.y,
		},
	};

	self.compositeCtx.save();
	applyCanvasSceneTransform(self.compositeCtx, {
		scale: self.animationState.appliedScale,
		x: self.animationState.x,
		y: self.animationState.y,
	});
	executeExtensionRenderHooks("post-video", self.compositeCtx, hookParams);
	executeExtensionRenderHooks("post-zoom", self.compositeCtx, hookParams);
	executeExtensionRenderHooks("post-cursor", self.compositeCtx, hookParams);
	emitCursorInteractions(self, cursorTimeMs);
	executeExtensionCursorEffects(
		self.compositeCtx,
		timeMs,
		self.config.width,
		self.config.height,
		{
			zoom: hookParams.zoom,
			sceneTransform: hookParams.sceneTransform,
			videoLayout: hookParams.videoLayout,
		},
	);
	self.compositeCtx.restore();

	executeExtensionRenderHooks("post-webcam", self.compositeCtx, hookParams);
	executeExtensionRenderHooks("post-annotations", self.compositeCtx, hookParams);
	executeExtensionRenderHooks("final", self.compositeCtx, hookParams);
}

export function getCursorPosition(
	self: FrameRenderer,
	timeMs: number,
): { cx: number; cy: number; interactionType?: string } | null {
	const telemetry = self.config.cursorTelemetry;
	if (!telemetry || telemetry.length === 0) {
		return null;
	}

	if (timeMs <= telemetry[0].timeMs) {
		const s = telemetry[0];
		return mapCursorToCanvasNormalized(
			{ cx: s.cx, cy: s.cy, interactionType: s.interactionType },
			{
				maskRect: self.layoutCache?.maskRect,
				canvasWidth: self.config.width,
				canvasHeight: self.config.height,
			},
		);
	}
	if (timeMs >= telemetry[telemetry.length - 1].timeMs) {
		const s = telemetry[telemetry.length - 1];
		return mapCursorToCanvasNormalized(
			{ cx: s.cx, cy: s.cy, interactionType: s.interactionType },
			{
				maskRect: self.layoutCache?.maskRect,
				canvasWidth: self.config.width,
				canvasHeight: self.config.height,
			},
		);
	}

	let lo = 0;
	let hi = telemetry.length - 1;
	while (lo < hi - 1) {
		const mid = (lo + hi) >> 1;
		if (telemetry[mid].timeMs <= timeMs) {
			lo = mid;
		} else {
			hi = mid;
		}
	}

	const a = telemetry[lo];
	const b = telemetry[hi];
	const span = b.timeMs - a.timeMs;

	const t = span > 0 ? (timeMs - a.timeMs) / span : 0;
	const cx = a.cx + (b.cx - a.cx) * t;
	const cy = a.cy + (b.cy - a.cy) * t;

	return mapCursorToCanvasNormalized(
		{ cx, cy, interactionType: a.interactionType },
		{
			maskRect: self.layoutCache?.maskRect,
			canvasWidth: self.config.width,
			canvasHeight: self.config.height,
		},
	);
}

function emitCursorInteractions(self: FrameRenderer, timeMs: number): void {
	const telemetry = self.config.cursorTelemetry;
	if (!telemetry || telemetry.length === 0) {
		return;
	}

	for (const point of telemetry) {
		if (point.timeMs > timeMs) {
			break;
		}
		if (point.timeMs < timeMs - 100) {
			continue;
		}
		if (!point.interactionType || point.interactionType === "move") {
			continue;
		}
		if (point.timeMs === self.lastEmittedClickTimeMs) {
			continue;
		}

		const mappedCursor = mapCursorToCanvasNormalized(
			{ cx: point.cx, cy: point.cy, interactionType: point.interactionType },
			{
				maskRect: self.layoutCache?.maskRect,
				canvasWidth: self.config.width,
				canvasHeight: self.config.height,
			},
		);
		if (!mappedCursor) {
			continue;
		}

		self.lastEmittedClickTimeMs = point.timeMs;
		notifyCursorInteraction(
			point.timeMs,
			mappedCursor.cx,
			mappedCursor.cy,
			point.interactionType,
		);
	}
}
