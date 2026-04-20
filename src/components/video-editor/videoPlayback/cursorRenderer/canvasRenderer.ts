import type { CursorTelemetryPoint } from "../../types";
import { projectCursorPositionToViewport, type CursorViewportRect } from "../cursorViewport";
import {
	getCursorPackStyleAsset,
	getCursorStyleAsset,
	getStatefulCursorAsset,
	isSingleCursorStyle,
} from "./assets";
import { SmoothedCursorState } from "./smoothedState";
import {
	CURSOR_SVG_DROP_SHADOW_FILTER,
	type CursorAssetKey,
	type CursorRenderConfig,
	DEFAULT_CURSOR_CONFIG,
	isStatefulCursorStyle,
} from "./shared";
import {
	getCursorVisualState,
	getCursorViewportScale,
	interpolateCursorPosition,
} from "./telemetry";

export function drawCursorOnCanvas(
	ctx: CanvasRenderingContext2D,
	samples: CursorTelemetryPoint[],
	timeMs: number,
	viewport: CursorViewportRect,
	smoothedState: SmoothedCursorState,
	config: CursorRenderConfig = DEFAULT_CURSOR_CONFIG,
): void {
	if (samples.length === 0 || viewport.width <= 0 || viewport.height <= 0) return;

	const target = interpolateCursorPosition(samples, timeMs);
	if (!target) return;

	const projectedTarget = projectCursorPositionToViewport(target, viewport.sourceCrop);
	if (!projectedTarget.visible) return;

	smoothedState.update(projectedTarget.cx, projectedTarget.cy, timeMs);

	const px = viewport.x + smoothedState.x * viewport.width;
	const py = viewport.y + smoothedState.y * viewport.height;
	const h = config.dotRadius * getCursorViewportScale(viewport);
	const { cursorType, clickBounceProgress } = getCursorVisualState(
		samples,
		timeMs,
		config.clickBounceDuration,
	);
	const spriteKey = (cursorType ?? "arrow") as CursorAssetKey;
	const asset = isStatefulCursorStyle(config.style)
		? getStatefulCursorAsset(config.style, spriteKey)
		: isSingleCursorStyle(config.style)
			? getCursorStyleAsset(config.style)
			: getCursorPackStyleAsset(config.style, spriteKey);
	const bounceScale = Math.max(
		0.72,
		1 - Math.sin(clickBounceProgress * Math.PI) * (0.08 * config.clickBounce),
	);

	ctx.save();
	if (config.style !== "figma") {
		ctx.filter = CURSOR_SVG_DROP_SHADOW_FILTER;
	}

	const drawHeight = h * bounceScale;
	const drawWidth = drawHeight * asset.aspectRatio;
	const hotspotX = asset.anchorX * drawWidth;
	const hotspotY = asset.anchorY * drawHeight;
	ctx.globalAlpha = config.dotAlpha;
	ctx.drawImage(asset.image, px - hotspotX, py - hotspotY, drawWidth, drawHeight);
	ctx.restore();
}