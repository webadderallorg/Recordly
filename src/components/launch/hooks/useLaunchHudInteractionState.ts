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
	const ignoreMouseStateRef = useRef<boolean | null>(null);
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);

	const setIgnoreMouse = useCallback((next: boolean) => {
		if (ignoreMouseStateRef.current === next) return;
		ignoreMouseStateRef.current = next;
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(next);
	}, []);

	useEffect(() => {
		if (openId !== null) {
			setIgnoreMouse(false);
		} else {
			// Proactively check if we should ignore mouse when popover closes
			setTimeout(() => {
				if (!isMouseOverHudRef.current) {
					setIgnoreMouse(true);
				}
			}, 150);
		}
	}, [openId, setIgnoreMouse]);

	useEffect(() => {
		const handleMouseMove = (e: globalThis.MouseEvent) => {
			const target = e.target as HTMLElement | null;
			if (!target) return;
			const isInteractive = !!target.closest(
				".pointer-events-auto, [data-hud-interactive], [data-radix-popper-content-wrapper]"
			);

			if (isInteractive) {
				isMouseOverHudRef.current = true;
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				setIgnoreMouse(false);
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
						setIgnoreMouse(true);
					}
				}, 300);
			}
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseover", handleMouseMove);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseover", handleMouseMove);
		};
	}, [isHudDraggingRef, isWebcamPreviewDraggingRef, webcamPreviewDragStartRef, setIgnoreMouse]);

	const beginInteractiveHudAction = useCallback(() => {
		isMouseOverHudRef.current = true;
		setIgnoreMouse(false);
	}, [setIgnoreMouse]);

	const handleHudMouseEnter = useCallback(() => {
		isMouseOverHudRef.current = true;
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		setIgnoreMouse(false);
	}, [setIgnoreMouse]);

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
			setIgnoreMouse(true);
		}
	}, 300);
	}, [isHudDraggingRef, isWebcamPreviewDraggingRef, webcamPreviewDragStartRef, setIgnoreMouse]);

	return {
		handleHudMouseEnter,
		handleHudMouseLeave,
		beginInteractiveHudAction,
	};
}
