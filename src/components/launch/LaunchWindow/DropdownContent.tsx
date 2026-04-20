import {
	AppWindow,
	Eye,
	EyeSlash as EyeOff,
	FolderOpen,
	MicrophoneSlash as MicOff,
	Monitor,
	SpeakerHigh as Volume2,
	SpeakerX as VolumeX,
	Timer,
	Translate as Languages,
	VideoCamera as Video,
	VideoCamera as VideoIcon,
	VideoCameraSlash as VideoOff,
} from "@phosphor-icons/react";
import type React from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useScopedT } from "@/contexts/I18nContext";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { DropdownItem, MicDeviceRow } from "./helperComponents";
import { COUNTDOWN_OPTIONS, type DesktopSource, LOCALE_LABELS } from "./types";
import styles from "./LaunchWindow.module.css";

interface DropdownContentProps {
	activeDropdown: "sources" | "more" | "mic" | "countdown" | "webcam";
	setActiveDropdown: (v: "none" | "sources" | "more" | "mic" | "countdown" | "webcam") => void;
	sourcesLoading: boolean;
	screenSources: DesktopSource[];
	windowSources: DesktopSource[];
	selectedSource: string;
	onSourceSelect: (source: DesktopSource) => void;
	systemAudioEnabled: boolean;
	setSystemAudioEnabled: (v: boolean) => void;
	microphoneEnabled: boolean;
	setMicrophoneEnabled: (v: boolean) => void;
	microphoneDeviceId: string | undefined;
	selectedDeviceId: string | null;
	setSelectedDeviceId: (v: string) => void;
	setMicrophoneDeviceId: (v: string | undefined) => void;
	devices: { deviceId: string; label: string }[];
	webcamEnabled: boolean;
	setWebcamEnabled: (v: boolean) => void;
	webcamDeviceId: string | undefined;
	selectedVideoDeviceId: string | null;
	setSelectedVideoDeviceId: (v: string) => void;
	setWebcamDeviceId: (v: string) => void;
	videoDevices: { deviceId: string; label: string }[];
	showWebcamControls: boolean;
	showFloatingWebcamPreview: boolean;
	setShowFloatingWebcamPreview: React.Dispatch<React.SetStateAction<boolean>>;
	setWebcamPreviewNode: (node: HTMLVideoElement | null) => void;
	countdownDelay: number;
	setCountdownDelay: (v: number) => void;
	supportsHudCaptureProtection: boolean;
	hideHudFromCapture: boolean;
	onToggleHudCaptureProtection: () => void;
	onChooseRecordingsDirectory: () => void;
	onOpenVideoFile: () => void;
	onOpenProjectBrowser: () => void;
	appVersion: string | null;
}

export function DropdownContent({
	activeDropdown,
	setActiveDropdown,
	sourcesLoading,
	screenSources,
	windowSources,
	selectedSource,
	onSourceSelect,
	systemAudioEnabled,
	setSystemAudioEnabled,
	microphoneEnabled,
	setMicrophoneEnabled,
	microphoneDeviceId,
	selectedDeviceId,
	setSelectedDeviceId,
	setMicrophoneDeviceId,
	devices,
	webcamEnabled,
	setWebcamEnabled,
	webcamDeviceId,
	selectedVideoDeviceId,
	setSelectedVideoDeviceId,
	setWebcamDeviceId,
	videoDevices,
	showWebcamControls,
	showFloatingWebcamPreview,
	setShowFloatingWebcamPreview,
	setWebcamPreviewNode,
	countdownDelay,
	setCountdownDelay,
	supportsHudCaptureProtection,
	hideHudFromCapture,
	onToggleHudCaptureProtection,
	onChooseRecordingsDirectory,
	onOpenVideoFile,
	onOpenProjectBrowser,
	appVersion,
}: DropdownContentProps) {
	const { locale, setLocale } = useI18n();
	const t = useScopedT("launch");

	return (
		<div className={`${styles.menuCard} ${styles.electronNoDrag}`}>
			{activeDropdown === "sources" && (
				<>
					{sourcesLoading ? (
						<div className="flex items-center justify-center py-6">
							<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#6b6b78]" />
						</div>
					) : (
						<>
							{screenSources.length > 0 && (
								<>
									<div className={styles.ddLabel}>{t("recording.screens")}</div>
									{screenSources.map((source) => (
										<DropdownItem
											key={source.id}
											icon={<Monitor size={16} />}
											selected={selectedSource === source.name}
											onClick={() => onSourceSelect(source)}
										>
											{source.name}
										</DropdownItem>
									))}
								</>
							)}
							{windowSources.length > 0 && (
								<>
									<div
										className={styles.ddLabel}
										style={screenSources.length > 0 ? { marginTop: 4 } : undefined}
									>
										{t("recording.windows")}
									</div>
									{windowSources.map((source) => (
										<DropdownItem
											key={source.id}
											icon={<AppWindow size={16} />}
											selected={selectedSource === source.name}
											onClick={() => onSourceSelect(source)}
										>
											{source.appName && source.appName !== source.name
												? `${source.appName} — ${source.name}`
												: source.name}
										</DropdownItem>
									))}
								</>
							)}
							{screenSources.length === 0 && windowSources.length === 0 && (
								<div className="text-center text-xs text-[#6b6b78] py-4">
									{t("recording.noSourcesFound")}
								</div>
							)}
						</>
					)}
				</>
			)}

			{activeDropdown === "mic" && (
				<>
					<div className={styles.ddLabel}>{t("recording.microphone")}</div>
					<DropdownItem
						icon={systemAudioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
						selected={systemAudioEnabled}
						onClick={() => setSystemAudioEnabled(!systemAudioEnabled)}
					>
						{systemAudioEnabled
							? t("recording.disableSystemAudio")
							: t("recording.enableSystemAudio")}
					</DropdownItem>
					{microphoneEnabled && (
						<DropdownItem
							icon={<MicOff size={16} />}
							onClick={() => {
								setMicrophoneEnabled(false);
								setActiveDropdown("none");
							}}
						>
							{t("recording.turnOffMicrophone")}
						</DropdownItem>
					)}
					{!microphoneEnabled && (
						<div className="px-3 py-2 text-xs text-[#6b6b78]">
							{t("recording.selectMicToEnable")}
						</div>
					)}
					{devices.map((device) => (
						<MicDeviceRow
							key={device.deviceId}
							device={device}
							selected={
								microphoneEnabled &&
								(microphoneDeviceId === device.deviceId ||
									selectedDeviceId === device.deviceId)
							}
							onSelect={() => {
								setMicrophoneEnabled(true);
								setSelectedDeviceId(device.deviceId);
								setMicrophoneDeviceId(
									device.deviceId === "default" ? undefined : device.deviceId,
								);
							}}
						/>
					))}
					{devices.length === 0 && (
						<div className="text-center text-xs text-[#6b6b78] py-4">
							{t("recording.noMicrophonesFound")}
						</div>
					)}
				</>
			)}

			{activeDropdown === "webcam" && (
				<>
					<div className={styles.ddLabel}>{t("recording.webcam")}</div>
					{webcamEnabled && (
						<>
							<DropdownItem
								icon={<VideoOff size={16} />}
								onClick={() => {
									setWebcamEnabled(false);
									setActiveDropdown("none");
								}}
							>
								{t("recording.turnOffWebcam")}
							</DropdownItem>
							<DropdownItem
								icon={
									showFloatingWebcamPreview ? (
										<EyeOff size={16} />
									) : (
										<Eye size={16} />
									)
								}
								selected={showFloatingWebcamPreview}
								onClick={() => setShowFloatingWebcamPreview((current) => !current)}
							>
								{showFloatingWebcamPreview
									? t("recording.hideFloatingWebcamPreview")
									: t("recording.showFloatingWebcamPreview")}
							</DropdownItem>
						</>
					)}
					{!webcamEnabled && (
						<div className="px-3 py-2 text-xs text-[#6b6b78]">
							{t("recording.selectWebcamToEnable")}
						</div>
					)}
					{showWebcamControls && (
						<div className="flex justify-center px-3 py-2">
							<div className="h-24 w-24 overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
								<video
									ref={setWebcamPreviewNode}
									className="h-full w-full object-cover"
									muted
									playsInline
									style={{ transform: "scaleX(-1)" }}
								/>
							</div>
						</div>
					)}
					{videoDevices.map((device) => (
						<DropdownItem
							key={device.deviceId}
							icon={
								webcamEnabled &&
								(webcamDeviceId === device.deviceId ||
									selectedVideoDeviceId === device.deviceId) ? (
									<Video size={16} />
								) : (
									<VideoOff size={16} />
								)
							}
							selected={
								webcamEnabled &&
								(webcamDeviceId === device.deviceId ||
									selectedVideoDeviceId === device.deviceId)
							}
							onClick={() => {
								setWebcamEnabled(true);
								setSelectedVideoDeviceId(device.deviceId);
								setWebcamDeviceId(device.deviceId);
							}}
						>
							{device.label}
						</DropdownItem>
					))}
					{videoDevices.length === 0 && (
						<div className="text-center text-xs text-[#6b6b78] py-4">
							{t("recording.noWebcamsFound")}
						</div>
					)}
				</>
			)}

			{activeDropdown === "countdown" && (
				<>
					<div className={styles.ddLabel}>{t("recording.countdownDelay")}</div>
					{COUNTDOWN_OPTIONS.map((delay) => (
						<DropdownItem
							key={delay}
							icon={<Timer size={16} />}
							selected={countdownDelay === delay}
							onClick={() => {
								setCountdownDelay(delay);
								setActiveDropdown("none");
							}}
						>
							{delay === 0 ? t("recording.noDelay") : `${delay}s`}
						</DropdownItem>
					))}
				</>
			)}

			{activeDropdown === "more" && (
				<>
					{supportsHudCaptureProtection && (
						<DropdownItem
							icon={hideHudFromCapture ? <EyeOff size={16} /> : <Eye size={16} />}
							selected={hideHudFromCapture}
							onClick={() => void onToggleHudCaptureProtection()}
						>
							{hideHudFromCapture
								? t("recording.hideHudFromVideo")
								: t("recording.showHudInVideo")}
						</DropdownItem>
					)}
					<DropdownItem
						icon={<FolderOpen size={16} />}
						onClick={onChooseRecordingsDirectory}
					>
						{t("recording.recordingsFolder")}
					</DropdownItem>
					<DropdownItem icon={<VideoIcon size={16} />} onClick={onOpenVideoFile}>
						{t("recording.openVideoFile")}
					</DropdownItem>
					<DropdownItem
						icon={<FolderOpen size={16} />}
						onClick={() => void onOpenProjectBrowser()}
					>
						{t("recording.openProject")}
					</DropdownItem>
					<div className={styles.ddLabel} style={{ marginTop: 4 }}>
						{t("recording.language")}
					</div>
					{SUPPORTED_LOCALES.map((code) => (
						<DropdownItem
							key={code}
							icon={<Languages size={16} />}
							selected={locale === code}
							onClick={() => {
								setLocale(code as AppLocale);
								setActiveDropdown("none");
							}}
						>
							{LOCALE_LABELS[code] ?? code}
						</DropdownItem>
					))}
					{appVersion && (
						<div
							style={{
								marginTop: 8,
								padding: "4px 12px",
								fontSize: 11,
								color: "#6b6b78",
								textAlign: "center",
								userSelect: "text",
							}}
						>
							v{appVersion}
						</div>
					)}
				</>
			)}
		</div>
	);
}
