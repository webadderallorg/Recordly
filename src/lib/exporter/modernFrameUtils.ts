import { Application, Sprite } from "pixi.js";
import { DEFAULT_FOCUS } from "@/components/video-editor/videoPlayback/constants";
import type { AnimationState, PixiRendererAttempt } from "./modernFrameTypes";
export const CANVAS_RENDERER_NOT_IMPLEMENTED_HINT = "CanvasRenderer is not yet implemented";
export const NO_RENDERER_HINT = "no available renderer";
export const PIXI_RENDERER_INIT_TIMEOUT_MS = 8_000;
export const BACKGROUND_MEDIA_ELEMENT_READY_TIMEOUT_MS = 5_000;
export const WEBCAM_MEDIA_ELEMENT_READY_TIMEOUT_MS = 5_000;

export function isCanvasRenderer(application: Application): boolean {
	const rendererName = application?.renderer?.constructor?.name?.toLowerCase();
	return Boolean(
		rendererName &&
			(rendererName.includes("canvasrenderer") || rendererName.includes("canvas")),
	);
}

export function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error ?? "Unknown renderer init error");
}

export function summarizeRendererAttempts(attempts: readonly PixiRendererAttempt[]): string {
	const details = attempts.map((attempt) => `${attempt.backend}: ${attempt.message}`).join(" | ");
	return `No supported Pixi modern renderer was available. Attempted: ${details}`;
}

export function isKnownRendererUnavailableError(error: unknown): boolean {
	const message = toErrorMessage(error).toLowerCase();
	return (
		message.includes(CANVAS_RENDERER_NOT_IMPLEMENTED_HINT.toLowerCase()) ||
		message.includes(NO_RENDERER_HINT)
	);
}

export function createAnimationState(): AnimationState {
	return {
		scale: 1,
		appliedScale: 1,
		focusX: DEFAULT_FOCUS.cx,
		focusY: DEFAULT_FOCUS.cy,
		progress: 0,
		x: 0,
		y: 0,
	};
}

export function configureHighQuality2DContext(
	context: CanvasRenderingContext2D | null,
): CanvasRenderingContext2D | null {
	if (!context) {
		return null;
	}

	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";

	return context;
}

export function drawSourceCoverToCanvas(
	ctx: CanvasRenderingContext2D,
	source: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
): void {
	const safeSourceWidth = Math.max(1, sourceWidth);
	const safeSourceHeight = Math.max(1, sourceHeight);
	const sourceAspect = safeSourceWidth / safeSourceHeight;
	const targetAspect = targetWidth / targetHeight;

	let drawWidth = targetWidth;
	let drawHeight = targetHeight;
	let drawX = 0;
	let drawY = 0;

	if (sourceAspect > targetAspect) {
		drawHeight = targetHeight;
		drawWidth = drawHeight * sourceAspect;
		drawX = (targetWidth - drawWidth) / 2;
	} else {
		drawWidth = targetWidth;
		drawHeight = drawWidth / sourceAspect;
		drawY = (targetHeight - drawHeight) / 2;
	}

	ctx.clearRect(0, 0, targetWidth, targetHeight);
	ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
}

export function applyCoverLayoutToSprite(
	sprite: Sprite,
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
	centerX: number,
	centerY: number,
	mirror = false,
): void {
	const safeSourceWidth = Math.max(1, sourceWidth);
	const safeSourceHeight = Math.max(1, sourceHeight);
	const coverScale = Math.max(targetWidth / safeSourceWidth, targetHeight / safeSourceHeight);

	sprite.anchor.set(0.5);
	sprite.position.set(centerX, centerY);
	sprite.scale.set(coverScale * (mirror ? -1 : 1), coverScale);
}

export function clampUnitInterval(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function areNearlyEqual(first: number, second: number, epsilon = 0.01): boolean {
	return Math.abs(first - second) <= epsilon;
}
