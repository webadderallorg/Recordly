import {
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	PauseIcon,
	PlayIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useScopedT } from "@/contexts/I18nContext";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	formatRecordingAccelerator,
	type RecordingShortcutsConfig,
} from "@/lib/recordingShortcuts";
import styles from "./LaunchWindow.module.css";

interface RecordingControlsProps {
	paused: boolean;
	microphoneEnabled: boolean;
	elapsed: number;
	onToggleMicrophone: () => void;
	onPauseResume: () => void;
	onStopRecording: () => void;
	onHideHud: () => void;
	onCancelRecording: () => void;
	formatTime: (seconds: number) => string;
}

export const RecordingControls = ({
	paused,
	microphoneEnabled,
	elapsed,
	onToggleMicrophone,
	onPauseResume,
	onStopRecording,
	onHideHud,
	onCancelRecording,
	formatTime,
}: RecordingControlsProps) => {
	const t = useScopedT("launch");
	const [shortcuts, setShortcuts] = useState<RecordingShortcutsConfig>(
		DEFAULT_RECORDING_SHORTCUTS,
	);
	const isMac =
		typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

	useEffect(() => {
		let cancelled = false;
		void window.electronAPI?.getRecordingShortcuts?.().then((config) => {
			if (!cancelled && config) {
				setShortcuts({ ...DEFAULT_RECORDING_SHORTCUTS, ...config });
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const pauseLabel = paused ? t("recording.resume") : t("recording.pause");
	const pauseShortcut = formatRecordingAccelerator(shortcuts.pauseResume, isMac);
	const stopShortcut = formatRecordingAccelerator(shortcuts.stop, isMac);

	const memoizedControls = useMemo(() => {
		return (
			<>
				<div className="flex items-center gap-[5px]">
					<div
						className={`w-[7px] h-[7px] rounded-full ${
							paused ? "bg-[#fbbf24]" : `bg-[#f43f5e] ${styles.recDotBlink}`
						}`}
					/>
					<span
						className={`text-[10px] font-bold tracking-[0.06em] ${
							paused ? "text-[#fbbf24]" : "text-[#f43f5e]"
						}`}
					>
						{paused ? t("recording.paused") : t("recording.rec")}
					</span>
				</div>

				<span
					className={`font-mono text-xs font-semibold min-w-[52px] text-center tracking-[0.02em] ${
						paused ? "text-[#fbbf24]" : "text-[var(--launch-text)]"
					}`}
				>
					{formatTime(elapsed)}
				</span>

				<Separator orientation="vertical" className="mx-[5px] h-6" />

				<span title={t("recording.micToggleDisabledTip")}>
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						className={microphoneEnabled ? styles.ibActive : ""}
						aria-label={t("recording.micToggleDisabledTip")}
						disabled
						onClick={onToggleMicrophone}
					>
						{microphoneEnabled ? (
							<MicrophoneIcon size={18} />
						) : (
							<MicrophoneSlashIcon size={18} />
						)}
					</Button>
				</span>

				<Separator orientation="vertical" className="mx-[5px] h-6" />

				<Button
					variant={paused ? "default" : "ghost"}
					size="icon"
					iconSize="lg"
					onClick={onPauseResume}
					title={`${pauseLabel} (${pauseShortcut})`}
					aria-label={`${pauseLabel} (${pauseShortcut})`}
					className={paused ? styles.ibGreen : ""}
				>
					{paused ? (
						<PlayIcon size={18} fill="currentColor" strokeWidth={0} />
					) : (
						<PauseIcon size={18} />
					)}
				</Button>

				<button
					type="button"
					onClick={onStopRecording}
					title={`${t("recording.stop")} (${stopShortcut})`}
					aria-label={`${t("recording.stop")} (${stopShortcut})`}
					className={`${styles.recBtn} ${styles.electronNoDrag}`}
				>
					<span className={styles.stopSquare} />
				</button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					onClick={onHideHud}
					title={t("recording.hideHud")}
					aria-label={t("recording.hideHud")}
				>
					<MinusIcon size={16} />
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					onClick={onCancelRecording}
					title={t("recording.cancel")}
					aria-label={t("recording.cancel")}
				>
					<XIcon size={18} />
				</Button>
			</>
		);
	}, [
		paused,
		microphoneEnabled,
		elapsed,
		onToggleMicrophone,
		onPauseResume,
		onStopRecording,
		onHideHud,
		onCancelRecording,
		formatTime,
		t,
		pauseLabel,
		pauseShortcut,
		stopShortcut,
	]);

	return memoizedControls;
};
