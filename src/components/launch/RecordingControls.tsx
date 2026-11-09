import { Button, Tooltip } from "@heroui/react";
import { useState } from "react";
import { Trash, PauseIcon, PlayIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "./LaunchWindow.module.css";

interface RecordingControlsProps {
	paused: boolean;
	busy?: boolean;
	elapsed: number;
	onPauseResume: () => void;
	onStopRecording: () => void;
	onCancelRecording: () => void | Promise<unknown>;
	formatTime: (seconds: number) => string;
}

export function RecordingControls({
	paused,
	busy = false,
	elapsed,
	onPauseResume,
	onStopRecording,
	onCancelRecording,
	formatTime,
}: RecordingControlsProps) {
	const t = useScopedT("launch");
	const captureT = useScopedT("capture");
	const [discarding, setDiscarding] = useState(false);
	const disabled = busy || discarding;
	return (
		<div
			role="group"
			aria-label={captureT("recordingControls")}
			className={styles.captureControls}
		>
			<Tooltip>
				<Button
					isIconOnly
					variant="ghost"
					isDisabled={disabled}
					className={styles.hudAction}
					aria-label={t("recording.stop")}
					onPress={onStopRecording}
				>
					<span aria-hidden="true" className="size-4 rounded-[3px] bg-danger" />
				</Button>
				<Tooltip.Content>{t("recording.stop")}</Tooltip.Content>
			</Tooltip>
			<div className={styles.recordingTimer}>
				<span role="timer" aria-live="off" className="text-base font-semibold tabular-nums">
					{formatTime(elapsed).replace(/^0(?=\d:)/, "")}
				</span>
				<span role="status" className="sr-only">
					{discarding
						? captureT("discardingRecording")
						: paused
							? t("recording.paused")
							: captureT("recording")}
				</span>
			</div>
			<span aria-hidden="true" className={styles.captureDivider} />
			<Tooltip>
				<Button
					isIconOnly
					variant="ghost"
					isDisabled={disabled}
					className={styles.hudAction}
					onPress={onPauseResume}
					aria-label={paused ? t("recording.resume") : t("recording.pause")}
				>
					{paused ? (
						<PlayIcon weight="fill" className="size-5" />
					) : (
						<PauseIcon weight="fill" className="size-5" />
					)}
				</Button>
				<Tooltip.Content>
					{paused ? t("recording.resume") : t("recording.pause")}
				</Tooltip.Content>
			</Tooltip>
			<Tooltip>
				<Button
					isIconOnly
					variant="ghost"
					isDisabled={disabled}
					className={styles.hudAction}
					aria-label={captureT("discardRecording")}
					onPress={async () => {
						if (discarding) return;
						setDiscarding(true);
						try {
							await onCancelRecording();
						} finally {
							setDiscarding(false);
						}
					}}
				>
					<Trash className="size-5" />
				</Button>
				<Tooltip.Content>{captureT("discardRecording")}</Tooltip.Content>
			</Tooltip>
		</div>
	);
}
