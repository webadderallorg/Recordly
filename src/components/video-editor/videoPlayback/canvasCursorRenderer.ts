import { type CursorTelemetryPoint } from "../types";
import { getCursorIdleOpacity } from "./cursorIdleVisibility";
import {
	getCursorPackStyleAsset,
	getCursorStyleAsset,
	getStatefulCursorAsset,
	loadedCursorAssets,
} from "./cursorAssetRegistry";
import { drawClickEffectOnCanvas } from "./cursorClickEffects";
import { prepareCinematicCursorTelemetry } from "./cinematicCursorTelemetry";
import { interpolateCursorPosition } from "./cursorPosition";
import {
	CURSOR_SVG_DROP_SHADOW_FILTER,
	CursorAssetKey,
	CursorRenderConfig,
	DEFAULT_CURSOR_CONFIG,
	hasBakedCursorShadow,
	isSingleCursorStyle,
	isStatefulCursorStyle,
} from "./cursorRenderConfig";
import { getCursorViewportScale } from "./cursorScale";
import { type CursorViewportRect, projectCursorPositionToViewport } from "./cursorViewport";
import { getCursorVisualState } from "./cursorVisualState";
import { SmoothedCursorState } from "./smoothedCursorState";
import { getCursorStyleSizeMultiplier } from "./uploadedCursorAssets";

export function drawCursorOnCanvas(
	ctx: CanvasRenderingContext2D,
	samples: CursorTelemetryPoint[],
	timeMs: number,
	viewport: CursorViewportRect,
	smoothedState: SmoothedCursorState,
	config: CursorRenderConfig = DEFAULT_CURSOR_CONFIG,
): void {
	if (samples.length === 0 || viewport.width <= 0 || viewport.height <= 0) return;
	const idleOpacity = getCursorIdleOpacity(samples, timeMs, config.idleHide);

	samples = prepareCinematicCursorTelemetry(samples, config.smoothingFactor, config.springTuning);
	const target = interpolateCursorPosition(samples, timeMs);
	if (!target) return;

	const projectedTarget = projectCursorPositionToViewport(target, viewport.sourceCrop);
	if (!projectedTarget.visible) return;

	smoothedState.update(projectedTarget.cx, projectedTarget.cy, timeMs);

	const px = viewport.x + smoothedState.x * viewport.width;
	const py = viewport.y + smoothedState.y * viewport.height;
	const h = config.dotRadius * getCursorViewportScale(viewport.width, config.minViewportScale);
	const { cursorType, clickSample, isPressed, clickBounceProgress, clickProgress } =
		getCursorVisualState(
			samples,
			timeMs,
			config.clickBounceDuration,
			config.clickEffectDurationMs,
			config.style,
			config.clickBounce,
			config.clickEffect,
		);
	const projectedClickSample = clickSample
		? projectCursorPositionToViewport(
				isPressed && config.clickEffect !== "burst" ? target : clickSample,
				viewport.sourceCrop,
			)
		: null;
	let clickEffectPx =
		projectedClickSample && projectedClickSample.visible
			? viewport.x + projectedClickSample.cx * viewport.width
			: px;
	let clickEffectPy =
		projectedClickSample && projectedClickSample.visible
			? viewport.y + projectedClickSample.cy * viewport.height
			: py;
	const spriteKey = (
		cursorType && loadedCursorAssets[cursorType] ? cursorType : "arrow"
	) as CursorAssetKey;
	const asset = isStatefulCursorStyle(config.style)
		? getStatefulCursorAsset(config.style, spriteKey)
		: isSingleCursorStyle(config.style)
			? getCursorStyleAsset(config.style)
			: getCursorPackStyleAsset(config.style, spriteKey);
	const bounceScale = Math.max(
		0.72,
		1 - Math.sin(clickBounceProgress * Math.PI) * (0.08 * config.clickBounce),
	);
	const effectHeight = h * getCursorStyleSizeMultiplier(config.style);
	const drawHeight = effectHeight * bounceScale;
	if (isPressed && config.clickEffect !== "burst") {
		clickEffectPx = px;
		clickEffectPy = py;
	}
	drawClickEffectOnCanvas(
		ctx,
		config.clickEffect,
		clickEffectPx,
		clickEffectPy,
		effectHeight,
		clickProgress,
		config.clickEffectScale,
		config.clickEffectOpacity * idleOpacity,
		config.clickEffectColor,
	);

	ctx.save();
	if (!hasBakedCursorShadow(config.style)) {
		ctx.filter = CURSOR_SVG_DROP_SHADOW_FILTER;
	}
	if (config.style === "pixel-hand") {
		ctx.imageSmoothingEnabled = false;
	}

	const drawWidth = drawHeight * asset.aspectRatio;
	const hotspotX = asset.anchorX * drawWidth;
	const hotspotY = asset.anchorY * drawHeight;
	ctx.globalAlpha = config.dotAlpha * idleOpacity;
	ctx.drawImage(asset.image, px - hotspotX, py - hotspotY, drawWidth, drawHeight);

	ctx.restore();
}
