import { type ComponentPropsWithoutRef, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import "./sliding-highlight.css";

function offsetWithin(item: HTMLElement, group: HTMLElement) {
	let x = 0;
	let y = 0;
	for (let node: HTMLElement | null = item; node && node !== group; ) {
		x += node.offsetLeft;
		y += node.offsetTop;
		node = node.offsetParent as HTMLElement | null;
	}
	return { x, y };
}

const selected =
	'[data-selected="true"], [aria-selected="true"], [aria-current="page"], [aria-pressed="true"]';
const MAX_HIGHLIGHT_GAP = 32;

type Indicator = {
	element: HTMLSpanElement;
	previous?: HTMLElement;
	destination?: string;
	animation?: Animation;
};

function areNeighbors(previous: HTMLElement, next: HTMLElement, group: HTMLElement) {
	const from = offsetWithin(previous, group);
	const to = offsetWithin(next, group);
	const gapX = Math.max(
		to.x - (from.x + previous.offsetWidth),
		from.x - (to.x + next.offsetWidth),
	);
	const gapY = Math.max(
		to.y - (from.y + previous.offsetHeight),
		from.y - (to.y + next.offsetHeight),
	);
	return (gapX <= MAX_HIGHLIGHT_GAP && gapY < 0) || (gapY <= MAX_HIGHLIGHT_GAP && gapX < 0);
}

export function SlidingHighlight({
	items = ":scope > button",
	selection = false,
	previewSelection = false,
}: {
	items?: string;
	selection?: boolean;
	previewSelection?: boolean;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const previewRef = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		const highlight = ref.current;
		const group = highlight?.parentElement;
		if (!highlight || !group) return;

		const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
		const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
		const tokens = getComputedStyle(highlight);
		const enterEasing = tokens.getPropertyValue("--ease-out-quint").trim() || "ease-out";
		const slideEasing = tokens.getPropertyValue("--ease-out-cubic").trim() || "ease-out";
		const main: Indicator = { element: highlight };
		const preview: Indicator | undefined =
			previewSelection && previewRef.current ? { element: previewRef.current } : undefined;

		const place = (
			indicator: Indicator,
			target: HTMLElement | undefined,
			controls: HTMLElement[],
			animate = true,
		) => {
			const { element, previous } = indicator;
			const motion = animate && !reducedMotion.matches;
			if (!target) {
				if (element.hasAttribute("data-visible")) {
					const { opacity, transform } = getComputedStyle(element);
					indicator.animation?.cancel();
					element.removeAttribute("data-visible");
					indicator.animation =
						motion && Number(opacity) > 0
							? element.animate(
									[
										{ opacity, transform },
										{ opacity: 0, transform },
									],
									{
										id: "highlight-exit",
										duration: 100,
										easing: enterEasing,
									},
								)
							: undefined;
				}
				return;
			}

			const { x, y } = offsetWithin(target, group);
			const width = target.offsetWidth;
			const height = target.offsetHeight;
			if (!width || !height) return;
			const transform = `translate(${x}px, ${y}px)`;
			const nextDestination = `${transform} ${width} ${height}`;
			const wasVisible = element.hasAttribute("data-visible");
			if (!wasVisible || target !== previous || nextDestination !== indicator.destination) {
				const style = getComputedStyle(element);
				const opacity = Number(style.opacity);
				const slide =
					motion &&
					previous &&
					previous !== target &&
					controls.includes(previous) &&
					areNeighbors(previous, target, group) &&
					(wasVisible || opacity > 0);
				let from: Keyframe | undefined;
				if (slide) {
					// Sample the on-screen transform so a quick reversal starts from the current shape.
					const { a, d, e, f } = new DOMMatrixReadOnly(style.transform);
					from = {
						opacity,
						transform: `translate(${e}px, ${f}px) scale(${(element.offsetWidth * a) / width}, ${(element.offsetHeight * d) / height})`,
					};
				} else if (motion && (!wasVisible || previous !== target)) {
					const scale = 0.94;
					const inset = (1 - scale) / 2;
					from = {
						opacity: 0,
						transform: `translate(${x + width * inset}px, ${y + height * inset}px) scale(${scale})`,
					};
				}
				indicator.animation?.cancel();
				element.style.width = `${width}px`;
				element.style.height = `${height}px`;
				element.style.transform = transform;
				element.style.borderRadius = getComputedStyle(target).borderRadius;
				element.setAttribute("data-visible", "");
				indicator.animation = from
					? element.animate([from, { opacity: 1, transform }], {
							id: slide ? "highlight-slide" : "highlight-enter",
							duration: slide ? 180 : 150,
							easing: slide ? slideEasing : enterEasing,
						})
					: undefined;
				indicator.previous = target;
				indicator.destination = nextDestination;
			}
		};

		const refresh = (animate: boolean) => {
			const controls = Array.from(group.querySelectorAll<HTMLElement>(items));
			const current = selection
				? controls.find((control) => control.matches(selected))
				: undefined;
			const available = controls.filter(
				(control) =>
					!control.matches(':disabled, [aria-disabled="true"], [data-disabled="true"]'),
			);
			const active =
				available.find((control) => control.matches('[data-focus-visible="true"]')) ??
				(finePointer.matches
					? available.find((control) => control.matches('[data-hovered="true"]'))
					: undefined) ??
				available.find((control) => control.matches('[aria-expanded="true"]'));
			place(main, selection ? current : active, controls, animate);
			if (preview) place(preview, active === current ? undefined : active, controls, animate);
		};
		const update = () => refresh(true);
		const states = new MutationObserver(update);
		states.observe(group, {
			attributes: true,
			attributeFilter: [
				"data-focus-visible",
				"data-hovered",
				"data-disabled",
				"disabled",
				"aria-disabled",
				"aria-expanded",
				"data-selected",
				"aria-selected",
				"aria-current",
				"aria-pressed",
			],
			childList: true,
			subtree: true,
		});
		const size = new ResizeObserver(update);
		size.observe(group);
		const handleMotionChange = () => {
			if (reducedMotion.matches) {
				main.animation?.cancel();
				preview?.animation?.cancel();
			}
		};
		reducedMotion.addEventListener("change", handleMotionChange);
		finePointer.addEventListener("change", update);
		group.setAttribute("data-sliding-highlight-ready", "");
		refresh(false);
		return () => {
			states.disconnect();
			size.disconnect();
			main.animation?.cancel();
			preview?.animation?.cancel();
			reducedMotion.removeEventListener("change", handleMotionChange);
			finePointer.removeEventListener("change", update);
			group.removeAttribute("data-sliding-highlight-ready");
			highlight.removeAttribute("data-visible");
			preview?.element.removeAttribute("data-visible");
		};
	}, [items, selection, previewSelection]);

	return (
		<>
			{selection && previewSelection && (
				<span
					ref={previewRef}
					aria-hidden="true"
					className="sliding-highlight"
					data-preview
				/>
			)}
			<span
				ref={ref}
				aria-hidden="true"
				className="sliding-highlight"
				data-selection={selection || undefined}
			/>
		</>
	);
}

export function SlidingHighlightGroup({
	children,
	className,
	items,
	selection,
	previewSelection,
	...props
}: ComponentPropsWithoutRef<"div"> & {
	items?: string;
	selection?: boolean;
	previewSelection?: boolean;
}) {
	return (
		<div {...props} className={cn("sliding-highlight-group", className)}>
			<SlidingHighlight
				items={items}
				selection={selection}
				previewSelection={previewSelection}
			/>
			{children}
		</div>
	);
}
