import type { CursorTelemetryPoint } from "@/components/video-editor/types";

type CursorClickInteractionType = Extract<
	CursorTelemetryPoint["interactionType"],
	"click" | "double-click" | "right-click" | "middle-click"
>;
export type CursorClickTelemetryPoint = CursorTelemetryPoint & {
	interactionType: CursorClickInteractionType;
};
const CLICK_INTERACTION_TYPES = new Set<CursorClickInteractionType>([
	"click",
	"double-click",
	"right-click",
	"middle-click",
]);

/**
 * Match preview/export behavior by selecting at most one telemetry click per frame.
 * A click remains eligible for 100ms so fixed-frame export does not miss it
 * when a newer move sample lands in the same frame window.
 */
export function selectCursorClickForEmission(
	telemetry: CursorTelemetryPoint[],
	timeMs: number,
	lastEmittedClickTimeMs: number,
): CursorClickTelemetryPoint | null {
	for (let i = telemetry.length - 1; i >= 0; i--) {
		const point = telemetry[i];
		if (point.timeMs > timeMs) continue;
		if (point.timeMs < timeMs - 100) break;
		if (
			point.interactionType &&
			CLICK_INTERACTION_TYPES.has(point.interactionType as CursorClickInteractionType) &&
			point.timeMs !== lastEmittedClickTimeMs
		) {
			return point as CursorClickTelemetryPoint;
		}
	}

	return null;
}
