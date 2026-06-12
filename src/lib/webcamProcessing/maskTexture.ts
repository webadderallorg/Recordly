/**
 * Renders the webcam garbage matte (rect or pen polygon) into a canvas that the
 * WebGL pipeline uploads as a luminance mask texture (white = keep).
 *
 * The rect shape mirrors the rounded-rect SDF semantics documented by
 * chromaKeyMath.maskAlpha: cornerRadius 0..1 is relative to the shorter
 * half-extent, and feather maps to a band of feather * MASK_FEATHER_SCALE in
 * normalized space (approximated here with a canvas blur).
 */

import type { WebcamMaskSettings } from "@/components/video-editor/types";
import { MASK_FEATHER_SCALE } from "./chromaKeyMath";
import { segmentControls } from "./maskPath";

/** Square mask texture resolution; sampled with the frame's uv directly. */
export const MASK_TEXTURE_SIZE = 512;

/** Stable cache key over the shape-relevant mask fields. */
export function maskSettingsKey(mask: WebcamMaskSettings): string {
	const { shape, rect, cornerRadius, feather, points } = mask;
	const pointsKey = points
		.map(
			(point) =>
				`${point.x},${point.y},${point.inX ?? ""},${point.inY ?? ""},${point.outX ?? ""},${point.outY ?? ""}`,
		)
		.join(";");
	return [shape, rect.x, rect.y, rect.width, rect.height, cornerRadius, feather, pointsKey].join(
		"|",
	);
}

/** True when the mask would actually clip pixels if enabled. */
export function isMaskRenderable(mask: WebcamMaskSettings): boolean {
	if (!mask.enabled) {
		return false;
	}
	if (mask.shape === "polygon") {
		return mask.points.length >= 3;
	}
	return true;
}

function traceKeepShape(ctx: CanvasRenderingContext2D, mask: WebcamMaskSettings): void {
	ctx.beginPath();
	if (mask.shape === "polygon") {
		const { points } = mask;
		const [first] = points;
		ctx.moveTo(first.x * MASK_TEXTURE_SIZE, first.y * MASK_TEXTURE_SIZE);
		// One cubic per segment, including the closing segment last→first.
		// Corner points contribute their anchor as the control, so paths
		// without handles render exactly like the old straight polygon.
		for (let index = 0; index < points.length; index++) {
			const from = points[index];
			const to = points[(index + 1) % points.length];
			const { c0, c1 } = segmentControls(from, to);
			ctx.bezierCurveTo(
				c0.x * MASK_TEXTURE_SIZE,
				c0.y * MASK_TEXTURE_SIZE,
				c1.x * MASK_TEXTURE_SIZE,
				c1.y * MASK_TEXTURE_SIZE,
				to.x * MASK_TEXTURE_SIZE,
				to.y * MASK_TEXTURE_SIZE,
			);
		}
		ctx.closePath();
		return;
	}
	const { rect } = mask;
	const halfW = (rect.width / 2) * MASK_TEXTURE_SIZE;
	const halfH = (rect.height / 2) * MASK_TEXTURE_SIZE;
	const radius = Math.min(1, Math.max(0, mask.cornerRadius)) * Math.min(halfW, halfH);
	ctx.roundRect(
		rect.x * MASK_TEXTURE_SIZE,
		rect.y * MASK_TEXTURE_SIZE,
		rect.width * MASK_TEXTURE_SIZE,
		rect.height * MASK_TEXTURE_SIZE,
		radius,
	);
}

/**
 * Renders the keep-shape (opaque white on transparent black) into `canvas`,
 * sized to MASK_TEXTURE_SIZE². No-op when the mask isn't renderable.
 */
export function renderMaskToCanvas(mask: WebcamMaskSettings, canvas: HTMLCanvasElement): void {
	canvas.width = MASK_TEXTURE_SIZE;
	canvas.height = MASK_TEXTURE_SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return;
	}
	ctx.clearRect(0, 0, MASK_TEXTURE_SIZE, MASK_TEXTURE_SIZE);
	if (!isMaskRenderable(mask)) {
		return;
	}

	// Halved because the blur spreads both ways; the goal is a band visually
	// comparable to the SDF feather (feather * MASK_FEATHER_SCALE, one-sided).
	const blurPx = Math.max(0, mask.feather) * MASK_FEATHER_SCALE * MASK_TEXTURE_SIZE * 0.5;
	if (blurPx < 0.5) {
		ctx.fillStyle = "#ffffff";
		traceKeepShape(ctx, mask);
		ctx.fill();
		return;
	}

	const shapeCanvas = document.createElement("canvas");
	shapeCanvas.width = MASK_TEXTURE_SIZE;
	shapeCanvas.height = MASK_TEXTURE_SIZE;
	const shapeCtx = shapeCanvas.getContext("2d");
	if (!shapeCtx) {
		return;
	}
	shapeCtx.fillStyle = "#ffffff";
	traceKeepShape(shapeCtx, mask);
	shapeCtx.fill();

	ctx.filter = `blur(${blurPx}px)`;
	ctx.drawImage(shapeCanvas, 0, 0);
	ctx.filter = "none";
}
