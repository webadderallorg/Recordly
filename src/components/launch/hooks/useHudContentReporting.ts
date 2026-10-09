import { useEffect, useRef } from "react";

const POPOVER_SELECTOR = "[data-hud-popover]";
const POLL_INTERVAL_MS = 150;

/**
 * Shared measurement loop behind the per-mode HUD reporting hooks: watches
 * the HUD content element and the open popover (ResizeObservers plus a
 * short poll that covers the popover mounting a tick after the open
 * state flips, and a 1s idle poll for size changes without element resizes)
 * and hands every tick to `measure`, which computes, dedupes, and reports.
 */
export function useHudContentReporting({
	enabled,
	contentRef,
	openId,
	measure,
}: {
	enabled: boolean;
	contentRef: React.RefObject<HTMLElement | null>;
	openId: string | null;
	measure: () => void;
}) {
	const measureRef = useRef(measure);
	useEffect(() => {
		measureRef.current = measure;
	});

	useEffect(() => {
		if (!enabled) {
			return;
		}

		let frame = 0;

		const scheduleMeasure = () => {
			if (frame) {
				return;
			}
			frame = requestAnimationFrame(() => {
				frame = 0;
				measureRef.current();
			});
		};

		const observer = new ResizeObserver(scheduleMeasure);
		if (contentRef.current) {
			observer.observe(contentRef.current);
		}
		const popoverObserver = new ResizeObserver(scheduleMeasure);

		const attachPopoverObserver = () => {
			const popoverEl = openId
				? document.querySelector(POPOVER_SELECTOR)
				: null;
			if (popoverEl) {
				popoverObserver.observe(popoverEl);
				return true;
			}
			return false;
		};

		scheduleMeasure();
		let attached = attachPopoverObserver();
		// The Radix wrapper mounts a tick after the open state flips; a short
		// poll covers that window (and repositions as menus resize).
		const poll = openId
			? setInterval(() => {
					measureRef.current();
					if (!attached) {
						attached = attachPopoverObserver();
					}
				}, POLL_INTERVAL_MS)
			: null;

		const idlePoll = setInterval(() => measureRef.current(), 1000);

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
