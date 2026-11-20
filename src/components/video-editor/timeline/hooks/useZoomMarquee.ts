import { type MouseEventHandler, type PointerEvent, useRef, useState } from "react";

interface ZoomMarquee {
	left: number;
	width: number;
	ids: ReadonlySet<string>;
}

const DRAG_THRESHOLD_PX = 4;

function measureMarquee(row: HTMLElement, anchorX: number, cursorX: number): ZoomMarquee {
	const rect = row.getBoundingClientRect();
	const clampX = (x: number) => Math.max(rect.left, Math.min(rect.right, x));
	const left = clampX(Math.min(anchorX, cursorX));
	const right = clampX(Math.max(anchorX, cursorX));
	const ids = new Set<string>();
	if (right > left) {
		for (const item of row.querySelectorAll<HTMLElement>(
			'[data-variant="zoom"][data-timeline-item-id]',
		)) {
			const itemRect = item.getBoundingClientRect();
			const id = item.dataset.timelineItemId;
			if (id && itemRect.right > left && itemRect.left < right) ids.add(id);
		}
	}
	return { left: left - rect.left, width: right - left, ids };
}

export function useZoomMarquee({
	enabled,
	onSelectZooms,
	onFocusTimeline,
	onClick,
}: {
	enabled: boolean;
	onSelectZooms: (ids: readonly string[]) => void;
	onFocusTimeline: () => void;
	onClick?: MouseEventHandler<HTMLDivElement>;
}) {
	const gesture = useRef<{
		pointerId: number;
		anchorX: number;
		anchorY: number;
		dragging: boolean;
	} | null>(null);
	const suppressClick = useRef(false);
	const [marquee, setMarquee] = useState<ZoomMarquee | null>(null);

	function cancel(event: PointerEvent<HTMLDivElement>) {
		if (gesture.current?.pointerId !== event.pointerId) return;
		gesture.current = null;
		setMarquee(null);
	}

	const pointerHandlers = {
		onPointerDown(event: PointerEvent<HTMLDivElement>) {
			if (!event.isPrimary || event.button !== 0) return;
			suppressClick.current = false;
			if (!enabled || (event.target as Element).closest("[data-timeline-item], button"))
				return;
			gesture.current = {
				pointerId: event.pointerId,
				anchorX: event.clientX,
				anchorY: event.clientY,
				dragging: false,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		onPointerMove(event: PointerEvent<HTMLDivElement>) {
			const active = gesture.current;
			if (active?.pointerId !== event.pointerId) return;
			if (
				!active.dragging &&
				Math.hypot(event.clientX - active.anchorX, event.clientY - active.anchorY) <
					DRAG_THRESHOLD_PX
			)
				return;
			active.dragging = true;
			suppressClick.current = true;
			setMarquee(measureMarquee(event.currentTarget, active.anchorX, event.clientX));
		},
		onPointerUp(event: PointerEvent<HTMLDivElement>) {
			const active = gesture.current;
			if (active?.pointerId !== event.pointerId) return;
			cancel(event);
			if (!active.dragging) return;
			onFocusTimeline();
			const selected = measureMarquee(event.currentTarget, active.anchorX, event.clientX);
			onSelectZooms([...selected.ids]);
		},
		onPointerCancel: cancel,
		onLostPointerCapture: cancel,
	};

	const onRowClick: MouseEventHandler<HTMLDivElement> = (event) => {
		if (suppressClick.current) {
			event.stopPropagation();
			suppressClick.current = false;
			return;
		}
		onClick?.(event);
	};

	return { marquee, pointerHandlers, onRowClick };
}
