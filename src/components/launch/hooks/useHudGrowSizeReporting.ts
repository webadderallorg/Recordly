import { useEffect } from "react";
import { computeHudGrowContentSize } from "@/lib/hudGrowSize";

const POPOVER_SELECTOR = "[data-hud-popover]";
const POLL_INTERVAL_MS = 150;

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
 * ResizeObserver catches layout changes; a light poll covers the popover
 * mounting and repositioning. Reports are deduped.
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
	useEffect(() => {
		if (!enabled) {
			return;
		}

		let lastReported = "";
		let frame = 0;

		const report = () => {
			const contentEl = contentRef.current;
			if (!contentEl || !window.electronAPI?.hudOverlaySetContentSize) {
				return;
			}
			const popoverEl = openId ? document.querySelector(POPOVER_SELECTOR) : null;
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
			if (key === lastReported) {
				return;
			}
			lastReported = key;
			window.electronAPI.hudOverlaySetContentSize(size);
		};

		const scheduleReport = () => {
			if (frame) {
				return;
			}
			frame = requestAnimationFrame(() => {
				frame = 0;
				report();
			});
		};

		const observer = new ResizeObserver(scheduleReport);
		if (contentRef.current) {
			observer.observe(contentRef.current);
		}
		const popoverObserver = new ResizeObserver(scheduleReport);

		const attachPopoverObserver = () => {
			const popoverEl = openId ? document.querySelector(POPOVER_SELECTOR) : null;
			if (popoverEl) {
				popoverObserver.observe(popoverEl);
				return true;
			}
			return false;
		};

		scheduleReport();
		let attached = attachPopoverObserver();
		const poll = openId
			? setInterval(() => {
					report();
					if (!attached) {
						attached = attachPopoverObserver();
					}
				}, POLL_INTERVAL_MS)
			: null;
		const idlePoll = setInterval(report, 1000);

		return () => {
			if (frame) {
				cancelAnimationFrame(frame);
			}
			if (poll) {
				clearInterval(poll);
			}
			clearInterval(idlePoll);
			observer.disconnect();
			popoverObserver.disconnect();
		};
	}, [contentRef, enabled, openId]);
}
