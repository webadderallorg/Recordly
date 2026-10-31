import {
	findClipAtTimelineTime,
	mapTimelineTimeToSourceTime,
	type ClipRegion,
	type CursorTelemetryPoint,
} from "../types";
import { interpolateCursorPosition } from "./cursorPosition";
import { projectCursorPositionToViewport, type CursorViewportRect } from "./cursorViewport";
import { computeDirectionalMotionBlur } from "./zoomTransform";

/** Sample one media-frame interval, never the distance between playhead seeks. */
export function getFrameMotionSample(timeMs: number, clips: ClipRegion[]) {
	if (!Number.isFinite(timeMs) || timeMs <= 0) return null;
	const clip = findClipAtTimelineTime(timeMs, clips);
	if (clips.length && !clip) return null;
	const previousTimeMs = Math.max(clip?.startMs ?? 0, timeMs - 1000 / 60);
	if (previousTimeMs >= timeMs) return null;
	return {
		previousTimeMs,
		previousSourceTimeMs: mapTimelineTimeToSourceTime(previousTimeMs, clips),
		deltaMs: timeMs - previousTimeMs,
	};
}

/** Telemetry motion for a frozen frame, independent of the previous rendered seek. */
export function computeCursorFrameBlur(
	samples: CursorTelemetryPoint[],
	timeMs: number,
	previousTimeMs: number | null,
	viewport: CursorViewportRect,
	amount: number,
	strength: number,
) {
	const zero = () => computeDirectionalMotionBlur({ x: 0, y: 0 }, 0, 1 / 60);
	if (previousTimeMs === null || previousTimeMs >= timeMs || amount <= 0) return zero();
	const current = interpolateCursorPosition(samples, timeMs);
	const previous = interpolateCursorPosition(samples, previousTimeMs);
	if (!current || !previous) return zero();
	const a = projectCursorPositionToViewport(previous, viewport.sourceCrop);
	const b = projectCursorPositionToViewport(current, viewport.sourceCrop);
	if (!a.visible || !b.visible) return zero();
	return computeDirectionalMotionBlur(
		{ x: (b.cx - a.cx) * viewport.width, y: (b.cy - a.cy) * viewport.height },
		amount,
		(timeMs - previousTimeMs) / 1000,
		strength,
	);
}
