import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { mergeHudInteractiveBounds, shouldRestoreHudMousePassthroughAfterDrag } from "../hudMousePassthrough";

const DEFAULT_RECORDING_HUD_OFFSET = { x: 0, y: 0 };

export function useHudBarDrag({
	hudContentRef,
	hudBarRef,
	recordingWebcamPreviewContainerRef,
}: {
	hudContentRef: RefObject<HTMLDivElement>;
	hudBarRef: RefObject<HTMLDivElement>;
	recordingWebcamPreviewContainerRef: RefObject<HTMLDivElement>;
}) {
	const [recordingHudOffset, setRecordingHudOffset] = useState(DEFAULT_RECORDING_HUD_OFFSET);
	const [isHudDragging, setIsHudDragging] = useState(false);
	const hudBarTransformRef = useRef<HTMLDivElement | null>(null);
	const recordingHudOffsetRef = useRef(DEFAULT_RECORDING_HUD_OFFSET);
	const hudDragStartRef = useRef<
		| {
				pointerId: number;
				startX: number;
				startY: number;
				originX: number;
				originY: number;
				initialLeft: number;
				initialTop: number;
				hudWidth: number;
				hudHeight: number;
		  }
		| null
	>(null);
	const isHudDraggingRef = useRef(false);
	const hudDragMoveRafRef = useRef<number | null>(null);
	const hudDragPendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

	useEffect(() => {
		recordingHudOffsetRef.current = recordingHudOffset;
		if (!isHudDraggingRef.current && hudBarTransformRef.current) {
			hudBarTransformRef.current.style.transform = `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`;
		}
	}, [recordingHudOffset]);

	const handleHudBarPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return;
		}

		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		isHudDraggingRef.current = true;
		setIsHudDragging(true);
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		if (!hudBarRef.current) {
			return;
		}
		const hudRect = hudBarRef.current.getBoundingClientRect();
		hudDragStartRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: recordingHudOffsetRef.current.x,
			originY: recordingHudOffsetRef.current.y,
			initialLeft: hudRect.left,
			initialTop: hudRect.top,
			hudWidth: hudRect.width,
			hudHeight: hudRect.height,
		};
	}, [hudBarRef]);

	const handleHudBarPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = hudDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
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

		const pointer = hudDragPendingPointerRef.current || { clientX: event.clientX, clientY: event.clientY };
		const deltaX = pointer.clientX - dragState.startX;
		const deltaY = pointer.clientY - dragState.startY;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		const clampedLeft = Math.min(
			Math.max(0, dragState.initialLeft + deltaX),
			Math.max(0, viewportWidth - dragState.hudWidth),
		);
		const clampedTop = Math.min(
			Math.max(0, dragState.initialTop + deltaY),
			Math.max(0, viewportHeight - dragState.hudHeight),
		);

		recordingHudOffsetRef.current = {
			x: dragState.originX + (clampedLeft - dragState.initialLeft),
			y: dragState.originY + (clampedTop - dragState.initialTop),
		};

		if (hudDragMoveRafRef.current !== null) {
			cancelAnimationFrame(hudDragMoveRafRef.current);
			hudDragMoveRafRef.current = null;
		}
		hudDragPendingPointerRef.current = null;

		hudDragStartRef.current = null;
		const wasDragging = isHudDraggingRef.current;
		isHudDraggingRef.current = false;
		setRecordingHudOffset({ ...recordingHudOffsetRef.current });
		setIsHudDragging(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const hudBounds = mergeHudInteractiveBounds(
			[
				hudContentRef.current?.getBoundingClientRect(),
				hudBarRef.current?.getBoundingClientRect(),
				recordingWebcamPreviewContainerRef.current?.getBoundingClientRect(),
			].map((bounds) =>
				bounds
					? {
							left: bounds.left,
							top: bounds.top,
							right: bounds.right,
							bottom: bounds.bottom,
					  }
					: null,
			),
		);
		if (wasDragging && shouldRestoreHudMousePassthroughAfterDrag(hudBounds, event.clientX, event.clientY)) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	}, [hudBarRef, hudContentRef, recordingWebcamPreviewContainerRef]);

	useEffect(() => {
		return () => {
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
