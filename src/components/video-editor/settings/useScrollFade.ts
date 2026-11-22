import { type RefObject, useLayoutEffect, useState } from "react";

/** CSS drives the fade while scrolling; measurements only gate containers with overflow. */
export function useScrollFade(ref: RefObject<HTMLElement | null>, contentIdentity?: unknown) {
	const [overflow, setOverflow] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: rebind observers when a keyed content/scroller node is replaced.
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) {
			setOverflow(false);
			return;
		}
		let active = true;
		const measure = () => {
			if (active) setOverflow(element.scrollHeight > element.clientHeight + 1);
		};
		const resize = new ResizeObserver(measure);
		const observeContents = () => {
			resize.disconnect();
			resize.observe(element);
			for (const child of element.children) resize.observe(child);
			measure();
		};
		const children = new MutationObserver(observeContents);
		children.observe(element, { childList: true });
		observeContents();
		return () => {
			active = false;
			resize.disconnect();
			children.disconnect();
		};
	}, [ref, contentIdentity]);
	return overflow ? "auto" : undefined;
}
