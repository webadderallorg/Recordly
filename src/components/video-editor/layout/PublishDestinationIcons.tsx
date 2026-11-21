import { motion, type Transition } from "motion/react";

const poseTransition: Transition = { duration: 0.24, ease: "easeOut" };

export function PublishLinkIcon({ hovered }: { hovered: boolean }) {
	return (
		<motion.svg
			aria-hidden="true"
			className="size-6 overflow-visible"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			initial={false}
			animate={hovered ? "hover" : "idle"}
		>
			<motion.path
				d="m10.5 7.15 2.82-2.82a4.5 4.5 0 0 1 6.36 6.36l-2.82 2.82"
				transition={poseTransition}
				variants={{
					idle: { x: 0, y: 0 },
					hover: { x: 1.9, y: -1.9 },
				}}
			/>
			<motion.path
				d="m13.5 16.85-2.82 2.82a4.5 4.5 0 0 1-6.36-6.36l2.82-2.82"
				transition={poseTransition}
				variants={{
					idle: { x: 0, y: 0 },
					hover: { x: -1.9, y: 1.9 },
				}}
			/>
			<motion.path
				d="m9 15 6-6"
				transition={poseTransition}
				variants={{
					idle: { opacity: 1 },
					hover: { opacity: 0.2 },
				}}
			/>
		</motion.svg>
	);
}

export function PublishSaveIcon({ hovered }: { hovered: boolean }) {
	return (
		<motion.svg
			aria-hidden="true"
			className="size-6 overflow-visible"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			initial={false}
			animate={hovered ? "hover" : "idle"}
		>
			<motion.path
				d="M12 0v6m-2.5-2.5L12 6l2.5-2.5"
				transition={poseTransition}
				variants={{
					idle: { y: -4, opacity: 0 },
					hover: { y: -1, opacity: 1 },
				}}
			/>
			<motion.g
				transition={poseTransition}
				variants={{
					idle: { y: 0 },
					hover: { y: 2 },
				}}
			>
				<rect x="2.25" y="6.75" width="19.5" height="10.5" rx="0.75" />
				<circle cx="17.625" cy="12" r="1.125" fill="currentColor" stroke="none" />
			</motion.g>
		</motion.svg>
	);
}
