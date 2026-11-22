import type { CursorTelemetryPoint } from "../types";

export type RecordingZoomMarker = Pick<CursorTelemetryPoint, "timeMs" | "cx" | "cy">;

export function buildManualRecordingZoomRegions(markers: RecordingZoomMarker[], totalMs: number) {
	const ordered = markers
		.filter(
			({ timeMs, cx, cy }) =>
				Number.isFinite(timeMs) &&
				timeMs >= 0 &&
				Number.isFinite(cx) &&
				Number.isFinite(cy),
		)
		.map((marker) => ({ ...marker, timeMs: Math.round(marker.timeMs) }))
		.filter(({ timeMs }) => timeMs < totalMs)
		.sort((a, b) => a.timeMs - b.timeMs);
	return ordered.flatMap((marker, index) => {
		const start = marker.timeMs;
		const end = Math.min(start + 1000, totalMs, ordered[index + 1]?.timeMs ?? totalMs);
		return end > start ? [{ start, end, focus: { cx: marker.cx, cy: marker.cy } }] : [];
	});
}
