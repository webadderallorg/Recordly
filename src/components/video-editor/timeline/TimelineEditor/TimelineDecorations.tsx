import { useTimelineContext } from "dnd-timeline";
import {
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type RefObject,
	useEffect,
	useMemo,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import {
	calculateAxisScale,
	formatPlayheadTime,
	formatTimeLabel,
	type Keyframe,
} from "./shared";

interface PlaybackCursorProps {
	currentTimeMs: number;
	videoDurationMs: number;
	onSeek?: (time: number) => void;
	timelineRef: RefObject<HTMLDivElement>;
	keyframes?: Keyframe[];
}

export function PlaybackCursor({
	currentTimeMs,
	videoDurationMs,
	onSeek,
	timelineRef,
	keyframes = [],
}: PlaybackCursorProps) {
	const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		if (!isDragging) return;

		const handleMouseMove = (event: MouseEvent) => {
			if (!timelineRef.current || !onSeek) return;

			const rect = timelineRef.current.getBoundingClientRect();
			const clickX = event.clientX - rect.left - sidebarWidth;
			const relativeMs = pixelsToValue(clickX);
			let absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

			const nearbyKeyframe = keyframes.find(
				(keyframe) =>
					Math.abs(keyframe.time - absoluteMs) <= 150 &&
					keyframe.time >= range.start &&
					keyframe.time <= range.end,
			);

			if (nearbyKeyframe) {
				absoluteMs = nearbyKeyframe.time;
			}

			onSeek(absoluteMs / 1000);
		};

		const handleMouseUp = () => {
			setIsDragging(false);
			document.body.style.cursor = "";
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		document.body.style.cursor = "ew-resize";

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "";
		};
	}, [
		isDragging,
		onSeek,
		timelineRef,
		sidebarWidth,
		range.start,
		range.end,
		videoDurationMs,
		pixelsToValue,
		keyframes,
	]);

	if (videoDurationMs <= 0 || currentTimeMs < 0) {
		return null;
	}

	const clampedTime = Math.min(currentTimeMs, videoDurationMs);
	if (clampedTime < range.start || clampedTime > range.end) {
		return null;
	}

	const offset = valueToPixels(clampedTime - range.start);

	return (
		<div
			className="absolute top-0 bottom-0 z-50 group/cursor"
			style={{
				[sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth - 1}px`,
				pointerEvents: "none",
			}}
		>
			<div
				className="absolute top-0 bottom-0 w-[2px] bg-[#2563EB] shadow-[0_0_10px_rgba(37,99,235,0.5)] cursor-ew-resize pointer-events-auto hover:shadow-[0_0_15px_rgba(37,99,235,0.7)] transition-shadow"
				style={{ [sideProperty]: `${offset}px` }}
				onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
					event.stopPropagation();
					setIsDragging(true);
				}}
			>
				<div
					className="absolute -top-1 left-1/2 -translate-x-1/2 hover:scale-125 transition-transform"
					style={{ width: "16px", height: "16px" }}
				>
					<div className="w-3 h-3 mx-auto mt-[2px] bg-[#2563EB] rotate-45 rounded-sm shadow-lg border border-foreground/20" />
				</div>
				{isDragging ? (
					<div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] text-white/90 font-medium tabular-nums whitespace-nowrap border border-foreground/10 shadow-lg pointer-events-none">
						{formatPlayheadTime(clampedTime)}
					</div>
				) : null}
			</div>
		</div>
	);
}

export function TimelineAxis({
	videoDurationMs,
	currentTimeMs,
}: {
	videoDurationMs: number;
	currentTimeMs: number;
}) {
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

		for (let time = firstMarker; time <= maxTime; time += intervalMs) {
			if (time >= visibleStart && time <= visibleEnd) {
				markerTimes.add(Math.round(time));
			}
		}

		if (visibleStart <= maxTime) {
			markerTimes.add(Math.round(visibleStart));
		}

		if (videoDurationMs > 0) {
			markerTimes.add(Math.round(videoDurationMs));
		}

		const minorTicks: number[] = [];
		const minorInterval = intervalMs / 5;

		for (let time = firstMarker; time <= maxTime; time += minorInterval) {
			if (time >= visibleStart && time <= visibleEnd && Math.abs(time % intervalMs) >= 1) {
				minorTicks.push(time);
			}
		}

		return {
			markers: Array.from(markerTimes)
				.filter((time) => time <= maxTime)
				.sort((left, right) => left - right)
				.map((time) => ({ time, label: formatTimeLabel(time, intervalMs) })),
			minorTicks,
		};
	}, [intervalMs, range.end, range.start, videoDurationMs]);

	return (
		<div
			className="h-8 bg-editor-bg border-b border-foreground/10 relative overflow-hidden select-none"
			style={{
				[sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth}px`,
			}}
		>
			{markers.minorTicks.map((time) => (
				<div
					key={`minor-${time}`}
					className="absolute bottom-1 h-1 w-[1px] bg-foreground/5"
					style={{ [sideProperty]: `${valueToPixels(time - range.start)}px` }}
				/>
			))}
			{markers.markers.map((marker) => {
				const markerStyle: CSSProperties = {
					position: "absolute",
					bottom: 0,
					height: "100%",
					display: "flex",
					flexDirection: "row",
					alignItems: "flex-end",
					[sideProperty]: `${valueToPixels(marker.time - range.start)}px`,
					transform: "translateX(-50%)",
				};

				return (
					<div key={marker.time} style={markerStyle}>
						<div className="flex flex-col items-center pb-1">
							<div className="mb-1.5 h-[5px] w-[5px] rounded-full bg-foreground/30" />
							<span
								className={cn(
									"text-[10px] font-medium tabular-nums tracking-tight",
									marker.time === currentTimeMs ? "text-[#2563EB]" : "text-foreground/40",
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

export function ClipMarkerOverlay({ videoDurationMs }: { videoDurationMs: number }) {
	const { direction, range, valueToPixels } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";
	const { intervalMs } = useMemo(
		() => calculateAxisScale(range.end - range.start),
		[range.end, range.start],
	);

	const markers = useMemo(() => {
		if (intervalMs <= 0) return [] as Array<{ time: number; offset: number }>;

		const maxTime = videoDurationMs > 0 ? videoDurationMs : range.end;
		const visibleStart = Math.max(0, range.start);
		const visibleEnd = Math.min(range.end, maxTime);
		const firstMarker = Math.ceil(visibleStart / intervalMs) * intervalMs;
		const nextMarkers = [] as Array<{ time: number; offset: number }>;

		for (let time = firstMarker; time <= maxTime; time += intervalMs) {
			if (time > visibleStart && time < visibleEnd) {
				nextMarkers.push({
					time: Math.round(time),
					offset: valueToPixels(Math.round(time) - range.start),
				});
			}
		}

		return nextMarkers;
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
							"linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.10) 35%, rgba(255,255,255,0.10) 65%, transparent 100%)",
					}}
				/>
			))}
		</div>
	);
}