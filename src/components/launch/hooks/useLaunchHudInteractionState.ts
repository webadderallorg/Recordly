import { useCallback, useEffect, useRef, type MouseEvent, type RefObject } from "react";

export function useLaunchHudInteractionState({
	openId,
	isHudDraggingRef,
	isWebcamPreviewDraggingRef,
	webcamPreviewDragStartRef,
}: {
	openId: string | null;
	isHudDraggingRef: RefObject<boolean>;
	isWebcamPreviewDraggingRef: RefObject<boolean>;
	webcamPreviewDragStartRef: RefObject<unknown>;
}) {
	const anyPopoverOpenRef = useRef(false);
	const isMouseOverHudRef = useRef(false);

	useEffect(() => {
		anyPopoverOpenRef.current = openId !== null;
		if (openId !== null) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		} else {
			// Proactively check if we should ignore mouse when popover closes
			setTimeout(() => {
				if (!isMouseOverHudRef.current && !anyPopoverOpenRef.current) {
					window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
				}
			}, 150);
		}
	}, [openId]);

	const beginInteractiveHudAction = useCallback(() => {
		isMouseOverHudRef.current = true;
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
	}, []);

	const handleHudMouseEnter = useCallback(() => {
		isMouseOverHudRef.current = true;
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
	}, []);

	const timeoutRef = useRef<NodeJS.Timeout | null>(null);

	const handleHudMouseLeave = useCallback((event: MouseEvent<HTMLDivElement>) => {
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
			return;
		}

		isMouseOverHudRef.current = false;

		if (timeoutRef.current) clearTimeout(timeoutRef.current);

		timeoutRef.current = setTimeout(() => {
			if (
				!isHudDraggingRef.current &&
				!isWebcamPreviewDraggingRef.current &&
				!webcamPreviewDragStartRef.current &&
				!isMouseOverHudRef.current &&
				!anyPopoverOpenRef.current
			) {
				// If a popover is open, we can still ignore mouse if the mouse is truly gone,
				// but we give a bit more breathing room (the 300ms timeout).
				window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
			}
		}, 300);
	}, [isHudDraggingRef, isWebcamPreviewDraggingRef, webcamPreviewDragStartRef]);

	return {
		handleHudMouseEnter,
		handleHudMouseLeave,
		beginInteractiveHudAction,
	};
}
