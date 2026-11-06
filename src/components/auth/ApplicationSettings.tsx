import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Button, Switch } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SettingsRow } from "@/components/video-editor/SettingsRow";
import { useI18n } from "@/contexts/I18nContext";

type Preferences = Awaited<ReturnType<Window["electronAPI"]["getApplicationPreferences"]>>;
type PreferencePatch = Parameters<Window["electronAPI"]["setApplicationPreferences"]>[0];

/** Preferences describe saved behavior, even while recording temporarily hides the app. */
export function ApplicationSettings() {
	const { t } = useI18n();
	const [preferences, setPreferences] = useState<Preferences | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pending = useRef(false);
	const mounted = useRef(true);
	const run = useCallback(
		async (patch?: PreferencePatch) => {
			if (pending.current) return;
			pending.current = true;
			setBusy(true);
			try {
				if (
					typeof window.electronAPI.getApplicationPreferences !== "function" ||
					typeof window.electronAPI.setApplicationPreferences !== "function"
				)
					throw new Error(
						t(
							"settings.application.restart",
							"Restart Recordly to load application preferences.",
						),
					);
				const result = patch
					? await window.electronAPI.setApplicationPreferences(patch)
					: await window.electronAPI.getApplicationPreferences();
				if (!result.success)
					throw new Error(
						result.error ||
							t(
								"settings.application.updateFailed",
								"Could not update application preferences. Try again.",
							),
					);
				if (!mounted.current) return;
				setPreferences(result);
				setError(null);
			} catch (failure) {
				if (mounted.current)
					setError(failure instanceof Error ? failure.message : String(failure));
			} finally {
				pending.current = false;
				if (mounted.current) setBusy(false);
			}
		},
		[t],
	);
	useEffect(() => {
		mounted.current = true;
		void run();
		const refresh = () => void run();
		window.addEventListener("focus", refresh);
		return () => {
			mounted.current = false;
			window.removeEventListener("focus", refresh);
		};
	}, [run]);
	const isMac = preferences?.platform === "darwin";
	const showLabel = isMac
		? t("settings.application.showDock", "Show Recordly in the Dock")
		: t("settings.application.showTaskbar", "Show Recordly in the taskbar");
	const hideLabel = isMac
		? t("settings.application.hideDock", "Hide from Dock while recording")
		: t("settings.application.hideTaskbar", "Hide from taskbar while recording");
	const toggle = (
		label: string,
		description: string,
		selected: boolean,
		disabled: boolean,
		onChange: (selected: boolean) => void,
	) => (
		<Switch
			aria-label={label}
			isSelected={selected}
			isDisabled={busy || disabled}
			onChange={onChange}
			className="application-preference-switch"
		>
			<SettingsRow title={label} description={description}>
				<Switch.Content>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
				</Switch.Content>
			</SettingsRow>
		</Switch>
	);
	return (
		<div className="application-preferences space-y-3">
			{!preferences && !error && (
				<p role="status" className="text-xs text-muted">
					{t("settings.application.loading", "Loading application preferences…")}
				</p>
			)}
			{preferences && (
				<>
					<header className="dashboard-settings-group dashboard-settings-subgroup">
						<h2>{t("settings.application.behavior", "App behavior")}</h2>
					</header>
					<div className="settings-group">
						{toggle(
							showLabel,
							isMac
								? t(
										"settings.application.dockDescription",
										"Keep Recordly available in the Dock while the app is open.",
									)
								: t(
										"settings.application.taskbarDescription",
										"Keep Recordly available in the taskbar while the app is open.",
									),
							preferences.showInDock,
							false,
							(showInDock) => void run({ showInDock }),
						)}
						<div className="settings-dependent-row">
							{toggle(
								hideLabel,
								!preferences.showInDock
									? isMac
										? t(
												"settings.application.hideDockDependency",
												"Turn on Show Recordly in the Dock to use this option.",
											)
										: t(
												"settings.application.hideTaskbarDependency",
												"Turn on Show Recordly in the taskbar to use this option.",
											)
									: isMac
										? t(
												"settings.application.menuBarDescription",
												"Recording controls stay available in the menu bar and on screen.",
											)
										: t(
												"settings.application.trayDescription",
												"Recording controls stay available in the system tray and on screen.",
											),
								preferences.hideWhileRecording,
								!preferences.showInDock,
								(hideWhileRecording) => void run({ hideWhileRecording }),
							)}
						</div>
					</div>
					{preferences.launchAtLoginSupported && (
						<div className="settings-group">
							{toggle(
								t("settings.application.launch", "Launch at login"),
								t(
									"settings.application.launchDescription",
									"Open Recordly automatically when you sign in to your computer.",
								),
								preferences.launchAtLogin,
								false,
								(launchAtLogin) => void run({ launchAtLogin }),
							)}
						</div>
					)}
				</>
			)}
			{error && (
				<div className="flex items-center justify-between gap-3">
					<p role="alert" className="text-xs text-danger">
						{error} <ErrorReportButton error={error} />
					</p>
					<Button
						variant="secondary"
						size="sm"
						isDisabled={busy}
						onPress={() => void run()}
					>
						{t("settings.application.retry", "Try again")}
					</Button>
				</div>
			)}
		</div>
	);
}
