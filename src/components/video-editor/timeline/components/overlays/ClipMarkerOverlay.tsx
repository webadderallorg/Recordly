import { useTimelineContext } from "dnd-timeline";
import { memo, useMemo } from "react";
import { calculateAxisScale } from "../../core/time";

interface ClipMarkerOverlayProps {
	videoDurationMs: number;
}

function ClipMarkerOverlayComponent({ videoDurationMs }: ClipMarkerOverlayProps) {
	const { direction, range, valueToPixels } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";

	const { intervalMs } = useMemo(
		() => calculateAxisScale(range.end - range.start),
		[range.end, range.start],
	);

	const markers = useMemo(() => {
		if (intervalMs <= 0) return [] as { time: number; offset: number }[];
		const maxTime = videoDurationMs > 0 ? videoDurationMs : range.end;
		const visibleStart = Math.max(0, range.start);
		const visibleEnd = Math.min(range.end, maxTime);
		const firstMarker = Math.ceil(visibleStart / intervalMs) * intervalMs;
		const result: { time: number; offset: number }[] = [];
		for (let time = firstMarker; time <= maxTime; time += intervalMs) {
			if (time > visibleStart && time < visibleEnd) {
				result.push({
					time: Math.round(time),
					offset: valueToPixels(Math.round(time) - range.start),
				});
			}
		}
		return result;
	}, [intervalMs, range.start, range.end, videoDurationMs, valueToPixels]);

	return (
		<div className="pointer-events-none absolute inset-0 z-[1]">
			{markers.map(({ time, offset }) => (
				<div
					key={time}
					className="absolute w-px"
					style={{
						top: "7.5%",
						bottom: "7.5%",
						[sideProperty]: `${offset}px`,
						background:
							"linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.32) 35%, rgba(255,255,255,0.32) 65%, transparent 100%)",
					}}
				/>
			))}
		</div>
	);
}

export default memo(ClipMarkerOverlayComponent);
