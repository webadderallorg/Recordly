import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { mergeHudInteractiveBounds } from "../hudMousePassthrough";
import { clampHudOffsetToViewport } from "../hudViewportBounds";

export const DEFAULT_WEBCAM_PREVIEW_OFFSET = { x: 0, y: 0 };

/** Keeps the floating camera and its docked HUD inside the viewport. */
export function useWebcamPreviewGeometry({
	hudBarRef,
	showRecordingWebcamPreview,
}: {
	hudBarRef: RefObject<HTMLDivElement | null>;
	showRecordingWebcamPreview: boolean;
}) {
	const [webcamPreviewOffset, setWebcamPreviewOffset] = useState(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const webcamPreviewOffsetRef = useRef(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const recordingWebcamPreviewContainerRef = useRef<HTMLDivElement | null>(null);
	const hudDockWidthRef = useRef(0);
	const getDockBounds = useCallback(
		(reserveHudWidth = false) => {
			const hud = hudBarRef.current?.getBoundingClientRect();
			const inset =
				hud && reserveHudWidth ? Math.max(0, hudDockWidthRef.current - hud.width) / 2 : 0;
			const bounds = mergeHudInteractiveBounds([
				recordingWebcamPreviewContainerRef.current?.getBoundingClientRect() ?? null,
				hud
					? {
							left: hud.left - inset,
							right: hud.right + inset,
							top: hud.top,
							bottom: hud.bottom,
						}
					: null,
			]);
			return bounds
				? new DOMRect(
						bounds.left,
						bounds.top,
						bounds.right - bounds.left,
						bounds.bottom - bounds.top,
					)
				: null;
		},
		[hudBarRef],
	);
	const keepDockInsideViewport = useCallback(() => {
		const container = recordingWebcamPreviewContainerRef.current;
		const bar = hudBarRef.current;
		if (!container || !bar) return;
		const hud = bar.getBoundingClientRect();
		const cameraWidth = container.offsetWidth;
		hudDockWidthRef.current = Math.max(hudDockWidthRef.current, hud.width);
		const stacked = window.innerWidth < hudDockWidthRef.current + 2 * (cameraWidth + 10);
		container.dataset.hudLayout = stacked ? "stacked" : "beside";
		container.style.left = `calc(50% - ${stacked ? cameraWidth / 2 : hudDockWidthRef.current / 2 + cameraWidth + 10}px)`;
		container.style.setProperty(
			"--hud-centering-inset",
			`${(hudDockWidthRef.current - hud.width) / 2}px`,
		);
		container.style.bottom = `${stacked ? 32 + hud.height + 10 : 32}px`;
		const bounds = getDockBounds(true);
		if (!container || !bounds) return;
		const nextOffset = clampHudOffsetToViewport(webcamPreviewOffsetRef.current, bounds, {
			width: window.innerWidth,
			height: window.innerHeight,
		});
		if (
			nextOffset.x === webcamPreviewOffsetRef.current.x &&
			nextOffset.y === webcamPreviewOffsetRef.current.y
		)
			return;
		webcamPreviewOffsetRef.current = nextOffset;
		container.style.transform = `translate(${nextOffset.x}px, ${nextOffset.y}px)`;
		setWebcamPreviewOffset(nextOffset);
	}, [getDockBounds, hudBarRef]);
	useLayoutEffect(() => {
		if (!showRecordingWebcamPreview) return;
		keepDockInsideViewport();
		const observer = new ResizeObserver(keepDockInsideViewport);
		if (hudBarRef.current) observer.observe(hudBarRef.current);
		if (recordingWebcamPreviewContainerRef.current)
			observer.observe(recordingWebcamPreviewContainerRef.current);
		window.addEventListener("resize", keepDockInsideViewport);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", keepDockInsideViewport);
		};
	}, [showRecordingWebcamPreview, hudBarRef, keepDockInsideViewport]);

	return {
		webcamPreviewOffset,
		setWebcamPreviewOffset,
		webcamPreviewOffsetRef,
		recordingWebcamPreviewContainerRef,
		getDockBounds,
		keepDockInsideViewport,
	};
}
