import { useTimelineContext } from "dnd-timeline";
import { calculateAxisScale, formatTimeLabel } from "../../core/time";
import { TIMELINE_AXIS_HEIGHT_PX } from "../../timelineLayout";

export default function TimelineRuler({ videoDurationMs }: { videoDurationMs: number }) {
	const { range, sidebarWidth, valueToPixels } = useTimelineContext();
	const visibleMs = range.end - range.start;
	const widthPx = valueToPixels(visibleMs);
	const { intervalMs } = calculateAxisScale(visibleMs, widthPx);
	const firstTick = Math.ceil(Math.max(0, range.start) / intervalMs);
	const lastTick = Math.floor(Math.min(videoDurationMs, range.end) / intervalMs);
	const tickCount =
		videoDurationMs > 0 && widthPx > 0 ? Math.max(0, lastTick - firstTick + 1) : 0;

	return (
		<div
			aria-hidden="true"
			data-testid="timeline-ruler"
			className="pointer-events-none relative shrink-0 overflow-hidden"
			style={{ height: TIMELINE_AXIS_HEIGHT_PX, marginInlineStart: sidebarWidth }}
		>
			{Array.from({ length: tickCount }, (_, index) => {
				const timeMs = (firstTick + index) * intervalMs;
				const label = formatTimeLabel(timeMs, intervalMs);
				const offsetPx = valueToPixels(timeMs - range.start);
				// Keep the dot and its label together when a mark reaches either edge.
				const edgeInset = `${label.length / 2 + 0.5}ch`;

				return (
					<div
						key={timeMs}
						className="absolute top-2 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap text-[10px] leading-3 font-medium tabular-nums text-muted-foreground rtl:translate-x-1/2"
						style={{
							insetInlineStart: `clamp(${edgeInset}, ${offsetPx}px, calc(100% - ${edgeInset}))`,
						}}
					>
						<span className="size-1 rounded-full bg-foreground/35" />
						<bdi dir="ltr">{label}</bdi>
					</div>
				);
			})}
		</div>
	);
}
