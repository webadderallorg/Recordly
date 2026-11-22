import { type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { getHudInteractiveBounds, isPointerOverHudSurface } from "../hudMousePassthrough";
import { clampHudOffsetToViewport } from "../hudViewportBounds";

const DEFAULT_RECORDING_HUD_OFFSET = { x: 0, y: 0 };

export function useHudBarDrag({
	hudBarRef,
	docked = false,
	dragX11Window = false,
}: {
	hudContentRef: RefObject<HTMLDivElement | null>;
	hudBarRef: RefObject<HTMLDivElement | null>;
	recordingWebcamPreviewContainerRef: RefObject<HTMLDivElement | null>;
	docked?: boolean;
	dragX11Window?: boolean;
}) {
	const [recordingHudOffset, setRecordingHudOffset] = useState(DEFAULT_RECORDING_HUD_OFFSET);
	const [isHudDragging, setIsHudDragging] = useState(false);
	const hudBarTransformRef = useRef<HTMLDivElement | null>(null);
	const recordingHudOffsetRef = useRef(DEFAULT_RECORDING_HUD_OFFSET);
	const hudDragStartRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		initialLeft: number;
		initialTop: number;
		hudWidth: number;
		hudHeight: number;
		dragging: boolean;
		dragWindow: boolean;
	} | null>(null);
	const isHudDraggingRef = useRef(false);
	const hudDragMoveRafRef = useRef<number | null>(null);
	const hudDragPendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const hudDragCaptureRef = useRef<HTMLDivElement | null>(null);
	const hudDragLastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

	useEffect(() => {
		recordingHudOffsetRef.current = recordingHudOffset;
		if (!docked && !isHudDraggingRef.current && hudBarTransformRef.current) {
			hudBarTransformRef.current.style.transform = `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`;
		}
	}, [recordingHudOffset, docked]);

	const keepHudBarInsideViewport = useCallback(() => {
		if (docked || isHudDraggingRef.current || !hudBarRef.current) {
			return;
		}

		const bounds = hudBarRef.current.getBoundingClientRect();
		const nextOffset = clampHudOffsetToViewport(recordingHudOffsetRef.current, bounds, {
			width: window.innerWidth,
			height: window.innerHeight,
		});
		if (
			nextOffset.x === recordingHudOffsetRef.current.x &&
			nextOffset.y === recordingHudOffsetRef.current.y
		) {
			return;
		}

		recordingHudOffsetRef.current = nextOffset;
		if (hudBarTransformRef.current) {
			hudBarTransformRef.current.style.transform = `translate3d(${nextOffset.x}px, ${nextOffset.y}px, 0)`;
		}
		setRecordingHudOffset(nextOffset);
	}, [hudBarRef, docked]);

	useEffect(() => {
		const resizeObserver =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(keepHudBarInsideViewport);
		if (hudBarRef.current) {
			resizeObserver?.observe(hudBarRef.current);
		}
		window.addEventListener("resize", keepHudBarInsideViewport);

		return () => {
			window.removeEventListener("resize", keepHudBarInsideViewport);
			resizeObserver?.disconnect();
		};
	}, [hudBarRef, keepHudBarInsideViewport]);

	const handleHudBarPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0 || hudDragStartRef.current || !hudBarRef.current || docked) {
				return;
			}
			if (
				(event.target as HTMLElement).closest(
					"button, input, video, [role=button], [data-hud-interactive]",
				)
			)
				return;

			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			hudDragCaptureRef.current = event.currentTarget;
			hudDragLastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
			isHudDraggingRef.current = true;
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			if (!hudBarRef.current) {
				return;
			}
			const hudRect = hudBarRef.current.getBoundingClientRect();
			hudDragStartRef.current = {
				pointerId: event.pointerId,
				startX: dragX11Window ? event.screenX : event.clientX,
				startY: dragX11Window ? event.screenY : event.clientY,
				originX: recordingHudOffsetRef.current.x,
				originY: recordingHudOffsetRef.current.y,
				initialLeft: hudRect.left,
				initialTop: hudRect.top,
				hudWidth: hudRect.width,
				hudHeight: hudRect.height,
				dragging: false,
				dragWindow: dragX11Window,
			};
			if (dragX11Window) {
				window.electronAPI?.hudOverlayDrag?.("start", event.screenX, event.screenY);
			}
		},
		[hudBarRef, docked, dragX11Window],
	);

	const handleHudBarPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = hudDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}
		hudDragLastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
		const x = dragState.dragWindow ? event.screenX : event.clientX;
		const y = dragState.dragWindow ? event.screenY : event.clientY;
		if (!dragState.dragging && Math.hypot(x - dragState.startX, y - dragState.startY) < 6)
			return;
		isHudDraggingRef.current = true;
		dragState.dragging = true;
		setIsHudDragging(true);

		if (dragState.dragWindow) {
			window.electronAPI?.hudOverlayDrag?.("move", x, y);
			return;
		}

		hudDragPendingPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
		if (hudDragMoveRafRef.current !== null) {
			return;
		}

		hudDragMoveRafRef.current = requestAnimationFrame(() => {
			hudDragMoveRafRef.current = null;
			const latestDragState = hudDragStartRef.current;
			const pointer = hudDragPendingPointerRef.current;
			if (!latestDragState || !pointer) {
				return;
			}

			const deltaX = pointer.clientX - latestDragState.startX;
			const deltaY = pointer.clientY - latestDragState.startY;
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			const unclampedLeft = latestDragState.initialLeft + deltaX;
			const unclampedTop = latestDragState.initialTop + deltaY;
			const clampedLeft = Math.min(
				Math.max(0, unclampedLeft),
				Math.max(0, viewportWidth - latestDragState.hudWidth),
			);
			const clampedTop = Math.min(
				Math.max(0, unclampedTop),
				Math.max(0, viewportHeight - latestDragState.hudHeight),
			);

			const nextOffset = {
				x: latestDragState.originX + (clampedLeft - latestDragState.initialLeft),
				y: latestDragState.originY + (clampedTop - latestDragState.initialTop),
			};
			recordingHudOffsetRef.current = nextOffset;
			if (hudBarTransformRef.current) {
				hudBarTransformRef.current.style.transform = `translate3d(${nextOffset.x}px, ${nextOffset.y}px, 0)`;
			}
		});
	}, []);

	const handleHudBarPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = hudDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		const pointer =
			event.type === "pointerup"
				? event
				: (hudDragLastPointerRef.current ?? {
						clientX: dragState.startX,
						clientY: dragState.startY,
					});
		if (dragState.dragWindow) {
			if (dragState.dragging && event.type === "pointerup") {
				window.electronAPI?.hudOverlayDrag?.("move", event.screenX, event.screenY);
			}
			window.electronAPI?.hudOverlayDrag?.("end", dragState.startX, dragState.startY);
		} else if (dragState.dragging) {
			const clampedLeft = Math.min(
				Math.max(0, dragState.initialLeft + pointer.clientX - dragState.startX),
				Math.max(0, window.innerWidth - dragState.hudWidth),
			);
			const clampedTop = Math.min(
				Math.max(0, dragState.initialTop + pointer.clientY - dragState.startY),
				Math.max(0, window.innerHeight - dragState.hudHeight),
			);
			recordingHudOffsetRef.current = {
				x: dragState.originX + (clampedLeft - dragState.initialLeft),
				y: dragState.originY + (clampedTop - dragState.initialTop),
			};
		}
		if (hudBarTransformRef.current) {
			hudBarTransformRef.current.style.transform = `translate3d(${recordingHudOffsetRef.current.x}px, ${recordingHudOffsetRef.current.y}px, 0)`;
		}

		if (hudDragMoveRafRef.current !== null) {
			cancelAnimationFrame(hudDragMoveRafRef.current);
			hudDragMoveRafRef.current = null;
		}
		hudDragPendingPointerRef.current = null;

		hudDragStartRef.current = null;
		hudDragCaptureRef.current = null;
		hudDragLastPointerRef.current = null;
		const wasDragging = isHudDraggingRef.current;
		isHudDraggingRef.current = false;
		setRecordingHudOffset({ ...recordingHudOffsetRef.current });
		setIsHudDragging(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (
			wasDragging &&
			!isPointerOverHudSurface(
				getHudInteractiveBounds(document),
				pointer.clientX,
				pointer.clientY,
			)
		) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	}, []);

	useEffect(() => {
		const releaseOnBlur = () => {
			const dragState = hudDragStartRef.current;
			if (!dragState) return;
			if (dragState.dragWindow) {
				window.electronAPI?.hudOverlayDrag?.("end", dragState.startX, dragState.startY);
			}
			if (hudDragMoveRafRef.current !== null) cancelAnimationFrame(hudDragMoveRafRef.current);
			hudDragMoveRafRef.current = null;
			hudDragPendingPointerRef.current = null;
			hudDragStartRef.current = null;
			isHudDraggingRef.current = false;
			setIsHudDragging(false);
			setRecordingHudOffset({ ...recordingHudOffsetRef.current });
			const target = hudDragCaptureRef.current;
			if (target?.hasPointerCapture(dragState.pointerId))
				target.releasePointerCapture(dragState.pointerId);
			hudDragCaptureRef.current = null;
			hudDragLastPointerRef.current = null;
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		};
		window.addEventListener("blur", releaseOnBlur);
		return () => {
			window.removeEventListener("blur", releaseOnBlur);
			const dragState = hudDragStartRef.current;
			if (dragState?.dragWindow) {
				window.electronAPI?.hudOverlayDrag?.("end", dragState.startX, dragState.startY);
			}
			if (hudDragMoveRafRef.current !== null) {
				cancelAnimationFrame(hudDragMoveRafRef.current);
			}
			hudDragMoveRafRef.current = null;
			hudDragPendingPointerRef.current = null;
			hudDragStartRef.current = null;
		};
	}, []);

	return {
		recordingHudOffset,
		isHudDragging,
		hudBarTransformRef,
		isHudDraggingRef,
		handleHudBarPointerDown,
		handleHudBarPointerMove,
		handleHudBarPointerUp,
	};
}
