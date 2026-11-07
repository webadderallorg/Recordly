import { ProgressBar } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { LocalizedError } from "@/components/feedback/LocalizedError";
import { Button } from "@/components/ui/button";
import {
	ArrowClockwiseIcon,
	CheckCircleIcon,
	DownloadSimpleIcon,
	WarningCircleIcon,
} from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/contexts/I18nContext";
import { SettingsInfo } from "../SettingsInfo";
import { SettingsRow } from "../SettingsRow";
import styles from "./AppUpdateSettings.module.css";

type Summary = Awaited<ReturnType<Window["electronAPI"]["getUpdateStatusSummary"]>>;

export function AppUpdateSettings() {
	const { t, locale } = useI18n();
	const [summary, setSummary] = useState<Summary>();
	const [version, setVersion] = useState("");
	const [experimental, setExperimental] = useState<boolean>();
	const [automaticDownloads, setAutomaticDownloads] = useState<boolean>();
	const [downloadPreferenceError, setDownloadPreferenceError] = useState<string>();
	const downloadPreferenceRevision = useRef(0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [friendlyError, setFriendlyError] = useState(false);
	const [channelError, setChannelError] = useState<{ message: string; cause?: string }>();
	const mounted = useRef(false);
	const root = useRef<HTMLDivElement>(null);
	const pending = useRef(false);
	const summaryRevision = useRef(0);
	const refresh = useCallback(async () => {
		const revision = ++summaryRevision.current;
		try {
			const next = await window.electronAPI.getUpdateStatusSummary();
			if (mounted.current && summaryRevision.current === revision) {
				setSummary(next);
				setError(undefined);
			}
		} catch {
			if (mounted.current)
				setError(
					t(
						"settings.appPreferences.updateUnavailable",
						"Update status is unavailable. Try again.",
					),
				);
		}
	}, [t]);
	const loadChannel = useCallback(async () => {
		try {
			const enabled = await window.electronAPI.getExperimentalUpdatesEnabled();
			if (mounted.current) {
				setExperimental(enabled);
				setChannelError(undefined);
			}
		} catch (cause) {
			if (mounted.current)
				setChannelError({
					message: t(
						"settings.updates.loadFailed",
						"Could not load the update channel. Try again.",
					),
					cause: cause instanceof Error ? cause.message : String(cause),
				});
		}
	}, [t]);
	const loadDownloadPreference = useCallback(async () => {
		const revision = downloadPreferenceRevision.current;
		try {
			const enabled = await window.electronAPI.getAutomaticUpdateDownloadsEnabled();
			if (mounted.current && revision === downloadPreferenceRevision.current) {
				setAutomaticDownloads(enabled);
				setDownloadPreferenceError(undefined);
			}
		} catch {
			if (mounted.current && revision === downloadPreferenceRevision.current) {
				setDownloadPreferenceError(
					t(
						"settings.updates.downloadPreferenceFailed",
						"Could not load or save automatic update downloads. Try again.",
					),
				);
			}
		}
	}, [t]);
	useEffect(() => {
		mounted.current = true;
		void refresh();
		void loadChannel();
		void loadDownloadPreference();
		void window.electronAPI
			.getAppVersion()
			.then((value) => {
				if (mounted.current) setVersion(value);
			})
			.catch(() => {
				/* The updater summary may still provide the installed version. */
			});
		const focus = () => {
			if (!root.current?.closest("[hidden]")) {
				void refresh();
				void loadChannel();
				void loadDownloadPreference();
			}
		};
		const dispose = window.electronAPI.onUpdateToastStateChanged?.(() => void refresh());
		window.addEventListener("focus", focus);
		return () => {
			mounted.current = false;
			dispose?.();
			window.removeEventListener("focus", focus);
		};
	}, [refresh, loadChannel, loadDownloadPreference]);
	useEffect(() => {
		if (
			summary?.status !== "checking" &&
			summary?.status !== "downloading" &&
			summary?.status !== "available"
		)
			return;
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible" && !root.current?.closest("[hidden]"))
				void refresh();
		}, 3000);
		return () => clearInterval(timer);
	}, [summary?.status, refresh]);
	const run = async (
		action: () => Promise<void>,
		area: "updates" | "channel" | "downloads" = "updates",
	) => {
		if (pending.current) return;
		pending.current = true;
		setBusy(true);
		setFriendlyError(false);
		if (area === "channel") setChannelError(undefined);
		else if (area === "downloads") setDownloadPreferenceError(undefined);
		else setError(undefined);
		try {
			await action();
			await refresh();
		} catch (error) {
			if (mounted.current) {
				if (area === "channel")
					setChannelError({
						message: error instanceof Error ? error.message : String(error),
					});
				else if (area === "downloads")
					setDownloadPreferenceError(
						t(
							"settings.updates.downloadPreferenceFailed",
							"Could not load or save automatic update downloads. Try again.",
						),
					);
				else setError(error instanceof Error ? error.message : String(error));
				setSummary((current) =>
					current?.status === "checking" ? { ...current, status: "error" } : current,
				);
			}
		} finally {
			pending.current = false;
			if (mounted.current) setBusy(false);
		}
	};
	const statuses: Record<Summary["status"], string> = {
		idle: t("settings.appPreferences.updateIdle", "Ready to check for updates."),
		checking: t("settings.appPreferences.updateChecking", "Checking for updates…"),
		"up-to-date": t("settings.appPreferences.updateCurrent", "Recordly is up to date."),
		available: t("capture.updateAvailableDetail"),
		downloading: t("capture.updateDownloadingDetail"),
		ready: t("updates.saveFirst", "Save your work, then restart when you’re ready."),
		error: summary?.availableVersion
			? t("updates.failed", "The update could not finish. You can try again.")
			: t("settings.appPreferences.updateFailed", "Could not check for updates. Try again."),
	};
	const ready = summary?.status === "ready";
	const available =
		summary?.status === "available" ||
		(summary?.status === "error" && Boolean(summary.availableVersion));
	const downloading = summary?.status === "downloading";
	const checking = summary?.status === "checking";
	const progress =
		typeof summary?.progressPercent === "number" && Number.isFinite(summary.progressPercent)
			? Math.max(0, Math.min(100, summary.progressPercent))
			: undefined;
	const StatusIcon =
		summary?.status === "error"
			? WarningCircleIcon
			: ready || summary?.status === "up-to-date"
				? CheckCircleIcon
				: downloading || checking
					? ArrowClockwiseIcon
					: DownloadSimpleIcon;

	const statusTitle = ready
		? t("updates.ready", "Recordly {{version}} is ready to install.", {
				version: summary.availableVersion ?? "",
			})
		: available
			? t("updates.available", "Recordly {{version}} is available.", {
					version: summary.availableVersion ?? "",
				})
			: downloading
				? t("launch.updateToast.downloadingTitle", "Downloading your update")
				: checking
					? t("settings.appPreferences.updateChecking", "Checking for updates…")
					: summary?.status === "up-to-date"
						? statuses["up-to-date"]
						: summary?.status === "error"
							? t("launch.updateToast.checkErrorTitle", "Couldn’t check for updates")
							: statuses.idle;

	const check = async () => {
		setSummary((current) => ({
			currentVersion: version,
			availableVersion: null,
			...current,
			status: "checking",
		}));
		const result = await window.electronAPI.checkForAppUpdates();
		if (!result.success)
			throw Error(
				t(
					"settings.appPreferences.updateFailed",
					"Could not check for updates. Try again.",
				),
			);
	};
	const update = async () => {
		const result = ready
			? await window.electronAPI.installDownloadedUpdate()
			: await window.electronAPI.downloadAvailableUpdate(false);
		if (!result.success) {
			setFriendlyError("code" in result && result.code === "restart-blocked");
			throw Error(
				result.message || t("updates.actionFailed", "Could not update. Try again."),
			);
		}
	};

	return (
		<div ref={root} className={`${styles.updates} app-settings-stack`}>
			<header className={`${styles.header} dashboard-settings-group`}>
				<h2 className="flex items-center gap-1.5">
					{t("settings.updates.title", "Updates")}
					<SettingsInfo label={t("settings.updates.title", "Updates")}>
						{t(
							"settings.appPreferences.updatesDescription",
							"Choose how updates download. Restart when you’re ready.",
						)}
					</SettingsInfo>
				</h2>
			</header>

			<section className={styles.status} aria-label={t("updates.notification", "App update")}>
				<div className={styles.versionRow}>
					<div className={styles.rowLabel}>
						<h3>
							{t("settings.appPreferences.installedVersion", "Installed version")}
						</h3>
						<p>
							{version ||
								summary?.currentVersion ||
								t("settings.appPreferences.loadingVersion", "Loading version…")}
						</p>
					</div>
					<div className={styles.actions}>
						<Button
							size="sm"
							variant={ready || available ? "default" : "secondary"}
							disabled={busy || checking || downloading || !summary}
							onClick={() => void run(ready || available ? update : check)}
						>
							{downloading
								? t(
										"settings.appPreferences.updateDownloading",
										"Downloading an update…",
									)
								: checking
									? t(
											"settings.appPreferences.updateChecking",
											"Checking for updates…",
										)
									: ready
										? t(
												"launch.updateToast.restartToUpdate",
												"Restart to update",
											)
										: available
											? t("updates.download", "Download update")
											: t(
													"settings.appPreferences.checkUpdates",
													"Check for updates",
												)}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const result = await window.electronAPI.openExternalUrl(
										"https://github.com/webadderallorg/Recordly/releases",
									);
									if (!result.success)
										throw Error(
											t(
												"settings.appPreferences.openReleaseFailed",
												"Could not open release notes.",
											),
										);
								})
							}
						>
							{t("settings.appPreferences.releaseNotes", "Release notes")}
						</Button>
					</div>
				</div>
				{((summary && summary.status !== "idle") || error) && (
					<div className={styles.statusContent}>
						{summary && summary.status !== "idle" && (
							<div className={styles.statusHeading} role="status">
								<div
									className={`${styles.icon} ${ready || summary?.status === "up-to-date" ? styles.success : summary?.status === "error" ? styles.danger : ""}`}
								>
									<StatusIcon
										size={18}
										aria-hidden="true"
										className={
											checking || downloading ? styles.spin : undefined
										}
									/>
								</div>
								<div className={styles.copy}>
									<h3>{statusTitle}</h3>
								</div>
							</div>
						)}
						{summary &&
							["available", "downloading", "ready", "error"].includes(
								summary.status,
							) && (
								<p className={styles.detail}>
									{summary
										? statuses[summary.status]
										: t(
												"settings.appPreferences.updateLoading",
												"Loading update status…",
											)}
								</p>
							)}
						{downloading && (
							<div className={styles.progress}>
								<ProgressBar
									aria-label={t("capture.downloadingUpdate")}
									value={progress}
									isIndeterminate={progress === undefined}
								>
									<ProgressBar.Track>
										<ProgressBar.Fill />
									</ProgressBar.Track>
								</ProgressBar>
								{progress !== undefined && (
									<span>
										{new Intl.NumberFormat(locale, {
											style: "percent",
											maximumFractionDigits: 0,
										}).format(progress / 100)}
									</span>
								)}
							</div>
						)}

						{error && (
							<p role="alert" className={styles.error}>
								{friendlyError ? (
									error
								) : (
									<>
										<LocalizedError
											error={error}
											summary={
												summary?.status === "error"
													? statuses.error
													: undefined
											}
										/>{" "}
										<ErrorReportButton error={error} />
									</>
								)}
							</p>
						)}
					</div>
				)}
			</section>
			<div className={`${styles.preferences} settings-group`}>
				<SettingsRow
					title={t(
						"settings.updates.automaticDownloads",
						"Automatically download updates",
					)}
					description={t(
						"settings.updates.automaticDownloadsDescription",
						"Download new updates in the background. You choose when to restart.",
					)}
				>
					<Switch
						aria-label={t(
							"settings.updates.automaticDownloads",
							"Automatically download updates",
						)}
						checked={automaticDownloads ?? false}
						disabled={automaticDownloads === undefined || busy}
						onCheckedChange={(enabled) =>
							void run(async () => {
								downloadPreferenceRevision.current++;
								const result =
									await window.electronAPI.setAutomaticUpdateDownloadsEnabled(
										enabled,
									);
								if (!result.success)
									throw Error("Automatic update preference was not saved");
								if (mounted.current) setAutomaticDownloads(result.enabled);
							}, "downloads")
						}
					/>
				</SettingsRow>
				{downloadPreferenceError && (
					<div className="settings-row-note">
						<p role="alert" className="text-danger">
							{downloadPreferenceError}
						</p>
						{automaticDownloads === undefined && (
							<Button
								size="sm"
								variant="secondary"
								disabled={busy}
								onClick={() => void loadDownloadPreference()}
							>
								{t("settings.application.retry", "Try again")}
							</Button>
						)}
					</div>
				)}
			</div>
			<div className={`${styles.preferences} settings-group`}>
				<SettingsRow
					title={t("settings.updates.experimental", "Experimental updates")}
					description={t(
						"settings.appPreferences.experimentalDescription",
						"Receive preview builds before general release. They may be unstable. Turn this off to return to stable releases; the next compatible stable update will be offered.",
					)}
				>
					<Switch
						aria-label={t("settings.updates.experimental", "Experimental updates")}
						checked={experimental ?? false}
						disabled={experimental === undefined || busy}
						onCheckedChange={(enabled) =>
							void run(async () => {
								const result =
									await window.electronAPI.setExperimentalUpdatesEnabled(enabled);
								if (!result.success)
									throw Error(
										t(
											"settings.updates.saveFailed",
											"Failed to change the update channel.",
										),
									);
								if (mounted.current) setExperimental(result.enabled);
							}, "channel")
						}
					/>
				</SettingsRow>
				{channelError && (
					<div className="settings-row-note">
						<p role="alert" className="text-danger">
							{channelError.message}{" "}
							<ErrorReportButton
								error={[channelError.message, channelError.cause]
									.filter(Boolean)
									.join("\n")}
							/>
						</p>
						{experimental === undefined && (
							<Button
								size="sm"
								variant="secondary"
								disabled={busy}
								onClick={() => void loadChannel()}
							>
								{t("settings.application.retry", "Try again")}
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
