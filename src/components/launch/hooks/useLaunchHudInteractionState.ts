import { type MouseEvent, type RefObject, useCallback, useEffect, useRef } from "react";

export function useLaunchHudInteractionState({
	openId,
	isHudDraggingRef,
	isWebcamPreviewDraggingRef,
	webcamPreviewDragStartRef,
	useMousePassthroughTracking,
}: {
	openId: string | null;
	isHudDraggingRef: RefObject<boolean>;
	isWebcamPreviewDraggingRef: RefObject<boolean>;
	webcamPreviewDragStartRef: RefObject<unknown>;
	useMousePassthroughTracking: boolean;
}) {
	const isMouseOverHudRef = useRef(false);
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastInteractiveReassertAtRef = useRef(0);

	const setHudMouseInteractive = useCallback(
		(force = false) => {
			if (!useMousePassthroughTracking) {
				return;
			}

			const now = performance.now();
			if (
				!force &&
				isMouseOverHudRef.current &&
				now - lastInteractiveReassertAtRef.current < 250
			) {
				return;
			}

			isMouseOverHudRef.current = true;
			lastInteractiveReassertAtRef.current = now;
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		},
		[useMousePassthroughTracking],
	);

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
		const handleMouseTracking = (e: globalThis.MouseEvent) => {
			if (!useMousePassthroughTracking) {
				return;
			}

			const target = e.target as HTMLElement | null;
			if (!target) return;
			const isInteractive = !!target.closest(
				".pointer-events-auto, [data-hud-interactive], [data-radix-popper-content-wrapper]",
			);

			if (isInteractive) {
				setHudMouseInteractive();
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

		if (!useMousePassthroughTracking) {
			return;
		}

		window.addEventListener("mouseover", handleMouseTracking);
		window.addEventListener("mousemove", handleMouseTracking);
		return () => {
			window.removeEventListener("mouseover", handleMouseTracking);
			window.removeEventListener("mousemove", handleMouseTracking);
		};
	}, [
		isHudDraggingRef,
		isWebcamPreviewDraggingRef,
		setHudMouseInteractive,
		useMousePassthroughTracking,
		webcamPreviewDragStartRef,
	]);

	const beginInteractiveHudAction = useCallback(() => {
		setHudMouseInteractive(true);
	}, [setHudMouseInteractive]);

	const handleHudMouseEnter = useCallback(() => {
		setHudMouseInteractive(true);
	}, [setHudMouseInteractive]);

	const handleHudMouseLeave = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!useMousePassthroughTracking) {
				return;
			}

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
		},
		[
			isHudDraggingRef,
			isWebcamPreviewDraggingRef,
			useMousePassthroughTracking,
			webcamPreviewDragStartRef,
		],
	);

	return {
		handleHudMouseEnter,
		handleHudMouseLeave,
		beginInteractiveHudAction,
	};
}
