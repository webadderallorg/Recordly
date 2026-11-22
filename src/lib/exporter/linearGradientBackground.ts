import { createCssGradientBackground, drawCssGradientBackground } from "./cssGradientBackground";

/** Backward-compatible linear entry point shared with every export backend. */
export function createLinearGradientBackground(
	ctx: Pick<CanvasRenderingContext2D, "createLinearGradient">,
	css: string,
	width: number,
	height: number,
): CanvasGradient | null {
	if (!css.trim().startsWith("linear-gradient(")) return null;
	return createCssGradientBackground(ctx as CanvasRenderingContext2D, css, width, height);
}

export function drawLinearGradientBackground(
	ctx: CanvasRenderingContext2D,
	css: string,
	width: number,
	height: number,
): boolean {
	return (
		css.trim().startsWith("linear-gradient(") &&
		drawCssGradientBackground(ctx, css, width, height)
	);
}
