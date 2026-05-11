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
	const isMouseOverHudRef = useRef(false);
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		if (openId !== null) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		} else {
			// Proactively check if we should ignore mouse when popover closes
			setTimeout(() => {
				if (!isMouseOverHudRef.current) {
					window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
				}
			}, 150);
		}
	}, [openId]);

	useEffect(() => {
		const handleMouseOver = (e: globalThis.MouseEvent) => {
			const target = e.target as HTMLElement | null;
			if (!target) return;
			const isInteractive = !!target.closest(
				".pointer-events-auto, [data-hud-interactive], [data-radix-popper-content-wrapper]"
			);

			if (isInteractive) {
				isMouseOverHudRef.current = true;
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			} else {
				isMouseOverHudRef.current = false;
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				timeoutRef.current = setTimeout(() => {
					if (
						!isHudDraggingRef.current &&
						!isWebcamPreviewDraggingRef.current &&
						!webcamPreviewDragStartRef.current &&
						!isMouseOverHudRef.current
					) {
						window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
					}
				}, 300);
			}
		};

		window.addEventListener("mouseover", handleMouseOver);
		return () => window.removeEventListener("mouseover", handleMouseOver);
	}, [isHudDraggingRef, isWebcamPreviewDraggingRef, webcamPreviewDragStartRef]);

	const beginInteractiveHudAction = useCallback(() => {
		isMouseOverHudRef.current = true;
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
	}, []);

	const handleHudMouseEnter = useCallback(() => {
		isMouseOverHudRef.current = true;
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
	}, []);

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
				!isMouseOverHudRef.current
			) {
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
