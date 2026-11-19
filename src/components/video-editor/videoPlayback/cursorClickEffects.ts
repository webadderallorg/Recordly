import { Graphics } from "pixi.js";
import {
	type CursorClickEffectStyle,
	DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	normalizeCursorClickEffectColor,
} from "../types";

export function getClickEffectColor(clickEffectColor: string) {
	const normalized = normalizeCursorClickEffectColor(clickEffectColor);
	return Number.parseInt(normalized.slice(1), 16);
}

export function getRippleMetrics(
	cursorSize: number,
	clickProgress: number,
	effectScale: number,
	effectOpacity: number,
) {
	const eased = 1 - Math.pow(clickProgress, 3);

	return {
		radius: Math.max(0.5, eased * cursorSize * 1.95 * effectScale),
		alpha: Math.max(0, Math.min(1, clickProgress * 0.35 * effectOpacity)),
	};
}

export function getBurstRays(cursorSize: number, clickProgress: number, effectScale: number) {
	const radius = Math.max(12, cursorSize * effectScale);
	const phase = Math.max(0, Math.min(1, 1 - clickProgress));
	const easeOut = (value: number) => 1 - (1 - value) ** 3;
	// Heads shoot out immediately; delayed tails follow so each ray stretches
	// from the click point, then contracts as it fades.
	const startRadius = Math.max(6, radius * 0.2);
	const headTravel = easeOut(phase);
	const tailTravel = easeOut(Math.max(0, (phase - 0.18) / 0.82));
	const inner = startRadius + radius * 1.7 * tailTravel;
	const outer = startRadius + radius * (0.12 + 1.7 * headTravel);
	return Array.from({ length: 10 }, (_, index) => {
		const angle = -Math.PI / 2 + (index * Math.PI * 2) / 10;
		return {
			x1: Math.cos(angle) * inner,
			y1: Math.sin(angle) * inner,
			x2: Math.cos(angle) * outer,
			y2: Math.sin(angle) * outer,
		};
	});
}

export function drawClickEffectGraphics(
	graphics: Graphics,
	effect: CursorClickEffectStyle,
	px: number,
	py: number,
	cursorSize: number,
	clickProgress: number,
	effectScale: number,
	effectOpacity: number,
	effectColor: string = DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
) {
	graphics.clear();
	if (effect === "none" || clickProgress <= 0) {
		return;
	}

	const reveal = 1 - clickProgress;
	const alpha = clickProgress * effectOpacity;
	const color = getClickEffectColor(effectColor);
	const baseRadius = Math.max(12, cursorSize * 0.55 * effectScale);
	const strokeWidth = Math.max(2, cursorSize * 0.08);

	if (effect === "burst") {
		for (const ray of getBurstRays(cursorSize, clickProgress, effectScale)) {
			const dx = ray.x2 - ray.x1;
			const dy = ray.y2 - ray.y1;
			const length = Math.hypot(dx, dy);
			// Filled capsules avoid overlapping stroke-cap triangles in Pixi,
			// which otherwise become brighter than the Canvas export while fading.
			graphics.context
				.save()
				.transform(
					dx / length,
					dy / length,
					-dy / length,
					dx / length,
					px + ray.x1,
					py + ray.y1,
				)
				.beginPath()
				.roundRect(
					-strokeWidth / 2,
					-strokeWidth / 2,
					length + strokeWidth,
					strokeWidth,
					strokeWidth / 2,
				)
				.fill({ color, alpha })
				.restore();
		}
		return;
	}

	if (effect === "ripple") {
		const ripple = getRippleMetrics(cursorSize, clickProgress, effectScale, effectOpacity);
		graphics.circle(px, py, ripple.radius);
		graphics.fill({ color, alpha: ripple.alpha });
		return;
	}

	if (effect === "spotlight") {
		const glowRadius = baseRadius + reveal * cursorSize * effectScale;
		const innerRadius = Math.max(baseRadius * 0.72, glowRadius * 0.76);
		graphics.circle(px, py, glowRadius);
		graphics.stroke({ width: Math.max(1.25, strokeWidth * 0.68), color, alpha: alpha * 0.28 });
		graphics.circle(px, py, innerRadius);
		graphics.stroke({ width: Math.max(1.5, strokeWidth * 0.75), color, alpha: alpha * 0.5 });
		return;
	}

	const echoOuterRadius = baseRadius + reveal * cursorSize * 1.22 * effectScale;
	const echoInnerRadius = Math.max(baseRadius * 0.58, echoOuterRadius * 0.62);
	graphics.circle(px, py, echoOuterRadius);
	graphics.stroke({ width: strokeWidth, color, alpha: alpha * 0.72 });
	graphics.circle(px, py, echoInnerRadius);
	graphics.stroke({ width: Math.max(1.4, strokeWidth * 0.72), color, alpha: alpha * 0.42 });
	graphics.circle(px, py, Math.max(3, baseRadius * 0.18));
	graphics.fill({ color, alpha: alpha * 0.14 });
}

export function drawClickEffectOnCanvas(
	ctx: CanvasRenderingContext2D,
	effect: CursorClickEffectStyle,
	px: number,
	py: number,
	cursorSize: number,
	clickProgress: number,
	effectScale: number,
	effectOpacity: number,
	effectColor: string = DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
) {
	if (effect === "none" || clickProgress <= 0) {
		return;
	}

	const reveal = 1 - clickProgress;
	const alpha = clickProgress * effectOpacity;
	const color = getClickEffectColor(effectColor);
	const strokeColor = `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, `;
	const baseRadius = Math.max(12, cursorSize * 0.55 * effectScale);
	const strokeWidth = Math.max(2, cursorSize * 0.08);

	ctx.save();

	if (effect === "burst") {
		ctx.lineWidth = strokeWidth;
		ctx.lineCap = "round";
		ctx.strokeStyle = `${strokeColor}${alpha.toFixed(3)})`;
		ctx.beginPath();
		for (const ray of getBurstRays(cursorSize, clickProgress, effectScale)) {
			ctx.moveTo(px + ray.x1, py + ray.y1);
			ctx.lineTo(px + ray.x2, py + ray.y2);
		}
		ctx.stroke();
		ctx.restore();
		return;
	}

	if (effect === "ripple") {
		const ripple = getRippleMetrics(cursorSize, clickProgress, effectScale, effectOpacity);
		ctx.fillStyle = `${strokeColor}${ripple.alpha.toFixed(3)})`;
		ctx.beginPath();
		ctx.arc(px, py, ripple.radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
		return;
	}

	if (effect === "spotlight") {
		const glowRadius = baseRadius + reveal * cursorSize * effectScale;
		const innerRadius = Math.max(baseRadius * 0.72, glowRadius * 0.76);
		ctx.lineWidth = Math.max(1.25, strokeWidth * 0.68);
		ctx.strokeStyle = `${strokeColor}${(alpha * 0.28).toFixed(3)})`;
		ctx.beginPath();
		ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
		ctx.stroke();
		ctx.lineWidth = Math.max(1.5, strokeWidth * 0.75);
		ctx.strokeStyle = `${strokeColor}${(alpha * 0.5).toFixed(3)})`;
		ctx.beginPath();
		ctx.arc(px, py, innerRadius, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
		return;
	}

	const echoOuterRadius = baseRadius + reveal * cursorSize * 1.22 * effectScale;
	const echoInnerRadius = Math.max(baseRadius * 0.58, echoOuterRadius * 0.62);
	ctx.lineWidth = strokeWidth;
	ctx.strokeStyle = `${strokeColor}${(alpha * 0.72).toFixed(3)})`;
	ctx.beginPath();
	ctx.arc(px, py, echoOuterRadius, 0, Math.PI * 2);
	ctx.stroke();
	ctx.lineWidth = Math.max(1.4, strokeWidth * 0.72);
	ctx.strokeStyle = `${strokeColor}${(alpha * 0.42).toFixed(3)})`;
	ctx.beginPath();
	ctx.arc(px, py, echoInnerRadius, 0, Math.PI * 2);
	ctx.stroke();
	ctx.fillStyle = `${strokeColor}${(alpha * 0.14).toFixed(3)})`;
	ctx.beginPath();
	ctx.arc(px, py, Math.max(3, baseRadius * 0.18), 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}
