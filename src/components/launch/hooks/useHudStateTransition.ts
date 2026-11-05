import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

export function useHudStateTransition(
	barRef: RefObject<HTMLDivElement | null>,
	state: string,
	docked: boolean,
) {
	const previous = useRef<{
		node: HTMLDivElement;
		width: number;
		radius: string;
		state: string;
		docked: boolean;
	} | null>(null);
	const animations = useRef<Animation[]>([]);
	const finishTransition = useCallback(() => {
		for (const animation of animations.current) animation.finish();
		animations.current = [];
	}, []);

	useLayoutEffect(() => {
		const node = barRef.current;
		if (!node) return;
		const origin = previous.current;
		const interrupted = animations.current.some(
			(animation) => animation.playState === "running",
		);
		const fromWidth = interrupted ? node.getBoundingClientRect().width : origin?.width;
		const fromRadius = interrupted ? getComputedStyle(node).borderRadius : origin?.radius;
		for (const animation of animations.current) animation.cancel();
		animations.current = [];
		const width = node.getBoundingClientRect().width;
		const radius = getComputedStyle(node).borderRadius;
		previous.current = { node, width, radius, state, docked };
		if (
			!origin ||
			origin.node !== node ||
			origin.state === state ||
			origin.docked !== docked ||
			origin.width === width ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return;
		animations.current.push(
			node.animate(
				[
					{ width: `${fromWidth}px`, borderRadius: fromRadius },
					{ width: `${width}px`, borderRadius: radius },
				],
				{ duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
			),
		);
		const content = node.firstElementChild;
		if (content)
			animations.current.push(
				content.animate(
					[
						{ opacity: 0.35, transform: "translateY(3px)" },
						{ opacity: 1, transform: "translateY(0)" },
					],
					{ duration: 180, easing: "ease-out" },
				),
			);
	}, [barRef, state, docked]);

	useLayoutEffect(
		() => () => {
			for (const animation of animations.current) animation.cancel();
		},
		[],
	);

	return finishTransition;
}
