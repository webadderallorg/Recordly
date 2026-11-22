import type { CursorTelemetryPoint } from "../types";

export function applyDefaultCursorShape(
	samples: CursorTelemetryPoint[],
	enabled: boolean,
): CursorTelemetryPoint[] {
	if (!enabled) return samples;
	return samples.map((sample) =>
		sample.cursorType && sample.cursorType !== "arrow"
			? { ...sample, cursorType: "arrow" }
			: sample,
	);
}
