import type { CursorStyle, CursorTelemetryPoint } from "../types";

/** Briefly curl the pointing finger on click; preserve text, resize and drag poses. */
export function resolvePixelGlovePose(
	style: CursorStyle | undefined,
	cursorType: CursorTelemetryPoint["cursorType"],
	clickAgeMs: number,
	bounceDurationMs: number,
	bounceAmount: number,
): NonNullable<CursorTelemetryPoint["cursorType"]> {
	const type = cursorType ?? "arrow";
	if (
		style === "pixel-hand" &&
		bounceAmount > 0 &&
		(type === "arrow" || type === "pointer") &&
		clickAgeMs >= 0 &&
		clickAgeMs < Math.min(120, bounceDurationMs / 2)
	)
		return "closed-hand";
	return type;
}
