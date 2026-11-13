import { LocalizedError } from "@/components/feedback/LocalizedError";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/contexts/I18nContext";
import { supportsHudCaptureProtection } from "@/lib/hudCaptureProtection";
import { SettingsRow } from "../SettingsRow";
import { SettingsInfo } from "../SettingsInfo";
import { SettingsCategory, SettingsSections, type SettingsSection } from "../SettingsSections";
import { StorageLocationsSettings } from "../settings/StorageLocationsSettings";
import { ThemeAppearancePicker } from "./ThemeAppearancePicker";
import { AppUpdateSettings } from "./AppUpdateSettings";
import { SettingsSidebarFooter } from "./SettingsSidebarFooter";
import "./DashboardSettings.css";
export const DashboardSettingsContext = createContext<ReactNode>(null);
export function DashboardSettings({
	initialCategory = "general",
}: {
	onImportFile: () => Promise<void>;
	initialCategory?: SettingsSection;
}) {
	const { t } = useI18n();
	const settingsContent = useContext(DashboardSettingsContext);
	const [hideHud, setHideHud] = useState<boolean>();
	const [captureSupported, setCaptureSupported] = useState(false);
	const [busy, setBusy] = useState<string>();
	const [feedback, setFeedback] = useState<{ area: string; error?: string; message?: string }>();
	const [reload, setReload] = useState(0);
	const run = async (area: string, action: () => Promise<void>) => {
		if (busy) return;
		setBusy(area);
		setFeedback(undefined);
		try {
			await action();
		} catch (error) {
			setFeedback({ area, error: error instanceof Error ? error.message : String(error) });
		} finally {
			setBusy(undefined);
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload explicitly retries the HUD probe after a failure.
	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const [protection, platform] = await Promise.all([
					window.electronAPI.getHudOverlayCaptureProtection(),
					window.electronAPI.getPlatform(),
				]);
				if (!active) return;
				setCaptureSupported(supportsHudCaptureProtection(platform));
				if (!protection.success)
					throw Error(
						t(
							"settings.dashboard.captureProtectionFailed",
							"Could not load recording control visibility.",
						),
					);
				setHideHud(protection.enabled);
			} catch (error) {
				if (active)
					setFeedback({
						area: "hud",
						error: error instanceof Error ? error.message : String(error),
					});
			}
		})();
		return () => {
			active = false;
		};
	}, [t, reload]);
	const status = (area: string) =>
		feedback?.area === area ? (
			<p
				role={feedback.error ? "alert" : "status"}
				className={`settings-inline-feedback ${feedback.error ? "text-danger" : "text-success"}`}
			>
				{feedback.error ? <LocalizedError error={feedback.error} /> : feedback.message}
				{feedback.error && <ErrorReportButton error={feedback.error} context="settings" />}
			</p>
		) : null;
	return (
		<section
			aria-label={t("settings.dashboard.label", "Dashboard settings")}
			className="dashboard-settings"
		>
			<h1 className="dashboard-settings-title">
				{t("settings.dashboard.title", "Settings")}
			</h1>
			<SettingsSections
				variant="tabs"
				sidebarFooter={(select) => (
					<SettingsSidebarFooter onAccount={() => select("account")} />
				)}
				initialCategory={
					initialCategory === "appearance" ||
					initialCategory === "files" ||
					initialCategory === "updates"
						? "general"
						: initialCategory === "permissions"
							? "recording"
							: initialCategory
				}
				categories={[
					"general",
					"storage",
					"recording",
					"motion",
					"shortcuts",
					"account",
					...(import.meta.env.DEV ? ["developer" as const] : []),
				]}
			>
				<SettingsCategory category="general">
					<header className="dashboard-settings-group">
						<h2>{t("settings.categories.general", "General")}</h2>
					</header>
					<div className="settings-appearance">
						<SettingsRow
							title={t("settings.appPreferences.appearance", "Appearance")}
							stacked
						>
							<ThemeAppearancePicker />
						</SettingsRow>
					</div>
				</SettingsCategory>
				<SettingsCategory category="shortcuts">
					<header className="dashboard-settings-group">
						<h2 className="flex items-center gap-1.5">
							{t("settings.categories.shortcuts", "Shortcuts")}
							<SettingsInfo label={t("settings.categories.shortcuts", "Shortcuts")}>
								{t(
									"settings.appPreferences.shortcutsDescription",
									"Customize key bindings and review fixed shortcuts.",
								)}
							</SettingsInfo>
						</h2>
					</header>
				</SettingsCategory>
				<SettingsCategory category="account">
					<header className="dashboard-settings-group">
						<h2 className="flex items-center gap-1.5">
							{t("settings.account.title", "Account")}
							<SettingsInfo label={t("settings.account.title", "Account")}>
								{t(
									"settings.account.description",
									"Manage your profile and sign-in details.",
								)}
							</SettingsInfo>
						</h2>
					</header>
				</SettingsCategory>
				<SettingsCategory category="recording">
					<header className="dashboard-settings-group">
						<h2 className="flex items-center gap-1.5">
							{t("settings.categories.recording", "Recording")}
							<SettingsInfo label={t("settings.categories.recording", "Recording")}>
								{t(
									"settings.appPreferences.recordingDescription",
									"These preferences apply to new recordings.",
								)}
							</SettingsInfo>
						</h2>
					</header>
				</SettingsCategory>
				<SettingsCategory category="motion">
					<header className="dashboard-settings-group">
						<h2 className="flex items-center gap-1.5">
							{t("settings.categories.motion", "Motion")}
							<SettingsInfo label={t("settings.categories.motion", "Motion")}>
								{t(
									"settings.appPreferences.motionScope",
									"Changes affect this project and are remembered for new projects. Saved projects keep their own settings.",
								)}
							</SettingsInfo>
						</h2>
						<p>
							{t(
								"settings.appPreferences.motionScope",
								"Changes affect this project and are remembered for new projects. Saved projects keep their own settings.",
							)}
						</p>
					</header>
				</SettingsCategory>
				<SettingsCategory category="developer">
					<header className="dashboard-settings-group">
						<h2 className="flex items-center gap-1.5">
							{t("settings.effects.devSection", "Dev")}
						</h2>
					</header>
				</SettingsCategory>
				<SettingsCategory
					category={[
						"general",
						"shortcuts",
						"account",
						"permissions",
						"recording",
						"motion",
						"developer",
					]}
				>
					{settingsContent}
				</SettingsCategory>
				<SettingsCategory category="recording">
					{captureSupported && (
						<div className="settings-group">
							<SettingsRow
								title={t(
									"settings.appPreferences.hideControls",
									"Hide recording controls from captured video",
								)}
								description={t(
									"settings.appPreferences.hideControlsDescription",
									"Controls stay visible on your desktop but are excluded from the video while recording. When idle, they may appear in other screen captures.",
								)}
							>
								<Switch
									aria-label={t(
										"settings.appPreferences.hideControls",
										"Hide recording controls from captured video",
									)}
									checked={hideHud ?? true}
									disabled={Boolean(busy) || hideHud === undefined}
									onCheckedChange={(enabled) =>
										void run("hud", async () => {
											const result =
												await window.electronAPI.setHudOverlayCaptureProtection(
													enabled,
												);
											if (!result.success)
												throw Error(
													t(
														"settings.dashboard.captureProtectionFailed",
														"Could not update capture protection",
													),
												);
											setHideHud(result.enabled);
										})
									}
								/>
							</SettingsRow>
							{status("hud")}
						</div>
					)}
					{!captureSupported && status("hud")}
					{hideHud === undefined && feedback?.area === "hud" && feedback.error && (
						<Button
							size="sm"
							variant="secondary"
							onClick={() => {
								setFeedback(undefined);
								setReload((value) => value + 1);
							}}
						>
							{t("settings.application.retry", "Try again")}
						</Button>
					)}
				</SettingsCategory>
				<SettingsCategory category="storage">
					<header className="dashboard-settings-group dashboard-settings-subgroup">
						<h2>{t("settings.storage.title", "Storage locations")}</h2>
						<p>
							{t(
								"settings.storage.description",
								"Choose where Recordly saves each kind of file. New files use the folder you pick; existing files stay where they are.",
							)}
						</p>
					</header>
					<StorageLocationsSettings />
				</SettingsCategory>
				<SettingsCategory category="general">
					<AppUpdateSettings />
				</SettingsCategory>
				<SettingsCategory category="developer">
					{import.meta.env.DEV && (
						<div className="settings-group">
							<SettingsRow
								title={t("settings.dashboard.previewUpdates", "Preview update UI")}
							>
								<Button
									variant="secondary"
									size="sm"
									disabled={Boolean(busy)}
									onClick={() =>
										void run("preview", async () => {
											await window.electronAPI.previewUpdateToast();
										})
									}
								>
									{t("settings.dashboard.preview", "Preview")}
								</Button>
							</SettingsRow>
							{status("preview")}
						</div>
					)}
				</SettingsCategory>
			</SettingsSections>
		</section>
	);
}
