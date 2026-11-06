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
	const [directory, setDirectory] = useState("");
	const [recordings, setRecordings] = useState("");
	const [hideHud, setHideHud] = useState<boolean>();
	const [captureSupported, setCaptureSupported] = useState(false);
	const [busy, setBusy] = useState<string>();
	const [feedback, setFeedback] = useState<{ area: string; error?: string; message?: string }>();
	const [reload, setReload] = useState(0);
	const [folderErrors, setFolderErrors] = useState<Record<string, string>>({});
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload explicitly retries location reads after a failure.
	useEffect(() => {
		let active = true;
		const loadFolder = async (
			area: string,
			get: () => Promise<{ success: boolean; path?: string }>,
			set: (path: string) => void,
		) => {
			try {
				const result = await get();
				if (!result.success || !result.path)
					throw Error(
						t(
							"settings.appPreferences.folderUnavailable",
							"Folder location is unavailable.",
						),
					);
				if (active) {
					set(result.path);
					setFolderErrors((errors) => ({ ...errors, [area]: "" }));
				}
			} catch (error) {
				if (active)
					setFolderErrors((errors) => ({
						...errors,
						[area]: error instanceof Error ? error.message : String(error),
					}));
			}
		};
		void loadFolder(
			"recordings",
			() => window.electronAPI.getRecordingsDirectory(),
			setRecordings,
		);
		void loadFolder("projects", () => window.electronAPI.getProjectsDirectory(), setDirectory);
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
				if (active) setFeedback({ area: "hud", error: String(error) });
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
	const openFolder = async (kind: "recordings" | "projects") => {
		const result = await (kind === "recordings"
			? window.electronAPI.openRecordingsFolder()
			: window.electronAPI.openProjectsDirectory());
		if (result && !result.success)
			throw Error(
				t("settings.appPreferences.openFolderFailed", "Could not open this folder."),
			);
	};
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
					<SettingsRow title={t("settings.appPreferences.appearance", "Appearance")}>
						<ThemeAppearancePicker compact />
					</SettingsRow>
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
					</header>
				</SettingsCategory>
				<SettingsCategory category="developer">
					<header className="dashboard-settings-group">
						<h2 className="flex items-center gap-1.5">
							{t("settings.effects.devSection", "Dev")}
							<SettingsInfo label={t("settings.effects.devSection", "Dev")}>
								{t(
									"settings.effects.devSectionHint",
									"Temporary testing controls for native capture and motion tuning.",
								)}
							</SettingsInfo>
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
				</SettingsCategory>
				<SettingsCategory category="general">
					<header className="dashboard-settings-group dashboard-settings-subgroup">
						<h2>{t("settings.appPreferences.storage", "Storage")}</h2>
					</header>
					<div className="settings-group">
						<div className="settings-item">
							<SettingsRow
								title={t(
									"settings.dashboard.recordingsFolder",
									"Recordings folder",
								)}
								help={<>
									{t(
									"settings.appPreferences.folderScope",
									"Changing this location affects future recordings. Existing files stay in their current folders.",
									)}
									<span className="mt-2 block break-all font-mono">
										{recordings ||
											folderErrors.recordings ||
											t(
												"settings.appPreferences.loadingFolder",
												"Loading folder location…",
											)}
									</span>
								</>}
							>
								<div className="settings-actions">
									<Button
										variant="secondary"
										size="sm"
										disabled={!recordings || Boolean(busy)}
										onClick={() =>
											void run("recordings", () => openFolder("recordings"))
										}
									>
										{t("settings.appPreferences.openFolder", "Open folder")}
									</Button>
									<Button
										variant="secondary"
										size="sm"
										disabled={Boolean(busy)}
										onClick={() =>
											void run("recordings", async () => {
												const result =
													await window.electronAPI.chooseRecordingsDirectory();
												if (result.canceled) return;
												if (!result.success || !result.path)
													throw Error(
														t(
															"settings.dashboard.changeFolderFailed",
															"Could not change recordings folder",
														),
													);
												setRecordings(result.path);
												setFolderErrors((errors) => ({
													...errors,
													recordings: "",
												}));
												setFeedback({
													area: "recordings",
													message: t(
														"settings.appPreferences.folderSaved",
														"New recordings will use this folder. Existing recordings have not been moved.",
													),
												});
											})
										}
									>
										{t("settings.dashboard.changeFolder", "Change folder")}
									</Button>
								</div>
							</SettingsRow>
							{status("recordings")}
						</div>
						<div className="settings-item">
							<SettingsRow
								title={t("settings.dashboard.projectsFolder", "Projects folder")}
								help={<>
									{t(
									"settings.dashboard.autosave",
									"Named projects save automatically.",
									)}
									<span className="mt-2 block break-all font-mono">
										{directory ||
											folderErrors.projects ||
											t(
												"settings.appPreferences.loadingFolder",
												"Loading folder location…",
											)}
									</span>
								</>}
							>
								<Button
									variant="secondary"
									size="sm"
									disabled={!directory || Boolean(busy)}
									onClick={() =>
										void run("projects", () => openFolder("projects"))
									}
								>
									{t("settings.appPreferences.openFolder", "Open folder")}
								</Button>
							</SettingsRow>
							{status("projects")}
						</div>
					</div>
					{(folderErrors.recordings || folderErrors.projects) && (
						<Button
							size="sm"
							variant="secondary"
							onClick={() => setReload((value) => value + 1)}
						>
							{t("settings.application.retry", "Try again")}
						</Button>
					)}
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
