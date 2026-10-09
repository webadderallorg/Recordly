import { useCallback, useEffect, useRef } from "react";
import { computeHudGrowContentSize } from "@/lib/hudGrowSize";
import { useHudContentReporting } from "./useHudContentReporting";

const POPOVER_SELECTOR = "[data-hud-popover]";

function toDomRect(rect: DOMRect) {
	return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
}

/**
 * Reports the HUD window's content size in grow mode (native Wayland): the
 * bar column plus, when a popover is open, the menu below it. The main
 * process resizes the window — the compositor pins the top-left corner, so
 * the bar (anchored to the window's top) never moves and the menu appears in
 * the space that opens up underneath it.
 *
 * Reports are deduped.
 */
export function useHudGrowSizeReporting({
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
		if (!contentEl || !window.electronAPI?.hudOverlaySetContentSize) {
			return;
		}
		const popoverEl = openId
			? document.querySelector(POPOVER_SELECTOR)
			: null;
		if (openId && !popoverEl) {
			// A menu was just requested; the main process pre-grew the window
			// for it. Reporting the bar-only size here would shrink that
			// again before the menu mounts — wait for the poll to find it.
			return;
		}
		const size = computeHudGrowContentSize(
			toDomRect(contentEl.getBoundingClientRect()),
			popoverEl ? toDomRect(popoverEl.getBoundingClientRect()) : null,
		);
		if (!size) {
			return;
		}
		const key = `${size.width}x${size.height}`;
		if (key === lastReported.current) {
			return;
		}
		lastReported.current = key;
		window.electronAPI.hudOverlaySetContentSize(size);
	}, [contentRef, openId]);

	useHudContentReporting({ enabled, contentRef, openId, measure });
}
