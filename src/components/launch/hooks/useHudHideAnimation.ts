import { type RefObject, useCallback, useEffect, useRef } from "react";

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const DURATION_MS = 200;
const VISIBLE = { opacity: 1, scale: "1", filter: "blur(0px)" };
const HIDDEN = { opacity: 0, scale: "0.97", filter: "blur(6px)" };

function keyframes(reduce: boolean, from: Keyframe, to: Keyframe): Keyframe[] {
	return reduce ? [{ opacity: from.opacity }, { opacity: to.opacity }] : [from, to];
}

function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Blur-fade the HUD bar out before minimizing it, and blur-fade it back in
 * when the window is restored.
 */
export function useHudHideAnimation(barRef: RefObject<HTMLDivElement | null>) {
	const exit = useRef<Animation | null>(null);

	useEffect(() => {
		const enter = () => {
			const hidden = exit.current;
			const node = barRef.current;
			// Ignore focus while the exit is still playing; only undo a finished hide.
			if (!hidden || hidden.playState !== "finished" || !node) return;
			exit.current = null;
			// The individual `scale` property composes with the bar's drag offset
			// instead of overriding its transform.
			const animation = node.animate(keyframes(prefersReducedMotion(), HIDDEN, VISIBLE), {
				duration: DURATION_MS,
				easing: EASE_OUT,
			});
			hidden.cancel();
			void animation.finished.catch(() => undefined);
		};
		const unsubscribe = window.electronAPI?.onHudOverlayRestored?.(enter);
		// Fallback in case the window comes back without a restore event.
		window.addEventListener("focus", enter);
		return () => {
			unsubscribe?.();
			window.removeEventListener("focus", enter);
			exit.current?.cancel();
		};
	}, [barRef]);

	return useCallback(() => {
		const hide = () => window.electronAPI?.hudOverlayHide?.();
		const node = barRef.current;
		if (exit.current) return;
		if (!node) {
			hide();
			return;
		}
		const animation = node.animate(keyframes(prefersReducedMotion(), VISIBLE, HIDDEN), {
			duration: DURATION_MS,
			easing: EASE_OUT,
			fill: "forwards",
		});
		exit.current = animation;
		animation.finished.then(hide, () => {
			if (exit.current === animation) exit.current = null;
		});
	}, [barRef]);
}
