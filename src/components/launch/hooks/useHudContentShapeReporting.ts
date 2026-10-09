import { useEffect } from "react";

const POPOVER_SELECTOR = "[data-hud-popover]";
const POLL_INTERVAL_MS = 150;

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
 * ResizeObserver catches layout changes (recording bar, webcam preview,
 * device lists); a light poll covers the popover mounting and
 * repositioning. Reports are deduped, so the IPC only fires on real changes.
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
	useEffect(() => {
		if (!enabled) {
			return;
		}

		let lastReported = "";
		let frame = 0;

		const report = () => {
			const contentEl = contentRef.current;
			if (!contentEl || !window.electronAPI?.hudOverlaySetContentShape) {
				return;
			}
			const popoverEl = openId ? document.querySelector(POPOVER_SELECTOR) : null;
			const shape = {
				bar: toRect(contentEl.getBoundingClientRect()),
				popover: popoverEl ? toRect(popoverEl.getBoundingClientRect()) : null,
			};
			const key = shapeKey(shape);
			if (key === lastReported) {
				return;
			}
			lastReported = key;
			window.electronAPI.hudOverlaySetContentShape(shape);
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
		// The popover mounts a tick after the open state flips; a short
		// poll covers that window (and repositions as menus resize).
		const poll = openId
			? setInterval(() => {
					report();
					if (!attached) {
						attached = attachPopoverObserver();
					}
				}, POLL_INTERVAL_MS)
			: null;

		// Bar width can change without the content element resizing (marquee
		// text swap); a light poll also covers that while the mode is active.
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
