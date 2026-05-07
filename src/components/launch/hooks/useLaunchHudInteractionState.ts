import { useCallback, useEffect, useRef, type MouseEvent, type RefObject } from "react";

export function useLaunchHudInteractionState({
	openId,
	projectBrowserOpen,
	setProjectBrowserOpen,
	isHudDraggingRef,
	isWebcamPreviewDraggingRef,
	webcamPreviewDragStartRef,
}: {
	openId: string | null;
	projectBrowserOpen: boolean;
	setProjectBrowserOpen: (open: boolean) => void;
	isHudDraggingRef: RefObject<boolean>;
	isWebcamPreviewDraggingRef: RefObject<boolean>;
	webcamPreviewDragStartRef: RefObject<unknown>;
}) {
	const anyPopoverOpenRef = useRef(false);
	const projectBrowserOpenRef = useRef(false);
	const isMouseOverHudRef = useRef(false);

	useEffect(() => {
		anyPopoverOpenRef.current = openId !== null;
		if (openId === null) {
			// Proactively check if we should ignore mouse when popover closes
			setTimeout(() => {
				if (!isMouseOverHudRef.current && !anyPopoverOpenRef.current) {
					window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
				}
			}, 150);
		}
	}, [openId]);

	useEffect(() => {
		if (!openId) return;
		setProjectBrowserOpen(false);
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
	}, [openId, setProjectBrowserOpen]);

	useEffect(() => {
		projectBrowserOpenRef.current = projectBrowserOpen;
	}, [projectBrowserOpen]);

	const beginInteractiveHudAction = useCallback(() => {
		setProjectBrowserOpen(false);
		isMouseOverHudRef.current = true;
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
	}, [setProjectBrowserOpen]);

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
				!projectBrowserOpenRef.current &&
				!isMouseOverHudRef.current
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
