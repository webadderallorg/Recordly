import {
	ArrowClockwiseIcon,
	DesktopIcon,
	EyeIcon,
	EyeSlashIcon,
	FolderOpenIcon,
	MicrophoneIcon,
	MoonIcon,
	PauseIcon,
	PlayIcon,
	SquareIcon,
	SunIcon,
	TranslateIcon,
	VideoCameraIcon,
} from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { formatBinding } from "@/lib/shortcuts";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "more";

const LOCALE_LABELS: Record<string, string> = {
	en: "English",
	es: "Español",
	fr: "Français",
	it: "Italiano",
	nl: "Nederlands",
	ko: "한국어",
	"pt-BR": "Português",
	"zh-CN": "簡體中文",
	"zh-TW": "繁體中文",
};

export function MorePopover({
	trigger,
	supportsHudCaptureProtection,
	hideHudFromCapture,
	recording,
	paused,
	countdownActive,
	onToggleHudCaptureProtection,
	onChooseRecordingsDirectory,
	onOpenVideoFile,
	onOpenProjectBrowser,
	onStartOrOpenSources,
	onStopRecording,
	onPauseRecording,
	onResumeRecording,
	onToggleMicrophoneMute,
	showDevUpdatePreview,
	onPreviewUpdateUi,
	appVersion,
}: {
	trigger: ReactElement;
	supportsHudCaptureProtection: boolean;
	hideHudFromCapture: boolean;
	recording: boolean;
	paused: boolean;
	countdownActive: boolean;
	onToggleHudCaptureProtection: () => void;
	onChooseRecordingsDirectory: () => void;
	onOpenVideoFile: () => void;
	onOpenProjectBrowser: () => void;
	onStartOrOpenSources: () => void;
	onStopRecording: () => void;
	onPauseRecording: () => void;
	onResumeRecording: () => void;
	onToggleMicrophoneMute: () => void;
	showDevUpdatePreview: boolean;
	onPreviewUpdateUi: () => void;
	appVersion: string | null;
}) {
	const t = useScopedT("launch");
	const { locale, setLocale } = useI18n();
	const { preference, setPreference } = useTheme();
	const { launchShortcuts, isMac } = useShortcuts();
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);
	const closePopover = () => requestClose(POPOVER_ID);

	const launchShortcutLabels = {
		startRecording: formatBinding(launchShortcuts.startRecording, isMac),
		stopRecording: formatBinding(launchShortcuts.stopRecording, isMac),
		pauseRecording: formatBinding(launchShortcuts.pauseRecording, isMac),
		resumeRecording: formatBinding(launchShortcuts.resumeRecording, isMac),
		muteMicrophone: formatBinding(launchShortcuts.muteMicrophone, isMac),
	} as const;

	const runMenuAction = (action: () => void) => {
		closePopover();
		action();
	};

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					closePopover();
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="end"
		>
			{recording ? (
				<>
					<DropdownItem
						icon={
							paused ? (
								<PlayIcon size={16} fill="currentColor" strokeWidth={0} />
							) : (
								<PauseIcon size={16} />
							)
						}
						onClick={() => runMenuAction(paused ? onResumeRecording : onPauseRecording)}
						trailing={
							paused
								? launchShortcutLabels.resumeRecording
								: launchShortcutLabels.pauseRecording
						}
					>
						{paused ? t("recording.resume") : t("recording.pause")}
					</DropdownItem>
					<DropdownItem
						icon={<SquareIcon size={14} fill="currentColor" strokeWidth={0} />}
						onClick={() => runMenuAction(onStopRecording)}
						trailing={launchShortcutLabels.stopRecording}
					>
						{t("recording.stop")}
					</DropdownItem>
					<DropdownItem
						icon={<MicrophoneIcon size={16} />}
						onClick={() => runMenuAction(onToggleMicrophoneMute)}
						trailing={launchShortcutLabels.muteMicrophone}
					>
						{t("recording.toggleMicrophoneMute", "Mute / Unmute Microphone")}
					</DropdownItem>
				</>
			) : (
				<DropdownItem
					icon={<PlayIcon size={16} fill="currentColor" strokeWidth={0} />}
					onClick={() => runMenuAction(onStartOrOpenSources)}
					disabled={countdownActive}
					trailing={launchShortcutLabels.startRecording}
				>
					{t("recording.startRecording", "Start Recording")}
				</DropdownItem>
			)}
			<div className="mx-2 my-1 h-px bg-[var(--launch-border)]" />
			{supportsHudCaptureProtection && (
				<DropdownItem
					icon={hideHudFromCapture ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
					selected={hideHudFromCapture}
					onClick={onToggleHudCaptureProtection}
				>
					{hideHudFromCapture
						? t("recording.hideHudFromVideo")
						: t("recording.showHudInVideo")}
				</DropdownItem>
			)}
			<DropdownItem
				icon={<FolderOpenIcon size={16} />}
				onClick={() => {
					closePopover();
					onChooseRecordingsDirectory();
				}}
			>
				{t("recording.recordingsFolder")}
			</DropdownItem>
			<DropdownItem
				icon={<VideoCameraIcon size={16} />}
				onClick={() => {
					closePopover();
					onOpenVideoFile();
				}}
			>
				{t("recording.openVideoFile")}
			</DropdownItem>
			<DropdownItem
				icon={<FolderOpenIcon size={16} />}
				onClick={() => {
					closePopover();
					onOpenProjectBrowser();
				}}
			>
				{t("recording.openProject")}
			</DropdownItem>
			{showDevUpdatePreview ? (
				<DropdownItem
					icon={<ArrowClockwiseIcon size={16} />}
					onClick={() => {
						closePopover();
						onPreviewUpdateUi();
					}}
				>
					{t("recording.previewUpdateUi", "Preview Update UI")}
				</DropdownItem>
			) : null}
			<div className={styles.ddLabel} style={{ marginTop: 4 }}>
				{t("recording.appearance", "Appearance")}
			</div>
			<DropdownItem
				icon={<SunIcon size={16} />}
				selected={preference === "light"}
				onClick={() => {
					setPreference("light");
					closePopover();
				}}
			>
				{t("common.light", "Light")}
			</DropdownItem>
			<DropdownItem
				icon={<MoonIcon size={16} />}
				selected={preference === "dark"}
				onClick={() => {
					setPreference("dark");
					closePopover();
				}}
			>
				{t("common.dark", "Dark")}
			</DropdownItem>
			<DropdownItem
				icon={<DesktopIcon size={16} />}
				selected={preference === "system"}
				onClick={() => {
					setPreference("system");
					closePopover();
				}}
			>
				{t("common.system", "System")}
			</DropdownItem>
			<div className={styles.ddLabel} style={{ marginTop: 4 }}>
				{t("recording.language")}
			</div>
			{SUPPORTED_LOCALES.map((code) => (
				<DropdownItem
					key={code}
					icon={<TranslateIcon size={16} />}
					selected={locale === code}
					onClick={() => {
						setLocale(code as AppLocale);
						closePopover();
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
						color: "var(--launch-text-muted)",
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
