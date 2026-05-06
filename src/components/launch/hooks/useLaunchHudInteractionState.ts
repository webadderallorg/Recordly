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

	useEffect(() => {
		anyPopoverOpenRef.current = openId !== null;
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
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
	}, [setProjectBrowserOpen]);

	const handleHudMouseLeave = useCallback((event: MouseEvent<HTMLDivElement>) => {
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
			return;
		}

		requestAnimationFrame(() => {
			if (
				!isHudDraggingRef.current &&
				!isWebcamPreviewDraggingRef.current &&
				!webcamPreviewDragStartRef.current &&
				!anyPopoverOpenRef.current &&
				!projectBrowserOpenRef.current
			) {
				window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
			}
		});
	}, [isHudDraggingRef, isWebcamPreviewDraggingRef, webcamPreviewDragStartRef]);

	return {
		handleHudMouseLeave,
		beginInteractiveHudAction,
	};
}
