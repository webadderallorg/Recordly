import {
	type Dispatch,
	type PointerEvent,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
} from "react";
import { getHudInteractiveBounds, isPointerOverHudSurface } from "../hudMousePassthrough";
import {
	DEFAULT_WEBCAM_PREVIEW_OFFSET,
	type useWebcamPreviewGeometry,
} from "./useWebcamPreviewGeometry";

const WEBCAM_PREVIEW_DRAG_THRESHOLD = 6;

/** Coordinates camera dragging, pointer capture, and cursor restoration. */
export function useWebcamPreviewPointer({
	webcamEnabled,
	showRecordingWebcamPreview,
	setShowFloatingWebcamPreview,
	geometry,
}: {
	webcamEnabled: boolean;
	showRecordingWebcamPreview: boolean;
	setShowFloatingWebcamPreview: Dispatch<SetStateAction<boolean>>;
	geometry: ReturnType<typeof useWebcamPreviewGeometry>;
}) {
	const {
		webcamPreviewOffsetRef,
		setWebcamPreviewOffset,
		recordingWebcamPreviewContainerRef,
		getDockBounds,
		keepDockInsideViewport,
	} = geometry;
	const previewDragMoveRafRef = useRef<number | null>(null);
	const previewDragPendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const webcamPreviewDragStartRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		initialLeft: number;
		initialTop: number;
		previewWidth: number;
		previewHeight: number;
		dragging: boolean;
	} | null>(null);
	const isWebcamPreviewDraggingRef = useRef(false);
	const lastPreviewPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const restorePreviewCursorRef = useRef<(() => void) | null>(null);
	const restorePreviewCursor = useCallback(() => {
		restorePreviewCursorRef.current?.();
		restorePreviewCursorRef.current = null;
	}, []);
	const setPreviewCursor = useCallback((cursor: string) => {
		const root = document.documentElement;
		if (!restorePreviewCursorRef.current) {
			const previousAttribute = root.getAttribute("data-webcam-preview-cursor");
			const previousValue = root.style.getPropertyValue("--webcam-preview-cursor");
			const previousPriority = root.style.getPropertyPriority("--webcam-preview-cursor");
			restorePreviewCursorRef.current = () => {
				if (previousAttribute === null) root.removeAttribute("data-webcam-preview-cursor");
				else root.setAttribute("data-webcam-preview-cursor", previousAttribute);
				if (previousValue)
					root.style.setProperty(
						"--webcam-preview-cursor",
						previousValue,
						previousPriority,
					);
				else root.style.removeProperty("--webcam-preview-cursor");
			};
		}
		root.setAttribute("data-webcam-preview-cursor", cursor);
		root.style.setProperty("--webcam-preview-cursor", cursor);
	}, []);
	const handleWebcamPreviewPointerOver = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (webcamPreviewDragStartRef.current) return;
			if ((event.target as HTMLElement).closest("button, input, a, [role=button]")) {
				restorePreviewCursor();
				return;
			}
			setPreviewCursor("grab");
		},
		[setPreviewCursor, restorePreviewCursor],
	);
	const handleWebcamPreviewPointerLeave = useCallback(() => {
		if (!webcamPreviewDragStartRef.current) restorePreviewCursor();
	}, [restorePreviewCursor]);
	useEffect(() => {
		if (!showRecordingWebcamPreview) restorePreviewCursor();
	}, [showRecordingWebcamPreview, restorePreviewCursor]);

	useEffect(() => {
		if (!webcamEnabled) {
			webcamPreviewOffsetRef.current = DEFAULT_WEBCAM_PREVIEW_OFFSET;
			setWebcamPreviewOffset(DEFAULT_WEBCAM_PREVIEW_OFFSET);
			if (recordingWebcamPreviewContainerRef.current) {
				recordingWebcamPreviewContainerRef.current.style.transform = "translate(0px, 0px)";
			}
			webcamPreviewDragStartRef.current = null;
			lastPreviewPointerRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
			restorePreviewCursor();
			setShowFloatingWebcamPreview(true);
		}
	}, [
		webcamEnabled,
		restorePreviewCursor,
		webcamPreviewOffsetRef,
		setWebcamPreviewOffset,
		recordingWebcamPreviewContainerRef,
		setShowFloatingWebcamPreview,
	]);

	const handleWebcamPreviewPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (
				event.button !== 0 ||
				webcamPreviewDragStartRef.current ||
				!event.currentTarget.contains(event.target as Node) ||
				(event.target as HTMLElement).closest("button, input, a, [role=button]")
			) {
				return;
			}

			keepDockInsideViewport();
			const previewRect = getDockBounds(true) ?? event.currentTarget.getBoundingClientRect();

			event.preventDefault();
			setPreviewCursor("grabbing");
			lastPreviewPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			webcamPreviewDragStartRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				originX: webcamPreviewOffsetRef.current.x,
				originY: webcamPreviewOffsetRef.current.y,
				initialLeft: previewRect.left,
				initialTop: previewRect.top,
				previewWidth: previewRect.width,
				previewHeight: previewRect.height,
				dragging: false,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[setPreviewCursor, getDockBounds, keepDockInsideViewport, webcamPreviewOffsetRef],
	);

	const applyWebcamPreviewDragPosition = useCallback(
		(clientX: number, clientY: number) => {
			const dragState = webcamPreviewDragStartRef.current;
			if (!dragState) return;

			// All coordinates are relative to the HUD viewport, including on scaled displays.
			const left = Math.min(
				Math.max(0, dragState.initialLeft + clientX - dragState.startX),
				Math.max(0, window.innerWidth - dragState.previewWidth),
			);
			const top = Math.min(
				Math.max(0, dragState.initialTop + clientY - dragState.startY),
				Math.max(0, window.innerHeight - dragState.previewHeight),
			);
			const nextOffset = {
				x: dragState.originX + left - dragState.initialLeft,
				y: dragState.originY + top - dragState.initialTop,
			};
			webcamPreviewOffsetRef.current = nextOffset;
			if (recordingWebcamPreviewContainerRef.current) {
				recordingWebcamPreviewContainerRef.current.style.transform = `translate(${nextOffset.x}px, ${nextOffset.y}px)`;
			}
		},
		[webcamPreviewOffsetRef, recordingWebcamPreviewContainerRef],
	);

	const handleWebcamPreviewPointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const dragState = webcamPreviewDragStartRef.current;
			if (!dragState) {
				handleWebcamPreviewPointerOver(event);
				return;
			}
			if (dragState.pointerId !== event.pointerId) return;
			lastPreviewPointerRef.current = { clientX: event.clientX, clientY: event.clientY };

			const deltaX = event.clientX - dragState.startX;
			const deltaY = event.clientY - dragState.startY;
			if (!dragState.dragging && Math.hypot(deltaX, deltaY) < WEBCAM_PREVIEW_DRAG_THRESHOLD)
				return;

			dragState.dragging = true;
			isWebcamPreviewDraggingRef.current = true;
			previewDragPendingPointerRef.current = {
				clientX: event.clientX,
				clientY: event.clientY,
			};
			if (previewDragMoveRafRef.current !== null) return;

			previewDragMoveRafRef.current = requestAnimationFrame(() => {
				previewDragMoveRafRef.current = null;
				const pointer = previewDragPendingPointerRef.current;
				previewDragPendingPointerRef.current = null;
				if (pointer) applyWebcamPreviewDragPosition(pointer.clientX, pointer.clientY);
			});
		},
		[applyWebcamPreviewDragPosition, handleWebcamPreviewPointerOver],
	);

	const handleWebcamPreviewPointerUp = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const dragState = webcamPreviewDragStartRef.current;
			if (!dragState || dragState.pointerId !== event.pointerId) return;
			const releasePointer =
				event.type === "pointerup" ? event : lastPreviewPointerRef.current;
			if (previewDragMoveRafRef.current !== null) {
				cancelAnimationFrame(previewDragMoveRafRef.current);
				previewDragMoveRafRef.current = null;
			}
			// Commit the release position even when the final animation frame hasn't run.
			// Cancellation keeps the last actual move; its event coordinates may be synthetic.
			if (dragState.dragging) {
				const pointer =
					event.type === "pointerup" ? event : previewDragPendingPointerRef.current;
				if (pointer) applyWebcamPreviewDragPosition(pointer.clientX, pointer.clientY);
			}
			previewDragPendingPointerRef.current = null;
			webcamPreviewDragStartRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
			restorePreviewCursor();
			lastPreviewPointerRef.current = null;
			setWebcamPreviewOffset({ ...webcamPreviewOffsetRef.current });
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			if (
				releasePointer &&
				!isPointerOverHudSurface(
					getHudInteractiveBounds(document),
					releasePointer.clientX,
					releasePointer.clientY,
				)
			) {
				window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
			}
		},
		[
			applyWebcamPreviewDragPosition,
			restorePreviewCursor,
			setWebcamPreviewOffset,
			webcamPreviewOffsetRef,
		],
	);

	useEffect(() => {
		const releaseOnBlur = () => {
			const drag = webcamPreviewDragStartRef.current;
			if (drag) {
				setWebcamPreviewOffset({ ...webcamPreviewOffsetRef.current });
				window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
			}
			if (previewDragMoveRafRef.current !== null)
				cancelAnimationFrame(previewDragMoveRafRef.current);
			previewDragMoveRafRef.current = null;
			previewDragPendingPointerRef.current = null;
			webcamPreviewDragStartRef.current = null;
			lastPreviewPointerRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
			const target = recordingWebcamPreviewContainerRef.current;
			const pointerId = drag?.pointerId;
			if (pointerId !== undefined && target?.hasPointerCapture(pointerId))
				target.releasePointerCapture(pointerId);
			restorePreviewCursor();
		};
		window.addEventListener("blur", releaseOnBlur);
		return () => {
			window.removeEventListener("blur", releaseOnBlur);
			restorePreviewCursor();
		};
	}, [
		restorePreviewCursor,
		setWebcamPreviewOffset,
		webcamPreviewOffsetRef,
		recordingWebcamPreviewContainerRef,
	]);

	useEffect(() => {
		return () => {
			if (previewDragMoveRafRef.current !== null) {
				cancelAnimationFrame(previewDragMoveRafRef.current);
			}
			previewDragMoveRafRef.current = null;
			previewDragPendingPointerRef.current = null;
		};
	}, []);

	return {
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerOver,
		handleWebcamPreviewPointerLeave,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
	};
}
