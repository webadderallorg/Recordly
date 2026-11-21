import { Spinner } from "@heroui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { XIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { HudTooltip } from "./HudTooltip";
import { useCountdownRemaining } from "./hooks/useCountdownRemaining";
import styles from "./LaunchWindow.module.css";

export function RecordButton({
	countdownActive,
	countdownDelay,
	disabled,
	onRecord,
	onCancel,
}: {
	countdownActive: boolean;
	countdownDelay: number;
	disabled: boolean;
	onRecord: () => void;
	onCancel: () => void;
}) {
	const t = useScopedT("launch");
	const remaining = useCountdownRemaining(countdownActive, countdownDelay);
	const reducedMotion = useReducedMotion();
	useEffect(() => {
		if (!countdownActive) return;
		const cancel = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCancel();
			}
		};
		// React Aria stops Escape in document capture while a tooltip is open.
		window.addEventListener("keydown", cancel, true);
		return () => window.removeEventListener("keydown", cancel, true);
	}, [countdownActive, onCancel]);
	const label = countdownActive
		? t("recording.cancelCountdown", "Cancel countdown")
		: t("recording.startRecording", "Start recording");
	return (
		<HudTooltip label={label}>
			<Button
				type="button"
				variant="destructive"
				size="icon"
				className={`${styles.electronNoDrag} ${styles.recordControl}`}
				data-countdown={countdownActive || undefined}
				onClick={countdownActive ? onCancel : onRecord}
				disabled={disabled && !countdownActive}
				aria-label={countdownActive ? label : t("recording.record")}
			>
				{countdownActive ? (
					<>
						<span className={styles.countdownValue}>
							<span
								className="sr-only"
								role="status"
								aria-live="polite"
								aria-atomic="true"
							>
								{remaining && remaining > 0 ? remaining : ""}
							</span>
							<span className={styles.countdownDigits} aria-hidden="true">
								<AnimatePresence initial={false}>
									<motion.span
										key={remaining && remaining > 0 ? remaining : "starting"}
										className={styles.countdownDigit}
										data-countdown-number={
											remaining && remaining > 0 ? remaining : "starting"
										}
										initial={{
											opacity: reducedMotion ? 1 : 0,
											y: reducedMotion ? 0 : 10,
										}}
										animate={{ opacity: 1, y: 0 }}
										exit={{
											opacity: reducedMotion ? 1 : 0,
											y: reducedMotion ? 0 : -10,
										}}
										transition={{
											duration: reducedMotion ? 0 : 0.22,
											ease: "easeOut",
										}}
									>
										{remaining && remaining > 0 ? (
											remaining
										) : (
											<Spinner size="sm" />
										)}
									</motion.span>
								</AnimatePresence>
							</span>
						</span>
						<XIcon className={`${styles.countdownCancel} size-5`} aria-hidden="true" />
					</>
				) : (
					<span className={styles.recDot} />
				)}
			</Button>
		</HudTooltip>
	);
}
