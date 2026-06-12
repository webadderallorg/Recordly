import {
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	MonitorIcon,
	PauseIcon,
	PlayIcon,
	SquareIcon,
	UserSquareIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "./LaunchWindow.module.css";

interface RecordingControlsProps {
	paused: boolean;
	microphoneEnabled: boolean;
	elapsed: number;
	onToggleMicrophone: () => void;
	webcamEnabled: boolean;
	cameraFullActive: boolean;
	onToggleCameraLayout: () => void;
	sceneStyleMode: "fill" | "framed";
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
	webcamEnabled,
	cameraFullActive,
	onToggleCameraLayout,
	sceneStyleMode,
	onPauseResume,
	onStopRecording,
	onHideHud,
	onCancelRecording,
	formatTime,
}: RecordingControlsProps) => {
	const t = useScopedT("launch");

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

				{sceneStyleMode === "fill" && (
					<span className="text-[10px] font-bold tracking-[0.06em] text-[var(--launch-text-muted)]">
						{t("recording.sceneFillBadge", "Fullscreen")}
					</span>
				)}

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

				{webcamEnabled && (
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						className={cameraFullActive ? styles.ibActive : ""}
						onClick={onToggleCameraLayout}
						title={
							cameraFullActive
								? `${t("recording.cameraLayoutToScreen", "Back to screen")} (⌥/)`
								: `${t("recording.cameraLayoutToCameraFull", "Camera fullscreen")} (⌥/)`
						}
						aria-label={
							cameraFullActive
								? `${t("recording.cameraLayoutToScreen", "Back to screen")} (⌥/)`
								: `${t("recording.cameraLayoutToCameraFull", "Camera fullscreen")} (⌥/)`
						}
					>
						{cameraFullActive ? (
							<MonitorIcon size={18} />
						) : (
							<UserSquareIcon size={18} />
						)}
					</Button>
				)}

				<Separator orientation="vertical" className="mx-[5px] h-6" />

				<Button
					variant={paused ? "default" : "ghost"}
					size="icon"
					iconSize="lg"
					onClick={onPauseResume}
					title={paused ? t("recording.resume") : t("recording.pause")}
					aria-label={paused ? t("recording.resume") : t("recording.pause")}
					className={paused ? styles.ibGreen : ""}
				>
					{paused ? (
						<PlayIcon size={18} fill="currentColor" strokeWidth={0} />
					) : (
						<PauseIcon size={18} />
					)}
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					onClick={onStopRecording}
					title={t("recording.stop")}
					aria-label={t("recording.stop")}
					className={styles.ibRed}
				>
					<SquareIcon size={16} fill="currentColor" strokeWidth={0} />
				</Button>

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
		webcamEnabled,
		cameraFullActive,
		onToggleCameraLayout,
		sceneStyleMode,
		onPauseResume,
		onStopRecording,
		onHideHud,
		onCancelRecording,
		formatTime,
		t,
	]);

	return memoizedControls;
};
