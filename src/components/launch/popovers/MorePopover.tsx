import {
	ArrowClockwiseIcon,
	DesktopIcon,
	EyeIcon,
	EyeSlashIcon,
	FolderOpenIcon,
	KeyboardIcon,
	MoonIcon,
	SunIcon,
	TranslateIcon,
	VideoCameraIcon,
} from "@phosphor-icons/react";
import { type ReactElement, useEffect, useState } from "react";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	formatRecordingAccelerator,
	RECORDING_SHORTCUT_ACTIONS,
	RECORDING_SHORTCUT_LABELS,
	type RecordingShortcutsConfig,
} from "@/lib/recordingShortcuts";
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
	onToggleHudCaptureProtection,
	onChooseRecordingsDirectory,
	onOpenVideoFile,
	onOpenProjectBrowser,
	showDevUpdatePreview,
	onPreviewUpdateUi,
	appVersion,
}: {
	trigger: ReactElement;
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
	const { preference, setPreference } = useTheme();
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);
	const [shortcuts, setShortcuts] = useState<RecordingShortcutsConfig>(
		DEFAULT_RECORDING_SHORTCUTS,
	);
	const isMac =
		typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		void window.electronAPI?.getRecordingShortcuts?.().then((config) => {
			if (!cancelled && config) {
				setShortcuts({ ...DEFAULT_RECORDING_SHORTCUTS, ...config });
			}
		});
		return () => {
			cancelled = true;
		};
	}, [open]);

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="end"
		>
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
					requestClose(POPOVER_ID);
					onChooseRecordingsDirectory();
				}}
			>
				{t("recording.recordingsFolder")}
			</DropdownItem>
			<DropdownItem
				icon={<VideoCameraIcon size={16} />}
				onClick={() => {
					requestClose(POPOVER_ID);
					onOpenVideoFile();
				}}
			>
				{t("recording.openVideoFile")}
			</DropdownItem>
			<DropdownItem
				icon={<FolderOpenIcon size={16} />}
				onClick={() => {
					requestClose(POPOVER_ID);
					onOpenProjectBrowser();
				}}
			>
				{t("recording.openProject")}
			</DropdownItem>
			{showDevUpdatePreview ? (
				<DropdownItem
					icon={<ArrowClockwiseIcon size={16} />}
					onClick={() => {
						requestClose(POPOVER_ID);
						onPreviewUpdateUi();
					}}
				>
					{t("recording.previewUpdateUi", "Preview Update UI")}
				</DropdownItem>
			) : null}
			<div className={styles.ddLabel} style={{ marginTop: 4 }}>
				{t("recording.shortcuts", "Recording shortcuts")}
			</div>
			{RECORDING_SHORTCUT_ACTIONS.map((action) => (
				<div
					key={action}
					className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--launch-text)]"
				>
					<KeyboardIcon size={14} className="shrink-0 opacity-70" />
					<span className="flex-1 truncate">
						{t(`recording.shortcut.${action}`, RECORDING_SHORTCUT_LABELS[action])}
					</span>
					<kbd className="shrink-0 rounded border border-[var(--launch-border)] bg-[var(--launch-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--launch-text-muted)]">
						{formatRecordingAccelerator(shortcuts[action], isMac)}
					</kbd>
				</div>
			))}
			<div className={styles.ddLabel} style={{ marginTop: 4 }}>
				{t("recording.appearance", "Appearance")}
			</div>
			<DropdownItem
				icon={<SunIcon size={16} />}
				selected={preference === "light"}
				onClick={() => {
					setPreference("light");
					requestClose(POPOVER_ID);
				}}
			>
				{t("common.light", "Light")}
			</DropdownItem>
			<DropdownItem
				icon={<MoonIcon size={16} />}
				selected={preference === "dark"}
				onClick={() => {
					setPreference("dark");
					requestClose(POPOVER_ID);
				}}
			>
				{t("common.dark", "Dark")}
			</DropdownItem>
			<DropdownItem
				icon={<DesktopIcon size={16} />}
				selected={preference === "system"}
				onClick={() => {
					setPreference("system");
					requestClose(POPOVER_ID);
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
						requestClose(POPOVER_ID);
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
