import type { DragDirection, GetSpanFromResizeEvent, Span } from "dnd-timeline";
import { useTimelineContext } from "dnd-timeline";
import { type CSSProperties, type PointerEvent, useRef, useState } from "react";

interface ResizeSession {
	pointerId: number;
	edge: DragDirection;
	initialX: number;
	span: Span;
}

const MOVE_TARGET_PX = 14;
export function useCompactZoomResize({
	id,
	span,
	displaySpan,
	enabled,
	getSpanFromResizeEvent,
	getDisplayPreview,
}: {
	id: string;
	span: Span;
	displaySpan: Span;
	enabled: boolean;
	getSpanFromResizeEvent: GetSpanFromResizeEvent;
	getDisplayPreview: (span: Span) => Span | null;
}) {
	const timeline = useTimelineContext();
	const sessionRef = useRef<ResizeSession | null>(null);
	const [preview, setPreview] = useState<Span | null>(null);
	const itemWidth = timeline.valueToPixels(displaySpan.end - displaySpan.start);
	const compact = enabled && itemWidth < timeline.resizeHandleWidth + MOVE_TARGET_PX;
	const startSide = timeline.direction === "rtl" ? "right" : "left";
	const previewStyle: CSSProperties | undefined = preview
		? {
				[startSide]: timeline.valueToPixels(preview.start - timeline.range.start),
				width: timeline.valueToPixels(preview.end - preview.start),
			}
		: undefined;

	function resizeEvent(session: ResizeSession, event: PointerEvent, commit: boolean) {
		return {
			activatorEvent: event.nativeEvent,
			active: {
				id,
				data: {
					current: {
						span: session.span,
						getSpanFromResizeEvent: commit ? getSpanFromResizeEvent : undefined,
					},
				},
			},
			delta: {
				x: (event.clientX - session.initialX) * (timeline.direction === "rtl" ? -1 : 1),
			},
			direction: session.edge,
		};
	}

	function getHandleProps(edge: DragDirection) {
		function finish(event: PointerEvent<HTMLDivElement>, commit: boolean) {
			const session = sessionRef.current;
			if (session?.pointerId !== event.pointerId) return;
			event.stopPropagation();
			sessionRef.current = null;
			setPreview(null);
			const moved = event.clientX !== session.initialX;
			timeline.onResizeEnd(resizeEvent(session, event, commit && moved));
		}

		return {
			onPointerDown(event: PointerEvent<HTMLDivElement>) {
				if (!event.isPrimary || event.button !== 0 || sessionRef.current) return;
				event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				const session = { pointerId: event.pointerId, edge, initialX: event.clientX, span };
				sessionRef.current = session;
				timeline.onResizeStart?.(resizeEvent(session, event, true));
			},
			onPointerMove(event: PointerEvent<HTMLDivElement>) {
				const session = sessionRef.current;
				if (session?.pointerId !== event.pointerId) return;
				event.stopPropagation();
				const update = resizeEvent(session, event, true);
				const proposed = getSpanFromResizeEvent(update);
				setPreview(proposed ? getDisplayPreview(proposed) : null);
				timeline.onResizeMove?.(update);
			},
			onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
			onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, false),
			onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event, false),
		};
	}

	return { compact, previewStyle, getHandleProps };
}
