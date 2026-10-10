import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

const colors = ["#0088ff", "#67d5ff", "#ffc857", "#f574b9", "#64d6a2"];
const particles = Array.from({ length: 48 }, (_, index) => ({
	id: index,
	right: index % 2 === 0,
	distance: 70 + ((index * 47) % 260),
	rise: 120 + ((index * 31) % 240),
	spin: (index % 2 === 0 ? 1 : -1) * (180 + ((index * 29) % 540)),
	delay: (index % 8) * 0.025,
}));

export function PermissionsConfetti({ ready }: { ready: boolean }) {
	const reduceMotion = useReducedMotion();
	const celebrated = useRef(false);
	const [active, setActive] = useState(false);

	useEffect(() => {
		if (!ready || reduceMotion || celebrated.current) return;
		celebrated.current = true;
		setActive(true);
	}, [ready, reduceMotion]);

	useEffect(() => {
		if (!active) return;
		const timeout = window.setTimeout(() => setActive(false), 2300);
		return () => window.clearTimeout(timeout);
	}, [active]);

	if (!active || reduceMotion) return null;
	return (
		<div
			data-permissions-confetti
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
		>
			{particles.map(({ id, right, distance, rise, spin, delay }) => (
				<motion.span
					key={id}
					className="absolute bottom-12 h-2.5 w-1.5 rounded-[1px]"
					style={{
						left: right ? "90%" : "10%",
						backgroundColor: colors[id % colors.length],
					}}
					initial={{ opacity: 0, x: 0, y: 0, rotate: 0 }}
					animate={{
						opacity: [0, 1, 1, 0],
						x: [0, distance * (right ? -1 : 1)],
						y: [0, -rise, -rise * 0.85, 90],
						rotate: [0, spin],
					}}
					transition={{ duration: 1.9, delay, ease: "easeOut" }}
				/>
			))}
		</div>
	);
}
