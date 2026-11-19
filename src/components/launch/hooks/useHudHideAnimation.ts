import { type RefObject, useCallback, useEffect, useRef } from "react";

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
// The window is minimized by then, so restoring the bar is never visible mid-hide.
const RESET_AFTER_HIDE_MS = 500;

/** Fade the HUD bar out before minimizing it, then restore the bar offscreen. */
export function useHudHideAnimation(barRef: RefObject<HTMLDivElement | null>) {
	const exit = useRef<Animation | null>(null);
	const resetTimer = useRef<number | undefined>(undefined);

	useEffect(
		() => () => {
			window.clearTimeout(resetTimer.current);
			exit.current?.cancel();
		},
		[],
	);

	return useCallback(() => {
		const hide = () => window.electronAPI?.hudOverlayHide?.();
		const node = barRef.current;
		if (exit.current) return;
		if (!node) {
			hide();
			return;
		}
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		// The individual `scale` property composes with the bar's drag offset
		// instead of overriding its transform.
		const animation = node.animate(
			reduce
				? [{ opacity: 1 }, { opacity: 0 }]
				: [
						{ opacity: 1, scale: "1", filter: "blur(0px)" },
						{ opacity: 0, scale: "0.97", filter: "blur(6px)" },
					],
			{ duration: 200, easing: EASE_OUT, fill: "forwards" },
		);
		exit.current = animation;
		animation.finished.then(
			() => {
				hide();
				resetTimer.current = window.setTimeout(() => {
					animation.cancel();
					exit.current = null;
				}, RESET_AFTER_HIDE_MS);
			},
			() => {
				exit.current = null;
			},
		);
	}, [barRef]);
}
