import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { useI18n, useScopedT } from "../../../contexts/I18nContext";
import type { AppLocale } from "../../../i18n/config";
import { SUPPORTED_LOCALES } from "../../../i18n/config";
import { KeyboardShortcutsDialog } from "../TutorialHelp";
import { APP_LANGUAGE_LABELS, SectionLabel } from "../settingsPanelConstants";

interface GeneralSettingsSectionProps {
	connectZooms: boolean;
	onConnectZoomsChange?: (enabled: boolean) => void;
	autoApplyFreshRecordingAutoZooms: boolean;
	onAutoApplyFreshRecordingAutoZoomsChange?: (enabled: boolean) => void;
}

export function GeneralSettingsSection({
	connectZooms,
	onConnectZoomsChange,
	autoApplyFreshRecordingAutoZooms,
	onAutoApplyFreshRecordingAutoZoomsChange,
}: GeneralSettingsSectionProps) {
	const tSettings = useScopedT("settings");
	const { locale, setLocale, t } = useI18n();
	const { preference: themePreference, setPreference: setThemePreference } = useTheme();

	return (
		<div className="space-y-4">
			<section className="flex flex-col gap-2">
				<SectionLabel>{t("editor.theme.appearance", "Appearance")}</SectionLabel>
				<div className="flex rounded-lg border border-foreground/10 bg-foreground/5 p-0.5">
					{([
						{ value: "light" as const, label: t("editor.theme.light", "Light") },
						{ value: "dark" as const, label: t("editor.theme.dark", "Dark") },
						{ value: "system" as const, label: t("editor.theme.system", "System") },
					]).map((option) => (
						<button key={option.value} type="button"
							onClick={() => setThemePreference(option.value)}
							className={cn(
								"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
								themePreference === option.value
									? "bg-neutral-800 text-white shadow-sm dark:bg-white dark:text-black"
									: "text-muted-foreground hover:text-foreground",
							)}>
							{option.label}
						</button>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-2">
				<SectionLabel>{t("common.app.language", "Language")}</SectionLabel>
				<Select value={locale} onValueChange={(value) => setLocale(value as AppLocale)}>
					<SelectTrigger className="h-10 w-full rounded-xl border-foreground/10 bg-foreground/5 text-sm text-foreground hover:bg-foreground/10">
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="border-foreground/10 bg-editor-surface-alt text-foreground">
						{SUPPORTED_LOCALES.map((candidateLocale) => (
							<SelectItem key={candidateLocale} value={candidateLocale}>
								{APP_LANGUAGE_LABELS[candidateLocale]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</section>

			<section className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<div>
						<div className="text-[11px] font-medium text-foreground">
							{tSettings("effects.autoApplyFreshRecordingZooms", "Auto-apply fresh recording zooms")}
						</div>
						<div className="mt-0.5 text-[10px] text-muted-foreground/70">
							{tSettings("effects.autoApplyFreshRecordingZoomsDescription",
								"Suggest cursor-follow zooms automatically when you open a new recording.")}
						</div>
					</div>
					<Switch checked={autoApplyFreshRecordingAutoZooms}
						onCheckedChange={onAutoApplyFreshRecordingAutoZoomsChange}
						className="data-[state=checked]:bg-[#2563EB] scale-75" />
				</div>
				<div className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<div>
						<div className="text-[11px] font-medium text-foreground">
							{tSettings("effects.connectZooms", "Connect neighboring zooms")}
						</div>
						<div className="mt-0.5 text-[10px] text-muted-foreground/70">
							{tSettings("effects.connectZoomsDescription",
								"Smooth consecutive zoom regions into a continuous camera move.")}
						</div>
					</div>
					<Switch checked={connectZooms} onCheckedChange={onConnectZoomsChange}
						className="data-[state=checked]:bg-[#2563EB] scale-75" />
				</div>
			</section>

			<section className="flex flex-col gap-2">
				<SectionLabel>{t("editor.keyboardShortcuts.title")}</SectionLabel>
				<KeyboardShortcutsDialog
					triggerLabel={t("editor.keyboardShortcuts.customize")}
					triggerClassName="h-10 w-full justify-start rounded-xl border border-foreground/10 bg-foreground/5 px-3 text-sm text-foreground hover:bg-foreground/10 hover:text-foreground"
				/>
			</section>
		</div>
	);
}
