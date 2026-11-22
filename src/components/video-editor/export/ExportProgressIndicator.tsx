import { ProgressBar } from "@heroui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { type ExportLoadingMessage, shuffleExportLoadingMessages } from "./exportLoadingMessages";
import "./ExportProgressIndicator.css";

type Props = {
	label: string;
	phase: string;
	headlines?: readonly ExportLoadingMessage[];
	value: number;
};

function ExportProgressHeadline({ phase, headlines }: Pick<Props, "phase" | "headlines">) {
	const reducedMotion = useReducedMotion();
	const createRotation = () => ({
		source: headlines,
		order: headlines ? shuffleExportLoadingMessages(headlines) : [],
		index: 0,
	});
	const [rotation, setRotation] = useState(createRotation);
	if (rotation.source !== headlines) setRotation(createRotation());

	const { order, index } = rotation;
	useEffect(() => {
		if (order.length < 2) return;
		const timer = window.setInterval(
			() =>
				setRotation((current) =>
					current.order === order
						? { ...current, index: (current.index + 1) % order.length }
						: current,
				),
			10000,
		);
		return () => window.clearInterval(timer);
	}, [order]);

	const headline = order[index] ?? phase;
	if (reducedMotion) return <span aria-hidden={order.length > 0}>{headline}</span>;

	return (
		<AnimatePresence mode="wait">
			<motion.span
				key={headline}
				aria-hidden={order.length > 0}
				className="export-progress-headline"
				initial={{ opacity: 0, z: -120, scale: 0.92, filter: "blur(8px)" }}
				animate={{
					opacity: [0, 1, 1],
					z: [-120, 12, 0],
					scale: [0.92, 1.02, 1],
					filter: ["blur(8px)", "blur(0px)", "blur(0px)"],
				}}
				transition={{ duration: 0.34, times: [0, 0.72, 1], ease: [0.22, 1, 0.36, 1] }}
				exit={{
					opacity: 0,
					z: 100,
					scale: 1.08,
					filter: "blur(7px)",
					transition: { duration: 0.18, ease: "easeIn" },
				}}
			>
				{headline}
			</motion.span>
		</AnimatePresence>
	);
}

export function ExportProgressIndicator({ label, phase, headlines, value }: Props) {
	return (
		<div className="export-progress-indicator">
			<p role="status" className="export-progress-phase">
				{Boolean(headlines?.length) && <span className="sr-only">{phase}</span>}
				<ExportProgressHeadline phase={phase} headlines={headlines} />
			</p>
			<ProgressBar className="export-progress" aria-label={label} value={value}>
				<ProgressBar.Track className="rounded-full">
					<ProgressBar.Fill className="export-progress-fill rounded-full" />
				</ProgressBar.Track>
				<ProgressBar.Output />
			</ProgressBar>
		</div>
	);
}
