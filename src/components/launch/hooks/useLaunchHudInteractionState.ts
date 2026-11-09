import { type MouseEvent, type RefObject, useCallback, useEffect, useRef } from "react";
import { getHudInteractiveBounds, isPointerOverHudSurface } from "../hudMousePassthrough";

export function useLaunchHudInteractionState({
	openId,
	platform,
	recordingState,
	isHudDraggingRef,
	isWebcamPreviewDraggingRef,
	webcamPreviewDragStartRef,
}: {
	openId: string | null;
	platform?: string | null;
	recordingState?: string;
	isHudDraggingRef: RefObject<boolean>;
	isWebcamPreviewDraggingRef: RefObject<boolean>;
	webcamPreviewDragStartRef: RefObject<unknown>;
}) {
	const isMouseOverHudRef = useRef(false);
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastIgnoringRef = useRef<{ ignore: boolean; recordingState?: string } | null>(null);
	const setIgnoring = useCallback(
		(ignore: boolean, force = false) => {
			const dragging =
				isHudDraggingRef.current ||
				isWebcamPreviewDraggingRef.current ||
				webcamPreviewDragStartRef.current;
			// Windows needs repeated native reassertions; preserve them while platform
			// discovery or a drag is in progress as well.
			if (
				!force &&
				platform &&
				platform !== "win32" &&
				!dragging &&
				lastIgnoringRef.current?.ignore === ignore &&
				lastIgnoringRef.current.recordingState === recordingState
			)
				return;
			// A missing/throwing bridge cannot establish the last requested state.
			lastIgnoringRef.current = null;
			if (!window.electronAPI?.hudOverlaySetIgnoreMouse) return;
			window.electronAPI.hudOverlaySetIgnoreMouse(ignore);
			lastIgnoringRef.current = { ignore, recordingState };
		},
		[
			platform,
			recordingState,
			isHudDraggingRef,
			isWebcamPreviewDraggingRef,
			webcamPreviewDragStartRef,
		],
	);

	useEffect(() => {
		// Drag hooks can restore native passthrough directly. Observe every release
		// in capture phase, even when pointer capture or a child stops bubbling.
		const invalidate = () => {
			lastIgnoringRef.current = null;
		};
		const releases = ["pointerup", "pointercancel", "lostpointercapture", "blur"] as const;
		for (const type of releases) window.addEventListener(type, invalidate, true);
		return () => {
			for (const type of releases) window.removeEventListener(type, invalidate, true);
		};
	}, []);

	useEffect(() => {
		if (openId !== null) {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			setIgnoring(false, true);
		} else {
			// Proactively check if we should ignore mouse when popover closes
			timeoutRef.current = setTimeout(() => {
				if (
					!isMouseOverHudRef.current &&
					!isHudDraggingRef.current &&
					!isWebcamPreviewDraggingRef.current &&
					!webcamPreviewDragStartRef.current
				) {
					setIgnoring(true);
				}
			}, 150);
		}
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
		};
	}, [
		openId,
		setIgnoring,
		isHudDraggingRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
	]);

	useEffect(() => {
		const handleMouseOver = (e: globalThis.MouseEvent) => {
			// Electron forwards mousemove while clicks pass through. Target ancestry
			// is unreliable there, especially inside transparent full-width wrappers.
			const isInteractive = isPointerOverHudSurface(
				getHudInteractiveBounds(document),
				e.clientX,
				e.clientY,
			);

			if (isInteractive) {
				isMouseOverHudRef.current = true;
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				setIgnoring(false);
			} else if (openId === null) {
				isMouseOverHudRef.current = false;
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				timeoutRef.current = setTimeout(() => {
					if (
						openId === null &&
						!isHudDraggingRef.current &&
						!isWebcamPreviewDraggingRef.current &&
						!webcamPreviewDragStartRef.current &&
						!isMouseOverHudRef.current
					) {
						setIgnoring(true);
					}
				}, 0);
			}
		};

		window.addEventListener("mousemove", handleMouseOver);
		window.addEventListener("mouseover", handleMouseOver);
		return () => {
			window.removeEventListener("mousemove", handleMouseOver);
			window.removeEventListener("mouseover", handleMouseOver);
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
		};
	}, [
		openId,
		isHudDraggingRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		setIgnoring,
	]);

	const beginInteractiveHudAction = useCallback(() => {
		isMouseOverHudRef.current = true;
		setIgnoring(false, true);
	}, [setIgnoring]);

	const handleHudMouseEnter = useCallback(() => {
		isMouseOverHudRef.current = true;
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		setIgnoring(false, true);
	}, [setIgnoring]);

	const handleHudMouseLeave = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			const nextTarget = event.relatedTarget;
			if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
				return;
			}

			isMouseOverHudRef.current = false;

			if (timeoutRef.current) clearTimeout(timeoutRef.current);

			timeoutRef.current = setTimeout(() => {
				if (
					openId === null &&
					!isHudDraggingRef.current &&
					!isWebcamPreviewDraggingRef.current &&
					!webcamPreviewDragStartRef.current &&
					!isMouseOverHudRef.current
				) {
					setIgnoring(true);
				}
			}, 0);
		},
		[
			openId,
			isHudDraggingRef,
			isWebcamPreviewDraggingRef,
			webcamPreviewDragStartRef,
			setIgnoring,
		],
	);

	return {
		handleHudMouseEnter,
		handleHudMouseLeave,
		beginInteractiveHudAction,
	};
}
