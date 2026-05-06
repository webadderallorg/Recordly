import {
	Eye,
	EyeSlash as EyeOff,
	FolderOpen,
	Translate as Languages,
	VideoCamera as VideoIcon,
	ArrowClockwise as RefreshCw,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useScopedT } from "@/contexts/I18nContext";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "more";

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
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);

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
					icon={hideHudFromCapture ? <EyeOff size={16} /> : <Eye size={16} />}
					selected={hideHudFromCapture}
					onClick={onToggleHudCaptureProtection}
				>
					{hideHudFromCapture
						? t("recording.hideHudFromVideo")
						: t("recording.showHudInVideo")}
				</DropdownItem>
			)}
			<DropdownItem
				icon={<FolderOpen size={16} />}
				onClick={() => {
					requestClose(POPOVER_ID);
					onChooseRecordingsDirectory();
				}}
			>
				{t("recording.recordingsFolder")}
			</DropdownItem>
			<DropdownItem
				icon={<VideoIcon size={16} />}
				onClick={() => {
					requestClose(POPOVER_ID);
					onOpenVideoFile();
				}}
			>
				{t("recording.openVideoFile")}
			</DropdownItem>
			<DropdownItem
				icon={<FolderOpen size={16} />}
				onClick={() => {
					requestClose(POPOVER_ID);
					onOpenProjectBrowser();
				}}
			>
				{t("recording.openProject")}
			</DropdownItem>
			{showDevUpdatePreview ? (
				<DropdownItem
					icon={<RefreshCw size={16} />}
					onClick={() => {
						requestClose(POPOVER_ID);
						onPreviewUpdateUi();
					}}
				>
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
