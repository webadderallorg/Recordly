import { useCallback, useEffect, useRef } from "react";
import { useHudContentReporting } from "./useHudContentReporting";

const POPOVER_SELECTOR = "[data-hud-popover]";

type ShapeRect = { x: number; y: number; width: number; height: number };

function toRect(rect: DOMRect): ShapeRect {
	return {
		x: Math.round(rect.left),
		y: Math.round(rect.top),
		width: Math.max(0, Math.round(rect.right - rect.left)),
		height: Math.max(0, Math.round(rect.bottom - rect.top)),
	};
}

function shapeKey(shape: { bar: ShapeRect; popover: ShapeRect | null }): string {
	return `${shape.bar.x},${shape.bar.y},${shape.bar.width},${shape.bar.height}|${
		shape.popover
			? `${shape.popover.x},${shape.popover.y},${shape.popover.width},${shape.popover.height}`
			: "-"
	}`;
}

/**
 * Reports the HUD window's content rects to the main process (X11 shape
 * mode only): the bar column (which also contains the recording webcam
 * preview) plus, when a popover is open, the menu above it. The main process
 * applies them with win.setShape — everything outside the rects is neither
 * painted nor hit-tested, so there are no dead click zones.
 *
 * Reports are deduped, so the IPC only fires on real changes.
 */
export function useHudContentShapeReporting({
	enabled,
	contentRef,
	openId,
}: {
	enabled: boolean;
	contentRef: React.RefObject<HTMLElement | null>;
	openId: string | null;
}) {
	const lastReported = useRef("");
	// Match the shared measurement loop's effect lifecycle: its dedup state
	// resets whenever the loop is torn down and re-armed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: enabled/openId intentionally reset the dedup state.
	useEffect(() => {
		lastReported.current = "";
	}, [enabled, openId]);

	const measure = useCallback(() => {
		const contentEl = contentRef.current;
		if (!contentEl || !window.electronAPI?.hudOverlaySetContentShape) {
			return;
		}
		const popoverEl = openId
			? document.querySelector(POPOVER_SELECTOR)
			: null;
		const shape = {
			bar: toRect(contentEl.getBoundingClientRect()),
			popover: popoverEl ? toRect(popoverEl.getBoundingClientRect()) : null,
		};
		const key = shapeKey(shape);
		if (key === lastReported.current) {
			return;
		}
		lastReported.current = key;
		window.electronAPI.hudOverlaySetContentShape(shape);
	}, [contentRef, openId]);

	useHudContentReporting({ enabled, contentRef, openId, measure });
}
