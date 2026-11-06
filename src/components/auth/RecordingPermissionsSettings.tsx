import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/video-editor/SettingsRow";
import { useI18n } from "@/contexts/I18nContext";

type Permission = "screen" | "accessibility" | "microphone" | "camera";
type PermissionStatus = "granted" | "denied" | "restricted" | "not-determined" | "unknown";
type PermissionSnapshot = { mac: boolean; values: Partial<Record<Permission, PermissionStatus>> };
const normalize = (status: string): PermissionStatus =>
	["granted", "denied", "restricted", "not-determined"].includes(status)
		? (status as PermissionStatus)
		: "unknown";

export function RecordingPermissionsSettings({ onReview }: { onReview?: () => void }) {
	const { t } = useI18n();
	const mounted = useRef(false);
	const pending = useRef(false);
	const [snapshot, setSnapshot] = useState<PermissionSnapshot>();
	const [busy, setBusy] = useState(false);
	const [opening, setOpening] = useState<Permission>();
	const [error, setError] = useState<string>();
	const [actionError, setActionError] = useState<{ permission: Permission; message: string }>();
	const refresh = useCallback(async () => {
		if (pending.current) return;
		pending.current = true;
		setBusy(true);
		try {
			const mac = (await window.electronAPI.getPlatform()) === "darwin";
			const values: PermissionSnapshot["values"] = {};
			let failed = false;
			const results = await Promise.allSettled([
				mac
					? window.electronAPI.getScreenRecordingPermissionStatus()
					: Promise.resolve(null),
				mac ? window.electronAPI.getAccessibilityPermissionStatus() : Promise.resolve(null),
				typeof window.electronAPI.getMediaPermissionStatus === "function"
					? window.electronAPI.getMediaPermissionStatus()
					: Promise.resolve(null),
			]);
			const [screen, accessibility, media] = results;
			if (mac) {
				if (screen.status === "fulfilled" && screen.value?.success)
					values.screen = normalize(screen.value.status);
				else {
					values.screen = "unknown";
					failed = true;
				}
				if (accessibility.status === "fulfilled" && accessibility.value?.success)
					values.accessibility = accessibility.value.trusted ? "granted" : "denied";
				else {
					values.accessibility = "unknown";
					failed = true;
				}
			}
			if (media.status === "fulfilled" && media.value?.success) {
				values.microphone = normalize(media.value.microphone);
				values.camera = normalize(media.value.camera);
			} else {
				values.microphone = "unknown";
				values.camera = "unknown";
				failed = true;
			}
			if (!mounted.current) return;
			setSnapshot({ mac, values });
			setError(
				failed
					? t(
							"settings.permissions.checkFailed",
							"Some permissions could not be checked. Try again.",
						)
					: undefined,
			);
		} catch {
			if (mounted.current) {
				setSnapshot(undefined);
				setError(
					t(
						"settings.permissions.checkFailed",
						"Some permissions could not be checked. Try again.",
					),
				);
			}
		} finally {
			pending.current = false;
			if (mounted.current) setBusy(false);
		}
	}, [t]);
	useEffect(() => {
		mounted.current = true;
		void refresh();
		const check = () => void refresh();
		const visible = () => {
			if (document.visibilityState === "visible") check();
		};
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", visible);
		return () => {
			mounted.current = false;
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", visible);
		};
	}, [refresh]);

	const openPreferences = async (permission: Permission) => {
		if (opening) return;
		setOpening(permission);
		setActionError(undefined);
		try {
			const result =
				permission === "screen"
					? await window.electronAPI.openScreenRecordingPreferences()
					: permission === "accessibility"
						? await window.electronAPI.openAccessibilityPreferences()
						: await window.electronAPI.openMediaPermissionPreferences(permission);
			if (!result.success) throw new Error();
			await refresh();
		} catch {
			if (mounted.current)
				setActionError({
					permission,
					message: t(
						"settings.permissions.openFailed",
						"Could not open System Settings. Try again.",
					),
				});
		} finally {
			if (mounted.current) setOpening(undefined);
		}
	};

	const requestMedia = async (permission: "microphone" | "camera") => {
		if (opening) return;
		setOpening(permission);
		setActionError(undefined);
		try {
			const result = await window.electronAPI.requestMediaPermission(permission);
			if (!result.success) throw new Error();
		} catch {
			if (mounted.current)
				setActionError({
					permission,
					message: t(
						"settings.permissions.requestFailed",
						"Could not request access. Try again or enable access in System Settings.",
					),
				});
		} finally {
			if (mounted.current) {
				await refresh();
				if (mounted.current) setOpening(undefined);
			}
		}
	};

	const permissionRows = [
		{
			id: "screen" as const,
			title: t("settings.permissions.screen", "Screen Recording"),
			description: t(
				"settings.permissions.screenDescription",
				"Capture your screen, windows and selected areas.",
			),
		},
		{
			id: "accessibility" as const,
			title: t("settings.permissions.accessibility", "Accessibility"),
			description: t(
				"settings.permissions.accessibilityDescription",
				"Track your cursor and highlight clicks.",
			),
		},
		{
			id: "microphone" as const,
			title: t("settings.permissions.microphone", "Microphone"),
			description: t(
				"settings.permissions.microphoneDescription",
				"Record your voice. Access is requested when you enable a microphone.",
			),
		},
		{
			id: "camera" as const,
			title: t("settings.permissions.camera", "Camera"),
			description: t(
				"settings.permissions.cameraDescription",
				"Include webcam video. Access is requested when you enable a camera.",
			),
		},
	];
	const statusLabel = (permission: Permission, status?: PermissionStatus) => {
		if (!status)
			return error
				? t("settings.permissions.unavailable", "Unavailable")
				: t("settings.permissions.checking", "Checking…");
		if (status === "granted") return t("settings.permissions.allowed", "Allowed");
		if (status === "not-determined")
			return t("settings.permissions.notRequested", "Not requested");
		if (status === "restricted") return t("settings.permissions.restricted", "Restricted");
		if (status === "denied")
			return permission === "accessibility"
				? t("settings.permissions.required", "Required")
				: t("settings.permissions.denied", "Not allowed");
		return t("settings.permissions.unknown", "Status unavailable");
	};

	return (
		<div className="app-settings-stack space-y-6" aria-busy={busy}>
			<header className="dashboard-settings-group settings-section-header">
				<div>
					<h2>{t("settings.categories.permissions", "Permissions")}</h2>
					<p>
						{t(
							"settings.permissions.description",
							"Manage access to your screen, microphone and camera.",
						)}
					</p>
				</div>
				<Button
					variant="secondary"
					size="sm"
					disabled={busy || !!opening}
					onClick={() => void refresh()}
				>
					{busy
						? t("settings.permissions.checking", "Checking…")
						: t("settings.permissions.checkAgain", "Check again")}
				</Button>
			</header>
			{snapshot && !snapshot.mac && (
				<p className="text-xs leading-relaxed text-muted">
					{t(
						"settings.permissions.systemManaged",
						"Choose what to capture when you start a recording. Device access is managed by your operating system.",
					)}
				</p>
			)}
			<div className="settings-group">
				{permissionRows
					.filter(
						({ id }) =>
							!snapshot || snapshot.mac || id === "microphone" || id === "camera",
					)
					.map(({ id, title, description }) => {
						const status = snapshot?.values[id];
						const canOpen =
							snapshot?.mac &&
							status !== undefined &&
							status !== "granted" &&
							status !== "restricted" &&
							(id === "screen" || id === "accessibility" || status === "denied");
						return (
							<div key={id} className="settings-item">
								<SettingsRow
									title={title}
									description={description}
									descriptionInline={status === "not-determined"}
									help={description}
								>
									<div className="flex flex-col items-end gap-2">
										<span
											role="status"
											aria-live="polite"
											className={`flex items-center gap-1.5 text-xs font-medium ${status === "granted" ? "text-success" : "text-muted"}`}
										>
											{status === "granted" ? (
												<CheckCircle aria-hidden size={15} />
											) : status === "denied" || status === "restricted" ? (
												<WarningCircle aria-hidden size={15} />
											) : null}
											{statusLabel(id, status)}
										</span>
										{snapshot?.mac &&
											status === "not-determined" &&
											(id === "microphone" || id === "camera") && (
												<Button
													variant="secondary"
													size="sm"
													disabled={!!opening || busy}
													onClick={() => void requestMedia(id)}
												>
													{id === "microphone"
														? t(
																"settings.permissions.allowMicrophone",
																"Allow microphone",
															)
														: t(
																"settings.permissions.allowCamera",
																"Allow camera",
															)}
												</Button>
											)}
										{canOpen && (
											<Button
												variant="secondary"
												size="sm"
												disabled={!!opening || busy}
												onClick={() => void openPreferences(id)}
												aria-label={`${t("settings.permissions.openSystemSettings", "Open System Settings")}: ${title}`}
											>
												{opening === id
													? t("settings.permissions.opening", "Opening…")
													: t(
															"settings.permissions.openSystemSettings",
															"Open System Settings",
														)}
											</Button>
										)}
									</div>
								</SettingsRow>
								{actionError?.permission === id && (
									<p role="alert" className="settings-row-note text-danger">
										{actionError.message}{" "}
										<ErrorReportButton error={actionError.message} />
									</p>
								)}
								{status === "restricted" && (
									<p className="settings-row-note text-muted">
										{t(
											"settings.permissions.restrictedDescription",
											"Your device administrator may need to allow this permission.",
										)}
									</p>
								)}
							</div>
						);
					})}
			</div>
			{error && (
				<p role="alert" className="text-xs text-danger">
					{error} <ErrorReportButton error={error} />
				</p>
			)}
			{onReview && (
				<Button variant="secondary" size="sm" className="self-start" onClick={onReview}>
					{t("settings.permissions.reviewSetup", "Review permission setup")}
				</Button>
			)}
		</div>
	);
}
