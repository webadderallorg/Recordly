import {
	ArrowCircleUp as ArrowUpCircle,
	ArrowClockwise as RefreshCw,
	CaretUp as ChevronUp,
	CheckCircle as CheckCircle2,
	DotsThreeVertical as MoreVertical,
	Microphone as Mic,
	MicrophoneSlash as MicOff,
	Minus,
	Monitor,
	Pause,
	Play,
	Stop as Square,
	Timer,
	VideoCamera as Video,
	VideoCameraSlash as VideoOff,
	X,
} from "@phosphor-icons/react";
import { useScopedT } from "@/contexts/I18nContext";
import { ContentClamp } from "@/components/ui/content-clamp";
import { IconButton, Separator } from "./helperComponents";
import styles from "./LaunchWindow.module.css";

interface UpdateBadgeProps {
	updateStatus: {
		status: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";
		currentVersion: string;
		availableVersion: string | null;
		detail?: string;
	};
	updateActionPending: boolean;
	onUpdateClick: () => void;
}

export function UpdateBadge({ updateStatus, updateActionPending, onUpdateClick }: UpdateBadgeProps) {
	const t = useScopedT("launch");

	const label =
		updateStatus.status === "up-to-date"
			? t("recording.update.updated")
			: t("recording.update.update");

	const title = (() => {
		switch (updateStatus.status) {
			case "up-to-date":
				return t("recording.update.upToDateTitle", "Recordly {{version}} is up to date.", {
					version: updateStatus.currentVersion,
				});
			case "available":
			case "ready":
				return updateStatus.availableVersion
					? t("recording.update.availableTitle", "Recordly {{version}} is available.", {
							version: updateStatus.availableVersion,
						})
					: t("recording.update.availableGenericTitle");
			case "downloading":
				return updateStatus.detail ?? t("recording.update.downloadingTitle");
			case "checking":
				return t("recording.update.checkingTitle");
			case "error":
				return updateStatus.detail ?? t("recording.update.errorTitle");
			default:
				return t("recording.update.idleTitle");
		}
	})();

	const className = `${styles.updateBadge} ${updateStatus.status === "up-to-date" ? styles.updateBadgeQuiet : styles.updateBadgeHot} ${styles.electronNoDrag}`;

	const icon = (() => {
		switch (updateStatus.status) {
			case "up-to-date":
				return <CheckCircle2 size={14} />;
			case "checking":
			case "downloading":
				return <RefreshCw size={14} className={styles.updateBadgeSpin} />;
			default:
				return <ArrowUpCircle size={14} />;
		}
	})();

	return (
		<button
			type="button"
			onClick={onUpdateClick}
			className={className}
			title={title}
			disabled={updateActionPending}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
}

interface RecordingControlsProps {
	paused: boolean;
	elapsed: number;
	formatTime: (s: number) => string;
	microphoneEnabled: boolean;
	resumeRecording: () => void;
	pauseRecording: () => void;
	toggleRecording: () => void;
	cancelRecording: () => void;
}

export function RecordingControls({
	paused,
	elapsed,
	formatTime,
	microphoneEnabled,
	resumeRecording,
	pauseRecording,
	toggleRecording,
	cancelRecording,
}: RecordingControlsProps) {
	const t = useScopedT("launch");

	return (
		<>
			<div className="flex items-center gap-[5px]">
				<div
					className={`w-[7px] h-[7px] rounded-full ${paused ? "bg-[#fbbf24]" : `bg-[#f43f5e] ${styles.recDotBlink}`}`}
				/>
				<span
					className={`text-[10px] font-bold tracking-[0.06em] ${paused ? "text-[#fbbf24]" : "text-[#f43f5e]"}`}
				>
					{paused ? t("recording.paused") : t("recording.rec")}
				</span>
			</div>

			<span
				className={`font-mono text-xs font-semibold min-w-[52px] text-center tracking-[0.02em] ${paused ? "text-[#fbbf24]" : "text-[#eeeef2]"}`}
			>
				{formatTime(elapsed)}
			</span>

			<Separator />

			<IconButton
				title={
					microphoneEnabled
						? t("recording.disableMicrophone")
						: t("recording.enableMicrophone")
				}
				className={microphoneEnabled ? styles.ibActive : ""}
			>
				{microphoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
			</IconButton>

			<Separator />

			<IconButton
				onClick={paused ? resumeRecording : pauseRecording}
				title={paused ? t("recording.resume") : t("recording.pause")}
				className={paused ? styles.ibGreen : ""}
			>
				{paused ? (
					<Play size={18} fill="currentColor" strokeWidth={0} />
				) : (
					<Pause size={18} />
				)}
			</IconButton>

			<IconButton
				onClick={toggleRecording}
				title={t("recording.stop")}
				className={styles.ibRed}
			>
				<Square size={16} fill="currentColor" strokeWidth={0} />
			</IconButton>

			<IconButton
				onClick={() => window.electronAPI?.hudOverlayHide?.()}
				title={t("recording.hideHud")}
			>
				<Minus size={16} />
			</IconButton>

			<IconButton onClick={cancelRecording} title={t("recording.cancel")}>
				<X size={18} />
			</IconButton>
		</>
	);
}

interface IdleControlsProps {
	selectedSource: string;
	activeDropdown: string;
	toggleDropdown: (which: "sources" | "more" | "mic" | "countdown" | "webcam") => void;
	hasSelectedSource: boolean;
	toggleRecording: () => void;
	microphoneEnabled: boolean;
	toggleMicrophone: () => void;
	webcamEnabled: boolean;
	toggleWebcam: () => void;
	countdownDelay: number;
	countdownActive: boolean;
	moreButtonRef: React.RefObject<HTMLButtonElement | null>;
}

export function IdleControls({
	selectedSource,
	activeDropdown,
	toggleDropdown,
	hasSelectedSource,
	toggleRecording,
	microphoneEnabled,
	toggleMicrophone,
	webcamEnabled,
	toggleWebcam,
	countdownDelay,
	countdownActive,
	moreButtonRef,
}: IdleControlsProps) {
	const t = useScopedT("launch");

	return (
		<>
			<button
				type="button"
				className={`${styles.screenSel} ${styles.electronNoDrag}`}
				onClick={() => toggleDropdown("sources")}
				title={selectedSource}
			>
				<Monitor size={16} />
				<ContentClamp className={styles.sourceLabel} truncateLength={36}>
					{selectedSource}
				</ContentClamp>
				<ChevronUp
					size={10}
					className={`text-[#6b6b78] ml-0.5 transition-transform duration-200 ${activeDropdown === "sources" ? "" : "rotate-180"}`}
				/>
			</button>

			<Separator />

			<IconButton
				onClick={toggleMicrophone}
				title={
					microphoneEnabled
						? t("recording.disableMicrophone")
						: t("recording.enableMicrophone")
				}
				className={microphoneEnabled ? styles.ibActive : ""}
			>
				{microphoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
			</IconButton>

			<IconButton
				onClick={toggleWebcam}
				title={webcamEnabled ? t("recording.disableWebcam") : t("recording.enableWebcam")}
				className={webcamEnabled ? styles.ibActive : ""}
			>
				{webcamEnabled ? <Video size={18} /> : <VideoOff size={18} />}
			</IconButton>

			<IconButton
				onClick={() => toggleDropdown("countdown")}
				title={t("recording.countdownDelay")}
				className={countdownDelay > 0 ? styles.ibActive : ""}
			>
				<Timer size={18} />
			</IconButton>

			<Separator />

			<button
				type="button"
				className={`${styles.recBtn} ${styles.electronNoDrag}`}
				onClick={hasSelectedSource ? toggleRecording : () => toggleDropdown("sources")}
				disabled={countdownActive}
				title={t("recording.record")}
			>
				<div className={styles.recDot} />
			</button>

			<Separator />

			<IconButton
				buttonRef={moreButtonRef}
				onClick={() => toggleDropdown("more")}
				title={t("recording.more")}
			>
				<MoreVertical size={18} />
			</IconButton>

			<IconButton
				onClick={() => window.electronAPI?.hudOverlayHide?.()}
				title={t("recording.hideHud")}
			>
				<Minus size={16} />
			</IconButton>

			<IconButton
				onClick={() => window.electronAPI?.hudOverlayClose?.()}
				title={t("recording.closeApp")}
			>
				<X size={16} />
			</IconButton>
		</>
	);
}
