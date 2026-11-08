import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Confetti from "react-confetti";

const colors = ["#0088ff", "#67d5ff", "#ffd166", "#ff8fab", "#a78bfa", "#64d6a2"];

export function PermissionsConfetti({ ready }: { ready: boolean }) {
	const reduceMotion = useReducedMotion();
	const celebrated = useRef(false);
	const container = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(false);
	const [size, setSize] = useState({ width: 0, height: 0 });

	useEffect(() => {
		if (!ready) {
			celebrated.current = false;
			setActive(false);
			return;
		}
		if (reduceMotion || celebrated.current) return;
		celebrated.current = true;
		setActive(true);
	}, [ready, reduceMotion]);

	useEffect(() => {
		if (!active || reduceMotion || !container.current) return;
		const element = container.current;
		const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		// Bound the celebration even when the window is hidden or rendering is throttled.
		const timeout = window.setTimeout(() => setActive(false), 4500);
		return () => {
			observer.disconnect();
			window.clearTimeout(timeout);
		};
	}, [active, reduceMotion]);

	if (!active || reduceMotion) return null;
	return createPortal(
		<div
			ref={container}
			data-permissions-confetti
			aria-hidden="true"
			className="pointer-events-none fixed inset-0 overflow-hidden"
			style={{ zIndex: "calc(var(--z-index-overlay, 100000) + 1)" }}
		>
			{size.width > 0 && size.height > 0 && (
				<Confetti
					width={size.width}
					height={size.height}
					numberOfPieces={180}
					recycle={false}
					colors={colors}
					tweenDuration={1000}
					gravity={0.25}
					initialVelocityX={{ min: -2, max: 2 }}
					initialVelocityY={{ min: 2, max: 5 }}
					confettiSource={{
						x: 0,
						y: -24,
						w: size.width,
						h: 0,
					}}
					onConfettiComplete={() => setActive(false)}
				/>
			)}
		</div>,
		document.body,
	);
}
