import { LocalizedError } from "@/components/feedback/LocalizedError";
import { ProgressBar } from "@heroui/react";
import { CheckCircleIcon, DownloadSimpleIcon, WarningCircleIcon } from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import styles from "./AppUpdateButton.module.css";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Payload = Awaited<ReturnType<Window["electronAPI"]["getCurrentUpdateToastPayload"]>>;

export function AppUpdateButton() {
	const { t, locale } = useI18n();
	const [payload, setPayload] = useState<Payload>(null);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [friendlyError, setFriendlyError] = useState(false);
	const [dismissing, setDismissing] = useState(false);
	const dismissPending = useRef(false);
	const pending = useRef(false);
	useEffect(() => {
		let active = true;
		let revision = 0;
		const dispose = window.electronAPI.onUpdateToastStateChanged?.((next) => {
			revision++;
			if (active) {
				setPayload(next);
				if (!next) setOpen(false);
				setError(null);
			}
		});
		const refresh = async () => {
			const requestedRevision = revision;
			try {
				const next = await window.electronAPI.getCurrentUpdateToastPayload();
				if (active && revision === requestedRevision) setPayload(next);
			} catch {
				/* Keep the last known state if the bridge is temporarily unavailable. */
			}
		};
		void refresh();
		window.addEventListener("focus", refresh);
		return () => {
			active = false;
			dispose?.();
			window.removeEventListener("focus", refresh);
		};
	}, []);
	if (!payload) return null;
	const downloading = payload.phase === "downloading";
	const ready = payload.phase === "ready";
	const progress = Math.max(0, Math.min(100, payload.progressPercent ?? 0));
	const StatusIcon = ready
		? CheckCircleIcon
		: payload.phase === "error"
			? WarningCircleIcon
			: DownloadSimpleIcon;
	const label = ready
		? t("launch.updateToast.restartToUpdate", "Restart to update")
		: downloading
			? t("updates.downloadingButton", "Downloading · {{progress}}", {
					progress: new Intl.NumberFormat(locale, {
						style: "percent",
						maximumFractionDigits: 0,
					}).format(progress / 100),
				})
			: t("launch.updateToast.availableTitle", "Update available");
	const run = async (
		action: () => Promise<{ success: boolean; message?: string; code?: string }>,
		dismiss = false,
	) => {
		const lock = dismiss ? dismissPending : pending;
		if (lock.current) return;
		lock.current = true;
		const setPending = dismiss ? setDismissing : setBusy;
		setPending(true);
		setError(null);
		setFriendlyError(false);
		try {
			const result = await action();
			if (!result.success) {
				setFriendlyError(result.code === "restart-blocked");
				throw new Error(
					result.message || t("updates.actionFailed", "Could not update. Try again."),
				);
			}
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			lock.current = false;
			setPending(false);
		}
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger>
				<span className="contents" title={label}>
					<Button
						variant="destructive"
						size="sm"
						className={`app-update-button editor-header-icon-button ${styles.trigger}`}
						aria-label={label}
					>
						<StatusIcon className="size-4" aria-hidden="true" />
						<span className="editor-header-button-label">{label}</span>
					</Button>
				</span>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				aria-label={t("updates.notification", "App update")}
				className={styles.card}
			>
				<div className={styles.message}>
					<div
						className={`${styles.icon} ${ready ? styles.ready : payload.phase === "error" ? styles.failed : ""}`}
					>
						<StatusIcon size={18} aria-hidden="true" />
					</div>
					<div className={styles.copy}>
						<p role="status" className={styles.title}>
							{downloading
								? t(
										"updates.backgroundProgress",
										"Downloading Recordly {{version}} in the background · {{progress}}",
										{
											version: payload.version,
											progress: new Intl.NumberFormat(locale, {
												style: "percent",
												maximumFractionDigits: 0,
											}).format(progress / 100),
										},
									)
								: ready
									? t(
											"updates.ready",
											"Recordly {{version}} is ready to install.",
											{
												version: payload.version,
											},
										)
									: payload.phase === "error"
										? t(
												"updates.failed",
												"The update could not finish. You can try again.",
											)
										: t(
												"updates.available",
												"Recordly {{version}} is available.",
												{
													version: payload.version,
												},
											)}
						</p>
						{downloading && (
							<ProgressBar
								className={styles.progress}
								aria-label={t("capture.downloadingUpdate")}
								value={progress}
							>
								<ProgressBar.Track>
									<ProgressBar.Fill />
								</ProgressBar.Track>
							</ProgressBar>
						)}
						{ready && (
							<p className="text-xs text-muted-foreground">
								{t(
									"updates.saveFirst",
									"Save your work, then restart when you’re ready.",
								)}
							</p>
						)}
						{error && (
							<p role="alert" className="text-danger">
								{friendlyError ? error : <LocalizedError error={error} />}
							</p>
						)}
					</div>
				</div>
				<div className={styles.actions}>
					<Button
						size="sm"
						variant="ghost"
						disabled={dismissing}
						onClick={() =>
							void run(() => window.electronAPI.dismissUpdateToast(), true)
						}
					>
						{t("updates.later", "Later")}
					</Button>
					{!downloading && (
						<Button
							size="sm"
							disabled={busy}
							onClick={() =>
								void run(() =>
									ready
										? window.electronAPI.installDownloadedUpdate()
										: payload.primaryAction === "retry-check"
											? window.electronAPI.checkForAppUpdates()
											: window.electronAPI.downloadAvailableUpdate(false),
								)
							}
						>
							{ready
								? t("launch.updateToast.restartToUpdate", "Restart to update")
								: payload.phase === "error"
									? t("launch.updateToast.tryAgain", "Try again")
									: t("updates.download", "Download update")}
						</Button>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
