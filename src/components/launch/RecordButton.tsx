import { Spinner } from "@heroui/react";
import { useEffect } from "react";
import { XIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
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
	useEffect(() => {
		if (!countdownActive) return;
		const cancel = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCancel();
			}
		};
		window.addEventListener("keydown", cancel);
		return () => window.removeEventListener("keydown", cancel);
	}, [countdownActive, onCancel]);
	return (
		<Button
			type="button"
			variant="destructive"
			size="icon"
			className={`${styles.electronNoDrag} ${styles.recordControl}`}
			data-countdown={countdownActive || undefined}
			onClick={countdownActive ? onCancel : onRecord}
			disabled={disabled && !countdownActive}
			title={
				countdownActive
					? t("recording.cancelCountdown", "Cancel countdown")
					: t("recording.record")
			}
		>
			{countdownActive ? (
				<>
					<span
						key={remaining}
						className={styles.countdownValue}
						role="status"
						aria-live="polite"
					>
						{remaining && remaining > 0 ? remaining : <Spinner size="sm" />}
					</span>
					<XIcon className={`${styles.countdownCancel} size-5`} aria-hidden="true" />
				</>
			) : (
				<span className={styles.recDot} />
			)}
		</Button>
	);
}
