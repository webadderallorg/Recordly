import {
	Eye,
	EyeSlash as EyeOff,
	FolderOpen,
	Translate as Languages,
	Microphone as Mic,
	MicrophoneSlash as MicOff,
	Timer,
	VideoCamera as Video,
	VideoCamera as VideoIcon,
	VideoCameraSlash as VideoOff,
	SpeakerHigh as Volume2,
	SpeakerX as VolumeX,
	ArrowClockwise as RefreshCw,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import { useI18n } from "@/contexts/I18nContext";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScopedT } from "../../contexts/I18nContext";
import { AudioLevelMeter } from "../ui/audio-level-meter";
import { SourceSelector } from "./SourceSelector";
import styles from "./LaunchWindow.module.css";

const LOCALE_LABELS: Record<string, string> = {
	en: "English",
	es: "Español",
	fr: "Français",
	nl: "Nederlands",
	ko: "한국어",
	"pt-BR": "Português",
	"zh-CN": "簡體中文",
	"zh-TW": "繁體中文",
};

const COUNTDOWN_OPTIONS = [0, 3, 5, 10];

interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

interface DeviceOption {
	deviceId: string;
	label: string;
}

function DropdownItem({
	onClick,
	selected,
	icon,
	children,
	trailing,
}: {
	onClick: () => void;
	selected?: boolean;
	icon: ReactNode;
	children: ReactNode;
	trailing?: ReactNode;
}) {
	return (
		<button
			type="button"
			className={`${styles.ddItem} ${selected ? styles.ddItemSelected : ""}`}
			onClick={onClick}
		>
			<span className="shrink-0">{icon}</span>
			<span className="truncate">{children}</span>
			{trailing}
		</button>
	);
}

function MicDeviceRow({
	device,
	selected,
	onSelect,
}: {
	device: DeviceOption;
	selected: boolean;
	onSelect: () => void;
}) {
	const { level } = useAudioLevelMeter({
		enabled: true,
		deviceId: device.deviceId,
	});

	return (
		<button
			type="button"
			className={`${styles.ddItem} ${selected ? styles.ddItemSelected : ""}`}
			onClick={onSelect}
		>
			<span className="shrink-0">{selected ? <Mic size={16} /> : <MicOff size={16} />}</span>
			<span className="truncate flex-1">{device.label}</span>
			<AudioLevelMeter level={level} className="w-16 shrink-0" />
		</button>
	);
}

function HudPopover({
	open,
	onOpenChange,
	trigger,
	children,
	align = "center",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactNode;
	children: ReactNode;
	align?: "start" | "center" | "end";
}) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				className={`${styles.menuCard} ${styles.electronNoDrag}`}
				side="bottom"
				align={align}
				sideOffset={8}
				avoidCollisions
				collisionPadding={10}
				usePortal={false}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}

export function SourcePopover({
	open,
	onOpenChange,
	trigger,
	screenSources,
	windowSources,
	selectedSource,
	loading,
	onSourceSelect,
	onFetchSources,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactNode;
	screenSources: DesktopSource[];
	windowSources: DesktopSource[];
	selectedSource: string;
	loading: boolean;
	onSourceSelect: (source: DesktopSource) => void;
	onFetchSources: () => Promise<void>;
}) {
	return (
		<SourceSelector
			screenSources={screenSources}
			windowSources={windowSources}
			selectedSource={selectedSource}
			loading={loading}
			onSourceSelect={onSourceSelect}
			onFetchSources={onFetchSources}
			open={open}
			onOpenChange={onOpenChange}
		>
			{trigger}
		</SourceSelector>
	);
}

export function MicPopover({
	open,
	onOpenChange,
	trigger,
	systemAudioEnabled,
	onToggleSystemAudio,
	microphoneEnabled,
	onDisableMicrophone,
	devices,
	microphoneDeviceId,
	selectedDeviceId,
	onSelectDevice,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactNode;
	systemAudioEnabled: boolean;
	onToggleSystemAudio: () => void;
	microphoneEnabled: boolean;
	onDisableMicrophone: () => void;
	devices: DeviceOption[];
	microphoneDeviceId?: string;
	selectedDeviceId?: string;
	onSelectDevice: (deviceId: string) => void;
}) {
	const t = useScopedT("launch");

	return (
		<HudPopover open={open} onOpenChange={onOpenChange} trigger={trigger} align="start">
			<div className={styles.ddLabel}>{t("recording.microphone")}</div>
			<DropdownItem
				icon={systemAudioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
				selected={systemAudioEnabled}
				onClick={onToggleSystemAudio}
			>
				{systemAudioEnabled
					? t("recording.disableSystemAudio")
					: t("recording.enableSystemAudio")}
			</DropdownItem>
			{microphoneEnabled && (
				<DropdownItem icon={<MicOff size={16} />} onClick={onDisableMicrophone}>
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
						(microphoneDeviceId === device.deviceId || selectedDeviceId === device.deviceId)
					}
					onSelect={() => onSelectDevice(device.deviceId)}
				/>
			))}
			{devices.length === 0 && (
				<div className="text-center text-xs text-[#6b6b78] py-4">
					{t("recording.noMicrophonesFound")}
				</div>
			)}
		</HudPopover>
	);
}

export function WebcamPopover({
	open,
	onOpenChange,
	trigger,
	webcamEnabled,
	onDisableWebcam,
	canToggleFloatingPreview,
	showFloatingWebcamPreview,
	onToggleFloatingPreview,
	showWebcamControls,
	setWebcamPreviewNode,
	videoDevices,
	webcamDeviceId,
	selectedVideoDeviceId,
	onSelectVideoDevice,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactNode;
	webcamEnabled: boolean;
	onDisableWebcam: () => void;
	canToggleFloatingPreview: boolean;
	showFloatingWebcamPreview: boolean;
	onToggleFloatingPreview: () => void;
	showWebcamControls: boolean;
	setWebcamPreviewNode: (node: HTMLVideoElement | null) => void;
	videoDevices: DeviceOption[];
	webcamDeviceId?: string;
	selectedVideoDeviceId?: string;
	onSelectVideoDevice: (deviceId: string) => void;
}) {
	const t = useScopedT("launch");

	return (
		<HudPopover open={open} onOpenChange={onOpenChange} trigger={trigger} align="center">
			<div className={styles.ddLabel}>{t("recording.webcam")}</div>
			{webcamEnabled && (
				<>
					<DropdownItem icon={<VideoOff size={16} />} onClick={onDisableWebcam}>
						{t("recording.turnOffWebcam")}
					</DropdownItem>
					{canToggleFloatingPreview ? (
						<DropdownItem
							icon={showFloatingWebcamPreview ? <EyeOff size={16} /> : <Eye size={16} />}
							selected={showFloatingWebcamPreview}
							onClick={onToggleFloatingPreview}
						>
							{showFloatingWebcamPreview
								? t("recording.hideFloatingWebcamPreview")
								: t("recording.showFloatingWebcamPreview")}
						</DropdownItem>
					) : null}
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
						(webcamDeviceId === device.deviceId || selectedVideoDeviceId === device.deviceId) ? (
							<Video size={16} />
						) : (
							<VideoOff size={16} />
						)
					}
					selected={
						webcamEnabled &&
						(webcamDeviceId === device.deviceId || selectedVideoDeviceId === device.deviceId)
					}
					onClick={() => onSelectVideoDevice(device.deviceId)}
				>
					{device.label}
				</DropdownItem>
			))}
			{videoDevices.length === 0 && (
				<div className="text-center text-xs text-[#6b6b78] py-4">
					{t("recording.noWebcamsFound")}
				</div>
			)}
		</HudPopover>
	);
}

export function CountdownPopover({
	open,
	onOpenChange,
	trigger,
	countdownDelay,
	onSelectDelay,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactNode;
	countdownDelay: number;
	onSelectDelay: (delay: number) => void;
}) {
	const t = useScopedT("launch");

	return (
		<HudPopover open={open} onOpenChange={onOpenChange} trigger={trigger} align="center">
			<div className={styles.ddLabel}>{t("recording.countdownDelay")}</div>
			{COUNTDOWN_OPTIONS.map((delay) => (
				<DropdownItem
					key={delay}
					icon={<Timer size={16} />}
					selected={countdownDelay === delay}
					onClick={() => onSelectDelay(delay)}
				>
					{delay === 0 ? t("recording.noDelay") : `${delay}s`}
				</DropdownItem>
			))}
		</HudPopover>
	);
}

export function MorePopover({
	open,
	onOpenChange,
	trigger,
	supportsHudCaptureProtection,
	hideHudFromCapture,
	onToggleHudCaptureProtection,
	onChooseRecordingsDirectory,
	onOpenVideoFile,
	onOpenProjectBrowser,
	showDevUpdatePreview,
	onPreviewUpdateUi,
	appVersion,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactNode;
	supportsHudCaptureProtection: boolean;
	hideHudFromCapture: boolean;
	onToggleHudCaptureProtection: () => void;
	onChooseRecordingsDirectory: () => void;
	onOpenVideoFile: () => void;
	onOpenProjectBrowser: () => void;
	showDevUpdatePreview: boolean;
	onPreviewUpdateUi: () => void;
	appVersion: string | null;
}) {
	const t = useScopedT("launch");
	const { locale, setLocale } = useI18n();

	return (
		<HudPopover open={open} onOpenChange={onOpenChange} trigger={trigger} align="end">
			{supportsHudCaptureProtection && (
				<DropdownItem
					icon={hideHudFromCapture ? <EyeOff size={16} /> : <Eye size={16} />}
					selected={hideHudFromCapture}
					onClick={onToggleHudCaptureProtection}
				>
					{hideHudFromCapture
						? t("recording.hideHudFromVideo")
						: t("recording.showHudInVideo")}
				</DropdownItem>
			)}
			<DropdownItem icon={<FolderOpen size={16} />} onClick={onChooseRecordingsDirectory}>
				{t("recording.recordingsFolder")}
			</DropdownItem>
			<DropdownItem icon={<VideoIcon size={16} />} onClick={onOpenVideoFile}>
				{t("recording.openVideoFile")}
			</DropdownItem>
			<DropdownItem icon={<FolderOpen size={16} />} onClick={onOpenProjectBrowser}>
				{t("recording.openProject")}
			</DropdownItem>
			{showDevUpdatePreview ? (
				<DropdownItem icon={<RefreshCw size={16} />} onClick={onPreviewUpdateUi}>
					{t("recording.previewUpdateUi", "Preview Update UI")}
				</DropdownItem>
			) : null}
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
						onOpenChange(false);
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
		</HudPopover>
	);
}
