import { Microphone as Mic, MicrophoneSlash as MicOff, Minus, Pause, Play, Stop as Square, X } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
						paused ? "text-[#fbbf24]" : "text-[#eeeef2]"
					}`}
				>
					{formatTime(elapsed)}
				</span>

				<Separator orientation="vertical" className="mx-[5px] h-6" />

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					title={
						microphoneEnabled
							? t("recording.disableMicrophone")
							: t("recording.enableMicrophone")
					}
					className={microphoneEnabled ? styles.ibActive : ""}
					onClick={onToggleMicrophone}
				>
					{microphoneEnabled ? (
						<Mic size={18} />
					) : (
						<MicOff size={18} />
					)}
				</Button>

				<Separator orientation="vertical" className="mx-[5px] h-6" />

				<Button
					variant={paused ? "default" : "ghost"}
					size="icon"
					iconSize="lg"
					onClick={onPauseResume}
					title={paused ? t("recording.resume") : t("recording.pause")}
					className={paused ? styles.ibGreen : ""}
				>
					{paused ? (
						<Play size={18} fill="currentColor" strokeWidth={0} />
					) : (
						<Pause size={18} />
					)}
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					onClick={onStopRecording}
					title={t("recording.stop")}
					className={styles.ibRed}
				>
					<Square size={16} fill="currentColor" strokeWidth={0} />
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					onClick={onHideHud}
					title={t("recording.hideHud")}
				>
					<Minus size={16} />
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="lg"
					onClick={onCancelRecording}
					title={t("recording.cancel")}
				>
					<X size={18} />
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
	]);

	return memoizedControls;
};
