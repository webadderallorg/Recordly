import {
	Gauge,
	MagnifyingGlassPlus as ZoomIn,
	ChatCircle as MessageSquare,
	MusicNotes as Music,
	Scissors,
	SpeakerX,
} from "@/components/ui/icons";
import { ClipFilmstrip } from "./components/filmstrip/ClipFilmstrip";
import type { Span, GetSpanFromDragEvent, GetSpanFromResizeEvent } from "dnd-timeline";
import { useItem, useTimelineContext } from "dnd-timeline";
import { useCallback, useMemo, useRef } from "react";
import { useDndMonitor } from "@dnd-kit/core";
import { useTimelinePresentation } from "./core/TimelinePresentation";
import { getRegionDisplaySpan, snapRegionSpan } from "./core/clipPresentation";
import { resolveDragEnd, resolveResizeEnd } from "./dnd/engine";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatClipSpeedLabel } from "../clipSpeedChange";
import { getTimeAtClipSeam, type ClipPresentation } from "./core/clipPresentation";
import { formatPlayheadTime } from "./core/time";
import AudioWaveform from "./components/waveform/AudioWaveform";
import type { AudioPeaksData } from "./core/timelineTypes";
import glassStyles from "./ItemGlass.module.css";

interface ItemProps {
	clipPresentation?: ClipPresentation[];
	sharedLeftGrip?: boolean;
	sharedRightGrip?: boolean;
	displaySpan?: Span;
	embedded?: boolean;
	videoPath?: string | null;
	sourceSpan?: Span;
	id: string;
	span: Span;
	rowId: string;
	disabled?: boolean;
	children: React.ReactNode;
	isSelected?: boolean;
	onSelect?: () => void;
	onDoubleClick?: () => void;
	onSelectId?: (id: string) => void;
	zoomDepth?: number;
	zoomMode?: "auto" | "manual";
	speedValue?: number;
	waveformPeaks?: AudioPeaksData | null;
	waveformSegmentSpan?: Span;
	waveformGain?: number;
	waveformNormalize?: boolean;
	muted?: boolean;
	variant?: "zoom" | "trim" | "clip" | "annotation" | "speed" | "audio" | "caption";
	isLoading?: boolean;
	loadingLabel?: string;
	/** Timeline time a clip edge snaps to while resizing, usually the playhead. */
	snapToMs?: number;
}

/** Width of the zone around a clip edge that starts a trim, half inside and half outside. */
const CLIP_RESIZE_HANDLE_PX = 32;
/** The grab strip covers the outside half plus a little of the inside. */
const CLIP_GRAB_STRIP_PX = CLIP_RESIZE_HANDLE_PX / 2 + 2;
/** How close a dragged clip edge has to come to the playhead to snap to it. It covers
 * the 9 px between a clip grip and its edge, so a grip dropped on the playhead snaps. */
const PLAYHEAD_SNAP_PX = 14;

// Map zoom depth to multiplier labels
const ZOOM_LABELS: Record<number, string> = {
	1: "1.25×",
	2: "1.5×",
	3: "1.8×",
	4: "2.2×",
	5: "3.5×",
	6: "5×",
};

export default function Item({
	clipPresentation: suppliedPresentation,
	id,
	sharedLeftGrip = false,
	sharedRightGrip = false,
	embedded = false,
	videoPath,
	sourceSpan,
	span,
	displaySpan: suppliedDisplaySpan,
	rowId,
	disabled = false,
	isSelected = false,
	onSelect,
	onDoubleClick,
	onSelectId,
	zoomDepth = 1,
	zoomMode = "auto",
	speedValue,
	waveformPeaks = null,
	waveformSegmentSpan,
	waveformGain = 1,
	waveformNormalize = false,
	muted = false,
	variant = "zoom",
	isLoading = false,
	loadingLabel,
	snapToMs,
	children,
}: ItemProps) {
	const timeline = useTimelineContext();
	const presentation = useTimelinePresentation();
	const clipPresentation =
		variant === "clip" ? undefined : (suppliedPresentation ?? presentation.clips);
	const displaySpan = clipPresentation?.length
		? getRegionDisplaySpan(span, clipPresentation)
		: (suppliedDisplaySpan ?? span);
	const nodeRef = useRef<HTMLDivElement | null>(null);
	const targets = useMemo(
		() => [
			...new Set(
				presentation.regions
					.filter((region) => region.id !== id)
					.flatMap((region) => [region.start, region.end]),
			),
		],
		[presentation.regions, id],
	);
	const snap = (next: Span, edge?: "start" | "end") =>
		snapRegionSpan(next, targets, presentation.clips, timeline.pixelsToValue(1), edge);
	const getMediaSpanFromDrag: GetSpanFromDragEvent = (event) => {
		if (!("delta" in event)) return span;
		const dragged = timeline.getSpanFromDragEvent(event);
		if (!dragged) return null;
		if (clipPresentation) {
			const start = getTimeAtClipSeam(dragged.start, clipPresentation);
			return snap({ start, end: start + span.end - span.start });
		}
		const visualOffset = displaySpan.start - span.start;
		return { start: dragged.start - visualOffset, end: dragged.end - visualOffset };
	};
	const getMediaSpanFromResize: GetSpanFromResizeEvent = (event) => {
		const delta = timeline.pixelsToValue(event.delta.x);
		const edge = event.direction;
		if (clipPresentation)
			return snap(
				{
					...span,
					[edge]: getTimeAtClipSeam(displaySpan[edge] + delta, clipPresentation),
				},
				edge,
			);
		const scale = (span.end - span.start) / (displaySpan.end - displaySpan.start);
		const next = { ...span, [edge]: span[edge] + delta * scale };
		if (
			snapToMs !== undefined &&
			Math.abs(next[edge] - snapToMs) <= timeline.pixelsToValue(PLAYHEAD_SNAP_PX) * scale
		) {
			next[edge] = snapToMs;
		}
		return next;
	};

	const paintPreview = (preview: Span, deltaY = 0) => {
		const node = nodeRef.current;
		if (!node || !clipPresentation) return;
		const display = getRegionDisplaySpan(preview, clipPresentation);
		const side = timeline.direction === "rtl" ? "right" : "left";
		node.style[side] = `${timeline.valueToPixels(display.start - timeline.range.start)}px`;
		node.style.width = `${timeline.valueToPixels(display.end - display.start)}px`;
		node.style.transform = deltaY ? `translateY(${deltaY}px)` : "none";
	};
	const { previewConfig } = presentation;
	useDndMonitor({
		onDragMove(event) {
			if (event.active.id !== id || !clipPresentation) return;
			const next = getMediaSpanFromDrag(event);
			if (next) {
				const resolved = resolveDragEnd(id, next, rowId, previewConfig);
				paintPreview(resolved?.span ?? span, event.delta.y);
			}
		},
		onDragEnd(event) {
			if (event.active.id === id) paintPreview(span);
		},
		onDragCancel(event) {
			if (event.active.id === id) paintPreview(span);
		},
	});
	const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
		id,
		span: displaySpan,
		disabled: disabled || isLoading,
		data: {
			rowId,
			span,
			getSpanFromDragEvent: getMediaSpanFromDrag,
			getSpanFromResizeEvent: getMediaSpanFromResize,
		},
		resizeHandleWidth: variant === "clip" ? CLIP_RESIZE_HANDLE_PX : undefined,
		onResizeMove(event) {
			if (!clipPresentation) return;
			const next = getMediaSpanFromResize(event);
			if (next) {
				const resolved = resolveResizeEnd(id, next, previewConfig);
				if (resolved) paintPreview(resolved);
			}
		},
	});

	const attachRef = useCallback(
		(node: HTMLDivElement | null) => {
			nodeRef.current = node;
			setNodeRef(node);
		},
		[setNodeRef],
	);
	const timeLabel = useMemo(
		() => `${formatPlayheadTime(span.start)} – ${formatPlayheadTime(span.end)}`,
		[span.start, span.end],
	);

	if (isLoading) {
		return (
			<div
				ref={attachRef}
				style={{
					...itemStyle,
					height: "100%",
					display: "flex",
					alignItems: "center",
				}}
				{...listeners}
				{...attributes}
				data-timeline-item="true"
				data-variant={variant}
				data-start-ms={span.start}
				data-end-ms={span.end}
				onMouseDownCapture={(event) => event.stopPropagation()}
				onClickCapture={(event) => event.stopPropagation()}
			>
				<Skeleton
					animationType="shimmer"
					aria-label={loadingLabel || "Loading..."}
					className="w-full"
					style={{ height: "85%", minHeight: 22 }}
				/>
			</div>
		);
	}

	const isZoom = variant === "zoom";
	const isTrim = variant === "trim";
	const isClip = variant === "clip";
	const isSpeed = variant === "speed";
	const isAudio = variant === "audio";
	const isCaption = variant === "caption";
	const showAudioWaveform = isAudio && Boolean(waveformPeaks);
	const clipSpeedLabel = isClip ? formatClipSpeedLabel(speedValue ?? 1) : null;

	const glassClass = isZoom
		? glassStyles.glassBlue
		: isTrim
			? glassStyles.glassRed
			: isClip
				? glassStyles.glassCyan
				: isSpeed
					? glassStyles.glassAmber
					: isAudio
						? glassStyles.glassDarkGreen
						: isCaption
							? glassStyles.glassCaption
							: glassStyles.glassYellow;

	const MIN_ITEM_PX = 6;
	const handleSelect = () => {
		onSelect?.();
		onSelectId?.(id);
	};
	const safeItemStyle = {
		...itemStyle,
		minWidth: MIN_ITEM_PX,
		height: "100%",
		overflow: isClip ? "visible" : "hidden",
		pointerEvents: "auto" as const,
	};

	return (
		<div
			ref={attachRef}
			style={safeItemStyle}
			{...listeners}
			{...attributes}
			data-timeline-item="true"
			data-variant={variant}
			data-start-ms={span.start}
			data-end-ms={span.end}
			aria-label={
				isClip
					? `Clip${clipSpeedLabel ? ` ${clipSpeedLabel}` : ""} · ${timeLabel}`
					: undefined
			}
			onPointerDownCapture={handleSelect}
			onDoubleClick={(event) => {
				if (!onDoubleClick) return;
				event.stopPropagation();
				onDoubleClick();
			}}
			className="group h-full"
		>
			<div
				className="h-full"
				style={{
					...itemContentStyle,
					overflow: isClip ? "visible" : "hidden",
					minWidth: MIN_ITEM_PX,
					height: "100%",
					display: "flex",
					alignItems: "center",
				}}
			>
				<div
					className={cn(
						glassClass,
						"timeline-block w-full flex items-center justify-center gap-1.5 relative",
						isSelected && glassStyles.selected,
						embedded && glassStyles.embeddedCaption,
						isClip ? "overflow-visible" : "overflow-hidden",
					)}
					style={{
						height: "85%",
						minHeight: embedded ? 18 : 22,
						minWidth: MIN_ITEM_PX,
						containerType: "size",
					}}
					onClick={(event) => {
						event.stopPropagation();
					}}
				>
					{isClip && videoPath && (
						<ClipFilmstrip
							path={videoPath}
							span={span}
							sourceSpan={sourceSpan ?? span}
						/>
					)}
					<div
						className={cn(
							glassStyles.zoomEndCap,
							glassStyles.left,
							isClip && glassStyles.clipHandle,
						)}
						style={{
							cursor: "col-resize",
							pointerEvents: isClip ? "none" : "auto",
							display: isClip && sharedLeftGrip ? "none" : undefined,
						}}
						title="Resize left"
					/>
					<div
						className={cn(
							glassStyles.zoomEndCap,
							glassStyles.right,
							isClip && glassStyles.clipHandle,
						)}
						style={{
							cursor: "col-resize",
							pointerEvents: isClip ? "none" : "auto",
							display: isClip && sharedRightGrip ? "none" : undefined,
						}}
						title="Resize right"
					/>
					{/* The visible clip grips sit outside the block. These invisible strips put
					    them inside the area that starts a trim, so grabbing a grip works. */}
					{isClip && !sharedLeftGrip && (
						<div
							aria-hidden="true"
							data-clip-grab="start"
							className="absolute inset-y-0 z-20"
							style={{
								left: -CLIP_RESIZE_HANDLE_PX / 2,
								width: CLIP_GRAB_STRIP_PX,
								cursor: "col-resize",
							}}
						/>
					)}
					{isClip && !sharedRightGrip && (
						<div
							aria-hidden="true"
							data-clip-grab="end"
							className="absolute inset-y-0 z-20"
							style={{
								right: -CLIP_RESIZE_HANDLE_PX / 2,
								width: CLIP_GRAB_STRIP_PX,
								cursor: "col-resize",
							}}
						/>
					)}
					{showAudioWaveform && waveformPeaks && (
						<AudioWaveform
							peaks={waveformPeaks}
							segmentStartMs={waveformSegmentSpan?.start ?? span.start}
							segmentEndMs={waveformSegmentSpan?.end ?? span.end}
							gain={waveformGain}
							normalize={waveformNormalize}
							className="absolute inset-0 w-full h-full pointer-events-none opacity-45"
						/>
					)}
					{/* Muted overlay for source audio track items */}
					{isAudio && muted && (
						<div className="absolute inset-0 z-20 flex items-center justify-center gap-1 bg-red-900/40 pointer-events-none">
							<SpeakerX className="w-3 h-3 text-red-300/90 shrink-0" />
						</div>
					)}
					{/* Normal-speed clips show only the filmstrip and resize handles. */}
					{(!isClip || clipSpeedLabel) && (
						<div
							title={`${isZoom ? `${ZOOM_LABELS[zoomDepth]} ${zoomMode === "manual" ? "Manual" : "Auto"}` : typeof children === "string" ? children : "Clip"} · ${timeLabel}`}
							className={cn(
								"relative z-10 flex max-w-full items-center justify-center gap-1 px-1 text-[11px] font-medium text-black/70 dark:text-white/90 select-none overflow-hidden",
								isClip &&
									"rounded bg-black/65 px-2 py-1 text-white dark:text-white",
								(isZoom || embedded) && "text-white dark:text-white",
								embedded && "w-full justify-start px-2",
							)}
						>
							{isClip ? (
								clipSpeedLabel
							) : isZoom ? (
								<>
									<ZoomIn
										aria-hidden="true"
										className="zoom-icon size-3 shrink-0"
									/>
									<span className="zoom-value whitespace-nowrap">
										{ZOOM_LABELS[zoomDepth] || `${zoomDepth}×`}
										<span className="zoom-mode font-normal">
											{zoomMode === "manual" ? "Manual" : "Auto"}
										</span>
									</span>
								</>
							) : embedded ? (
								<span className="truncate">{children}</span>
							) : (
								<>
									{isTrim ? (
										<Scissors className="size-3 shrink-0" />
									) : isSpeed ? (
										<Gauge className="size-3 shrink-0" />
									) : isAudio ? (
										<Music className="size-3 shrink-0" />
									) : (
										<MessageSquare className="size-3 shrink-0" />
									)}
									<span className="truncate">
										{isTrim ? "Trim" : isSpeed ? `${speedValue}×` : children}
									</span>
								</>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
