import { useTimelineContext } from "dnd-timeline";
import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { calculateAxisScale, formatTimeLabel } from "../../core/time";

interface TimelineAxisProps {
	videoDurationMs: number;
	currentTimeMs: number;
}

export default function TimelineAxis({ videoDurationMs, currentTimeMs }: TimelineAxisProps) {
	const { sidebarWidth, direction, range, valueToPixels } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";

	const { intervalMs } = useMemo(
		() => calculateAxisScale(range.end - range.start),
		[range.end, range.start],
	);

	const markers = useMemo(() => {
		if (intervalMs <= 0) {
			return { markers: [], minorTicks: [] as number[] };
		}

		const maxTime = videoDurationMs > 0 ? videoDurationMs : range.end;
		const visibleStart = Math.max(0, Math.min(range.start, maxTime));
		const visibleEnd = Math.min(range.end, maxTime);
		const markerTimes = new Set<number>();
		const firstMarker = Math.ceil(visibleStart / intervalMs) * intervalMs;

		for (let time = firstMarker; time <= visibleEnd; time += intervalMs) {
			markerTimes.add(Math.round(time));
		}

		if (visibleStart <= maxTime) markerTimes.add(Math.round(visibleStart));
		if (videoDurationMs > 0) markerTimes.add(Math.round(videoDurationMs));

		const sorted = Array.from(markerTimes)
			.filter((time) => time <= maxTime)
			.sort((a, b) => a - b);

		const minorTicks: number[] = [];
		const minorInterval = intervalMs / 5;
		for (let time = firstMarker; time <= visibleEnd; time += minorInterval) {
			const isMajor = Math.abs(time % intervalMs) < 1;
			if (!isMajor) minorTicks.push(time);
		}

		return {
			markers: sorted.map((time) => ({ time, label: formatTimeLabel(time, intervalMs) })),
			minorTicks,
		};
	}, [intervalMs, range.end, range.start, videoDurationMs]);

	return (
		<div
			className="h-8 bg-editor-bg border-b border-foreground/10 relative overflow-hidden select-none"
			style={{ [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth}px` }}
		>
			{markers.minorTicks.map((time) => {
				const offset = valueToPixels(time - range.start);
				return (
					<div
						key={`minor-${time}`}
						className="absolute bottom-1 h-1 w-[1px] bg-foreground/5"
						style={{ [sideProperty]: `${offset}px` }}
					/>
				);
			})}

			{markers.markers.map((marker) => {
				const offset = valueToPixels(marker.time - range.start);
				const markerStyle: CSSProperties = {
					position: "absolute",
					bottom: 0,
					height: "100%",
					display: "flex",
					flexDirection: "row",
					alignItems: "flex-end",
					[sideProperty]: `${offset}px`,
					transform: direction === "rtl" ? "translateX(50%)" : "translateX(-50%)",
				};

				return (
					<div key={marker.time} style={markerStyle}>
						<div className="flex flex-col items-center pb-1">
							<div className="mb-1.5 h-[5px] w-[5px] rounded-full bg-foreground/30" />
							<span
								className={cn(
									"text-[10px] font-medium tabular-nums tracking-tight",
									Math.abs(marker.time - currentTimeMs) < 1
										? "text-[#2563EB]"
										: "text-foreground/40",
								)}
							>
								{marker.label}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
