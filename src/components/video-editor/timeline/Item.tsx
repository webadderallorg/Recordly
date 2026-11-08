import { useDndMonitor } from "@dnd-kit/core";
import type { GetSpanFromDragEvent, GetSpanFromResizeEvent, Span } from "dnd-timeline";
import { useItem, useTimelineContext } from "dnd-timeline";
import { useCallback, useMemo, useRef } from "react";
import { GiRabbit, GiTortoise } from "react-icons/gi";
import {
	Gauge,
	ChatCircle as MessageSquare,
	Mouse,
	MusicNotes as Music,
	Scissors,
	SpeakerX,
	MagnifyingGlass as ZoomIn,
} from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { formatClipSpeedLabel } from "../clipSpeedChange";
import { ClipFilmstrip } from "./components/filmstrip/ClipFilmstrip";
import AudioWaveform from "./components/waveform/AudioWaveform";
import {
	type ClipPresentation,
	getRegionDisplaySpan,
	getTimeAtClipSeam,
	snapRegionSpan,
} from "./core/clipPresentation";
import { ZOOM_ROW_ID } from "./core/constants";
import { useTimelinePresentation } from "./core/TimelinePresentation";
import { formatPlayheadTime } from "./core/time";
import type { AudioPeaksData } from "./core/timelineTypes";
import { getZoomDisplaySpan, getZoomResizeSpan } from "./core/zoomPresentation";
import { getSiblingSpans, resolveDragEnd, resolveResizeEnd } from "./dnd/engine";
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
	onSelectId?: (id: string, extend?: boolean) => void;
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
}

// Map zoom depth to numeric multipliers for locale-aware display.
const ZOOM_FACTORS: Record<number, number> = {
	1: 1.25,
	2: 1.5,
	3: 1.8,
	4: 2.2,
	5: 3.5,
	6: 5,
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
	children,
}: ItemProps) {
	const te = useScopedT("editing");
	const tSettings = useScopedT("settings");
	const { locale } = useI18n();
	const formatNumber = (value: number) =>
		new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 }).format(
			value,
		);
	const zoomLabel = `${formatNumber(ZOOM_FACTORS[zoomDepth] ?? zoomDepth)}×`;
	const timeline = useTimelineContext();
	const presentation = useTimelinePresentation();
	const { previewConfig } = presentation;
	const clipPresentation =
		variant === "clip" ? undefined : (suppliedPresentation ?? presentation.clips);
	const hasZoomTail = variant === "zoom";
	const toVisibleSpan = (next: Span) => {
		if (!hasZoomTail) return next;
		const visible = getZoomDisplaySpan(next, presentation.zoomTiming);
		// Stored edits use whole milliseconds. Keep a snapped end on the same
		// side of a clip seam after the hidden tail is projected away.
		return { ...visible, end: Math.round(visible.end) };
	};
	const visibleSpan = toVisibleSpan(span);
	const displaySpan = clipPresentation?.length
		? getRegionDisplaySpan(visibleSpan, clipPresentation)
		: (suppliedDisplaySpan ?? visibleSpan);
	const nodeRef = useRef<HTMLDivElement | null>(null);
	const dragOriginRef = useRef<{
		span: Span;
		displaySpan: Span;
		rangeStart: number;
	} | null>(null);
	const dragPreviewRef = useRef<{ display: Span; deltaY: number } | null>(null);
	const targets = useMemo(
		() => [
			...new Set(
				presentation.regions
					.filter((region) => region.id !== id)
					.flatMap((region) => {
						const visible =
							region.rowId === ZOOM_ROW_ID
								? getZoomDisplaySpan(region, presentation.zoomTiming)
								: region;
						return [
							visible.start,
							region.rowId === ZOOM_ROW_ID ? Math.round(visible.end) : visible.end,
						];
					}),
			),
		],
		[presentation.regions, presentation.zoomTiming, id],
	);
	const snap = (next: Span, edge?: "start" | "end") =>
		snapRegionSpan(next, targets, presentation.clips, timeline.pixelsToValue(1), edge);
	const resizeZoom = (resized: Span, edge: "start" | "end") => {
		// The untouched end must retain its fractional precision. Rounding it up
		// can make a long zoom's exit tail exceed the timeline/neighbor boundary,
		// causing the constraint solver to collapse it to a much shorter interval.
		const preciseSpan =
			edge === "start"
				? { ...resized, end: getZoomDisplaySpan(span, presentation.zoomTiming).end }
				: resized;
		const siblings = getSiblingSpans(id, rowId, previewConfig.allRegionSpans);
		const previous = [...siblings].reverse().find((region) => region.end <= span.start);
		const next = siblings.find((region) => region.start >= span.end);
		return getZoomResizeSpan(preciseSpan, presentation.zoomTiming, edge, {
			start: previous?.end ?? 0,
			end: Math.min(
				next?.start ?? Number.MAX_SAFE_INTEGER,
				previewConfig.totalMs > 0 ? previewConfig.totalMs : Number.MAX_SAFE_INTEGER,
			),
			minDurationMs: previewConfig.minItemDurationMs,
		});
	};
	const getMediaSpanFromDrag: GetSpanFromDragEvent = (event) => {
		if (!("delta" in event)) return span;
		if (!clipPresentation) {
			const dragged = timeline.getSpanFromDragEvent(event);
			if (!dragged) return null;
			const visualOffset = displaySpan.start - span.start;
			return { start: dragged.start - visualOffset, end: dragged.end - visualOffset };
		}
		// Preview renders move both the node and its span prop. Always measure
		// from the picked-up position, never from that moving DOM rectangle.
		const origin = dragOriginRef.current ?? {
			span,
			displaySpan,
			rangeStart: timeline.range.start,
		};
		const delta =
			timeline.pixelsToValue(event.delta.x) * (timeline.direction === "rtl" ? -1 : 1);
		const displayStart =
			origin.displaySpan.start + delta + timeline.range.start - origin.rangeStart;
		const start = getTimeAtClipSeam(displayStart, clipPresentation);
		const visible = toVisibleSpan(origin.span);
		const snapped = snap({ start, end: start + visible.end - visible.start });
		return {
			start: snapped.start,
			end: snapped.start + origin.span.end - origin.span.start,
		};
	};
	const getMediaSpanFromResize: GetSpanFromResizeEvent = (event) => {
		const delta = timeline.pixelsToValue(event.delta.x);
		const edge = event.direction;
		if (clipPresentation) {
			const resized = snap(
				{
					...visibleSpan,
					[edge]: getTimeAtClipSeam(displaySpan[edge] + delta, clipPresentation),
				},
				edge,
			);
			return hasZoomTail ? resizeZoom(resized, edge) : { ...span, [edge]: resized[edge] };
		}
		if (hasZoomTail) {
			return resizeZoom({ ...visibleSpan, [edge]: visibleSpan[edge] + delta }, edge);
		}
		const scale = (span.end - span.start) / (displaySpan.end - displaySpan.start);
		return { ...span, [edge]: span[edge] + delta * scale };
	};

	const paintPreview = (preview: Span, deltaY = 0) => {
		const node = nodeRef.current;
		if (!node || !clipPresentation) return;
		const display = getRegionDisplaySpan(toVisibleSpan(preview), clipPresentation);
		const side = timeline.direction === "rtl" ? "right" : "left";
		const origin = dragOriginRef.current?.displaySpan;
		if (origin) dragPreviewRef.current = { display, deltaY };
		const left = origin?.start ?? display.start;
		node.style[side] = `${timeline.valueToPixels(left - timeline.range.start)}px`;
		node.style.width = `${timeline.valueToPixels(display.end - display.start)}px`;
		const deltaX = origin
			? timeline.valueToPixels(display.start - origin.start) *
				(timeline.direction === "rtl" ? -1 : 1)
			: 0;
		node.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
	};
	useDndMonitor({
		onDragStart(event) {
			if (event.active.id === id && clipPresentation) {
				dragPreviewRef.current = null;
				dragOriginRef.current = {
					span,
					displaySpan,
					rangeStart: timeline.range.start,
				};
			}
		},
		onDragMove(event) {
			if (event.active.id !== id || !clipPresentation) return;
			const next = getMediaSpanFromDrag(event);
			if (next) {
				const resolved = resolveDragEnd(id, next, rowId, previewConfig);
				paintPreview(resolved?.span ?? span, event.delta.y);
			}
		},
		onDragEnd(event) {
			if (event.active.id === id) {
				paintPreview(span);
				dragOriginRef.current = null;
				dragPreviewRef.current = null;
			}
		},
		onDragCancel(event) {
			if (event.active.id === id) {
				paintPreview(span);
				dragOriginRef.current = null;
				dragPreviewRef.current = null;
			}
		},
	});
	const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
		id,
		// Keep the measured layout fixed during pickup. Moving it as part of a
		// preview makes dnd-kit compensate its delta and can swallow pointer moves.
		span: dragOriginRef.current?.displaySpan ?? displaySpan,
		disabled: disabled || isLoading,
		data: {
			rowId,
			span,
			getSpanFromDragEvent: getMediaSpanFromDrag,
			getSpanFromResizeEvent: getMediaSpanFromResize,
		},
		resizeHandleWidth: variant === "clip" ? 12 : undefined,
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
		() => `${formatPlayheadTime(visibleSpan.start)} – ${formatPlayheadTime(visibleSpan.end)}`,
		[visibleSpan.start, visibleSpan.end],
	);
	const durationLabel = new Intl.NumberFormat(locale, {
		style: "unit",
		unit: "second",
		unitDisplay: "narrow",
		minimumFractionDigits: variant === "clip" ? 1 : 0,
		maximumFractionDigits: 2,
	}).format(Math.max(0, span.end - span.start) / 1000);

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
				data-end-ms={variant === "zoom" ? Math.round(visibleSpan.end) : span.end}
				data-stored-end-ms={variant === "zoom" ? span.end : undefined}
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
	const rawClipSpeedLabel = isClip ? formatClipSpeedLabel(speedValue ?? 1) : null;
	const clipSpeedLabel = rawClipSpeedLabel ? `${formatNumber(speedValue ?? 1)}x` : null;
	const SpeedIcon = (speedValue ?? 1) < 1 ? GiTortoise : (speedValue ?? 1) > 1 ? GiRabbit : Gauge;

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
	const handleSelect = (event: React.PointerEvent) => {
		onSelect?.();
		onSelectId?.(id, event.shiftKey);
	};
	const previewDisplaySpan = dragPreviewRef.current?.display ?? displaySpan;
	const safeItemStyle = {
		...itemStyle,
		...(clipPresentation && dragOriginRef.current
			? {
					width: timeline.valueToPixels(
						previewDisplaySpan.end - previewDisplaySpan.start,
					),
					transform: `translate(${timeline.valueToPixels(previewDisplaySpan.start - dragOriginRef.current.displaySpan.start) * (timeline.direction === "rtl" ? -1 : 1)}px, ${dragPreviewRef.current?.deltaY ?? 0}px)`,
				}
			: {}),
		minWidth: MIN_ITEM_PX,
		height: "100%",
		overflow: isClip ? "visible" : "hidden",
		pointerEvents: "auto" as const,
	};

	return (
		<div
			ref={attachRef}
			style={safeItemStyle}
			data-timeline-item-id={id}
			data-selected={isSelected}
			{...listeners}
			{...attributes}
			data-timeline-item="true"
			data-variant={variant}
			data-start-ms={span.start}
			data-end-ms={variant === "zoom" ? Math.round(visibleSpan.end) : span.end}
			data-stored-end-ms={variant === "zoom" ? span.end : undefined}
			aria-label={
				isClip
					? `${te("clips")}${clipSpeedLabel ? ` ${clipSpeedLabel}` : ""} · ${timeLabel} · ${durationLabel}`
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
						title={te("resizeLeft", "Resize left")}
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
						title={te("resizeRight", "Resize right")}
					/>
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
					{isClip && (
						<span data-clip-duration className={glassStyles.clipDuration}>
							{durationLabel}
						</span>
					)}
					{/* Playback-speed badges remain visible independently of duration. */}
					{(!isClip || clipSpeedLabel) && (
						<div
							title={`${isZoom ? `${zoomLabel} ${zoomMode === "manual" ? te("manual", "Manual") : te("auto", "Auto")}` : typeof children === "string" ? children : te("clip", "Clip")} · ${timeLabel}`}
							className={cn(
								"relative z-10 flex max-w-full items-center justify-center gap-1 px-1 text-[11px] font-medium text-black/70 dark:text-white/90 select-none overflow-hidden",
								(isClip || isSpeed) && glassStyles.speedBadge,
								isClip &&
									"rounded bg-black/65 px-2 py-1 text-white dark:text-white",
								(isZoom || embedded) && "text-white dark:text-white",
								embedded && "w-full justify-start px-2",
							)}
						>
							{isClip ? (
								<>
									<SpeedIcon
										aria-hidden="true"
										className="speed-icon size-3.5 shrink-0"
									/>
									<span
										className={cn("whitespace-nowrap", glassStyles.speedValue)}
									>
										{clipSpeedLabel}
									</span>
								</>
							) : isZoom ? (
								<span className="zoom-description flex min-w-0 flex-col items-center justify-center gap-1 leading-none">
									<span className="zoom-title text-xs font-medium text-white/25">
										{tSettings("sections.zoom", "Zoom")}
									</span>
									<span className="zoom-details flex items-center justify-center gap-1 text-sm font-normal leading-none">
										<ZoomIn
											aria-hidden="true"
											className="zoom-icon size-3.5 shrink-0"
										/>
										<span className="zoom-value whitespace-nowrap">
											{zoomLabel}
										</span>
										<span className="zoom-mode inline-flex items-center gap-1 whitespace-nowrap">
											<Mouse
												aria-hidden="true"
												weight="fill"
												className="size-3.5 shrink-0"
											/>
											{zoomMode === "manual"
												? te("manual", "Manual")
												: te("auto", "Auto")}
										</span>
									</span>
								</span>
							) : embedded ? (
								<span className="truncate">{children}</span>
							) : (
								<>
									{isTrim ? (
										<Scissors className="size-3 shrink-0" />
									) : isSpeed ? (
										<SpeedIcon
											aria-hidden="true"
											className="speed-icon size-3.5 shrink-0"
										/>
									) : isAudio ? (
										<Music className="size-3 shrink-0" />
									) : (
										<MessageSquare className="size-3 shrink-0" />
									)}
									<span
										className={cn(
											"truncate",
											isSpeed && glassStyles.speedValue,
										)}
									>
										{isTrim
											? te("trim", "Trim")
											: isSpeed
												? `${formatNumber(speedValue ?? 1)}×`
												: children}
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
