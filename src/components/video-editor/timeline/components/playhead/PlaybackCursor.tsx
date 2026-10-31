import { useTimelineContext } from "dnd-timeline";
import { useEffect, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { formatPlayheadTime } from "../../core/time";

import {
	getPlayheadDisplayTime,
	getTimeAtClipSeam,
	type ClipPresentation,
} from "../../core/clipPresentation";

interface PlaybackCursorProps {
	clips: ClipPresentation[];
	currentTimeMs: number;
	videoDurationMs: number;
	onSeek?: (time: number) => void;
	timelineRef: RefObject<HTMLDivElement | null>;
	keyframes?: { id: string; time: number }[];
	isLoading?: boolean;
}

export default function PlaybackCursor({
	clips,
	currentTimeMs,
	videoDurationMs,
	onSeek,
	timelineRef,
	keyframes = [],
	isLoading = false,
}: PlaybackCursorProps) {
	const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";
	const [isDragging, setIsDragging] = useState(false);
	const [isHovered, setIsHovered] = useState(false);

	useEffect(() => {
		if (!isDragging) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!timelineRef.current || !onSeek) return;
			const rect = timelineRef.current.getBoundingClientRect();
			const clickX =
				direction === "rtl"
					? rect.right - sidebarWidth - e.clientX
					: e.clientX - rect.left - sidebarWidth;
			const relativeMs = pixelsToValue(clickX);
			let absoluteMs = getTimeAtClipSeam(
				Math.max(0, Math.min(range.start + relativeMs, videoDurationMs)),
				clips,
			);

			const snapThresholdMs = 150;
			const nearbyKeyframe = keyframes.find(
				(kf) =>
					Math.abs(kf.time - absoluteMs) <= snapThresholdMs &&
					kf.time >= range.start &&
					kf.time <= range.end,
			);
			if (nearbyKeyframe) absoluteMs = nearbyKeyframe.time;

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
		clips,
		onSeek,
		timelineRef,
		sidebarWidth,
		range.start,
		range.end,
		videoDurationMs,
		pixelsToValue,
		keyframes,
		direction,
	]);

	if (videoDurationMs <= 0 || currentTimeMs < 0) return null;
	const clampedTime = Math.min(currentTimeMs, videoDurationMs);
	if (clampedTime < range.start || clampedTime > range.end) return null;

	const offset = valueToPixels(getPlayheadDisplayTime(clampedTime, clips) - range.start);

	const expanded = isHovered || isDragging || isLoading;
	// Keep the timestamp inside the viewport even at either end of the timeline.
	const width = valueToPixels(range.end - range.start);
	const capShift = Math.max(0, 34 - offset) - Math.max(0, 34 - (width - offset));
	return (
		<div data-testid="timeline-playhead" className="absolute inset-0 z-50 pointer-events-none">
			<div
				className="absolute top-0 bottom-0 w-px bg-red-500"
				style={{ [sideProperty]: sidebarWidth + offset }}
			>
				<button
					type="button"
					aria-label={`Playhead ${formatPlayheadTime(clampedTime)}`}
					data-testid="playhead-cap"
					onMouseEnter={() => setIsHovered(true)}
					onMouseLeave={() => setIsHovered(false)}
					onFocus={() => setIsHovered(true)}
					onBlur={() => setIsHovered(false)}
					onClick={(event) => event.stopPropagation()}
					onMouseDown={(event) => {
						if (event.button !== 0) return;
						event.preventDefault();
						event.stopPropagation();
						setIsDragging(true);
					}}
					className="absolute top-0 h-4 rounded-full bg-red-500 text-white cursor-ew-resize pointer-events-auto overflow-hidden transition-[width,transform] duration-150"
					style={{
						width: expanded ? 68 : 16,
						left: "50%",
						transform: `translateX(calc(-50% + ${expanded ? (direction === "rtl" ? -capShift : capShift) : 0}px))`,
					}}
				>
					<span
						className={cn(
							"block whitespace-nowrap text-[10px] font-medium tabular-nums transition-opacity",
							expanded ? "opacity-100" : "opacity-0",
						)}
					>
						{formatPlayheadTime(clampedTime)}
					</span>
				</button>
			</div>
		</div>
	);
}
