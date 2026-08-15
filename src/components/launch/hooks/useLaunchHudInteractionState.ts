import { type MouseEvent, type RefObject, useCallback, useEffect, useRef } from "react";
import { shouldRestoreHudMousePassthrough } from "../hudMousePassthrough";

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
	const restoreMousePassthroughIfIdle = useCallback(() => {
		if (
			shouldRestoreHudMousePassthrough({
				isMouseOverHud: isMouseOverHudRef.current,
				popoverOpen: openId !== null,
				isHudDragging: Boolean(isHudDraggingRef.current),
				isWebcamPreviewDragging: Boolean(isWebcamPreviewDraggingRef.current),
				webcamPreviewPointerDown: Boolean(webcamPreviewDragStartRef.current),
			})
		) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	}, [openId, isHudDraggingRef, isWebcamPreviewDraggingRef, webcamPreviewDragStartRef]);

	useEffect(() => {
		if (openId !== null) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		} else {
			restoreMousePassthroughIfIdle();
		}
	}, [openId, restoreMousePassthroughIfIdle]);

	useEffect(() => {
		const handleMouseOver = (e: globalThis.MouseEvent) => {
			const target = e.target as HTMLElement | null;
			if (!target) return;
			const isInteractive = !!target.closest(
				".pointer-events-auto, [data-hud-interactive], [data-radix-popper-content-wrapper]",
			);

			if (isInteractive) {
				isMouseOverHudRef.current = true;
				window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			} else if (openId === null) {
				isMouseOverHudRef.current = false;
				restoreMousePassthroughIfIdle();
			}
		};

		window.addEventListener("mouseover", handleMouseOver);
		return () => window.removeEventListener("mouseover", handleMouseOver);
	}, [openId, restoreMousePassthroughIfIdle]);

	const beginInteractiveHudAction = useCallback(() => {
		isMouseOverHudRef.current = true;
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
	}, []);

	const handleHudMouseEnter = useCallback(() => {
		isMouseOverHudRef.current = true;
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
	}, []);

	const handleHudMouseLeave = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			const nextTarget = event.relatedTarget;
			if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
				return;
			}

			isMouseOverHudRef.current = false;
			restoreMousePassthroughIfIdle();
		},
		[restoreMousePassthroughIfIdle],
	);

	return {
		handleHudMouseEnter,
		handleHudMouseLeave,
		beginInteractiveHudAction,
	};
}
