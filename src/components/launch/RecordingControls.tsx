import {
	House,
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	PauseIcon,
	PlayIcon,
	XIcon,
} from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { Button, Separator, Tooltip } from "@heroui/react";
import styles from "./LaunchWindow.module.css";

interface RecordingControlsProps {
	onHome: () => void;
	paused: boolean;
	microphoneEnabled: boolean;
	elapsed: number;
	onPauseResume: () => void;
	onStopRecording: () => void;
	onHideHud: () => void;
	onCancelRecording: () => void;
	formatTime: (seconds: number) => string;
}
export function RecordingControls({
	onHome,
	paused,
	microphoneEnabled,
	elapsed,
	onPauseResume,
	onStopRecording,
	onHideHud,
	onCancelRecording,
	formatTime,
}: RecordingControlsProps) {
	const t = useScopedT("launch");
	const actionClass = `size-9 min-w-9 rounded-full ${styles.electronNoDrag}`;
	return (
		<div role="group" aria-label="Recording controls" className="flex items-center gap-2">
			<Button
				isIconOnly
				variant="ghost"
				className={actionClass}
				aria-label={t("recording.home")}
				onPress={onHome}
			>
				<House weight="fill" className="size-4" />
			</Button>
			<div className="flex items-center gap-3 px-2">
				<span
					className={`size-2 rounded-full ${paused ? "bg-warning" : `bg-danger ${styles.recDotBlink}`}`}
				/>
				<span
					role="timer"
					aria-live="off"
					aria-label={`${paused ? t("recording.paused") : t("recording.recordingInProgress")}: ${formatTime(elapsed)}`}
					className="min-w-14 text-sm font-medium tabular-nums text-foreground"
				>
					{formatTime(elapsed)}
				</span>
				{paused && (
					<span className="text-xs text-muted-foreground">{t("recording.paused")}</span>
				)}
			</div>
			<Tooltip>
				<Button
					isIconOnly
					variant="ghost"
					isDisabled
					className={actionClass}
					aria-label={microphoneEnabled ? "Microphone on" : "Microphone off"}
				>
					{microphoneEnabled ? (
						<MicrophoneIcon weight="fill" className="size-4" />
					) : (
						<MicrophoneSlashIcon className="size-4" />
					)}
				</Button>
				<Tooltip.Content>{t("recording.micToggleDisabledTip")}</Tooltip.Content>
			</Tooltip>
			<Separator orientation="vertical" className="mx-1 h-5 self-center" />
			<Tooltip>
				<Button
					isIconOnly
					variant="ghost"
					className={actionClass}
					onPress={onPauseResume}
					aria-label={paused ? t("recording.resume") : t("recording.pause")}
				>
					{paused ? (
						<PlayIcon weight="fill" className="size-4" />
					) : (
						<PauseIcon weight="fill" className="size-4" />
					)}
				</Button>
				<Tooltip.Content>
					{paused ? t("recording.resume") : t("recording.pause")}
				</Tooltip.Content>
			</Tooltip>
			<Tooltip>
				<Button
					isIconOnly
					variant="danger"
					className={actionClass}
					onPress={onStopRecording}
					aria-label={t("recording.stop")}
				>
					<span className="size-3 rounded-[3px] bg-current" />
				</Button>
				<Tooltip.Content>{t("recording.stop")}</Tooltip.Content>
			</Tooltip>
			<Tooltip>
				<Button
					isIconOnly
					variant="ghost"
					className={actionClass}
					onPress={onHideHud}
					aria-label={t("recording.hideHud")}
				>
					<MinusIcon className="size-4" />
				</Button>
				<Tooltip.Content>{t("recording.hideHud")}</Tooltip.Content>
			</Tooltip>
			<Tooltip>
				<Button
					isIconOnly
					variant="ghost"
					className={actionClass}
					onPress={onCancelRecording}
					aria-label={t("recording.cancel")}
				>
					<XIcon className="size-4" />
				</Button>
				<Tooltip.Content>{t("recording.cancel")}</Tooltip.Content>
			</Tooltip>
		</div>
	);
}
