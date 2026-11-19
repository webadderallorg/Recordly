import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { LocalizedError } from "@/components/feedback/LocalizedError";
import { Card, Chip, ProgressBar } from "@heroui/react";
import {
	ArrowClockwiseIcon,
	CheckCircleIcon,
	DownloadSimpleIcon,
	WarningCircleIcon,
} from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import styles from "./UpdateToastWindow.module.css";

export type UpdateToastPayload = {
	version: string;
	detail: string;
	phase: "available" | "downloading" | "ready" | "error";
	delayMs: number;
	isPreview?: boolean;
	isExperimental?: boolean;
	progressPercent?: number;
	transferredBytes?: number;
	totalBytes?: number;
	bytesPerSecond?: number;
	primaryAction?: "install-and-restart" | "retry-check";
};

function formatBytes(value: number | undefined, locale: string) {
	if (value === undefined || !Number.isFinite(value) || value <= 0) {
		return null;
	}

	const megabytes = value / (1024 * 1024);
	return new Intl.NumberFormat(locale, {
		style: "unit",
		unit: megabytes >= 1024 ? "gigabyte" : "megabyte",
		maximumFractionDigits: megabytes >= 1024 || megabytes < 100 ? 1 : 0,
	}).format(megabytes >= 1024 ? megabytes / 1024 : megabytes);
}

type Translate = ReturnType<typeof useI18n>["t"];

function getTitle(payload: UpdateToastPayload, t: Translate) {
	switch (payload.phase) {
		case "available":
			return payload.isExperimental
				? t(
						"launch.updateToast.experimentalAvailableTitle",
						"Experimental update available",
					)
				: t("launch.updateToast.availableTitle", "Update available");
		case "downloading":
			return t("launch.updateToast.downloadingTitle", "Downloading your update");
		case "ready":
			return t("launch.updateToast.readyTitle", "Ready to restart");
		case "error":
			return payload.primaryAction === "retry-check"
				? t("launch.updateToast.checkErrorTitle", "Couldn’t check for updates")
				: t("launch.updateToast.downloadErrorTitle", "Couldn’t download the update");
	}
}

function getDetail(payload: UpdateToastPayload, t: Translate, captureT: Translate) {
	if (payload.isPreview) return captureT("updatePreviewDetail");
	if (payload.phase === "available" && payload.isExperimental) {
		return t(
			"launch.updateToast.experimentalDescription",
			"You've opted into experimental updates so you have the choice to test the latest update of Recordly before it's widely available.",
		);
	}

	switch (payload.phase) {
		case "available":
			return captureT("updateAvailableDetail");
		case "downloading":
			return captureT(
				(payload.progressPercent ?? 0) >= 100
					? "updateFinishingDetail"
					: "updateDownloadingDetail",
			);
		case "ready":
			return captureT("updateReadyDetail");
		case "error":
			return captureT(
				payload.primaryAction === "retry-check"
					? "updateCheckErrorDetail"
					: "updateErrorDetail",
			);
	}
}

function getPrimaryLabel(payload: UpdateToastPayload, t: Translate) {
	if (payload.primaryAction === "retry-check") {
		return t("launch.updateToast.tryAgain", "Try again");
	}
	return payload.phase === "ready"
		? t("launch.updateToast.restartToUpdate", "Restart to update")
		: payload.phase === "error"
			? t("launch.updateToast.tryAgain", "Try again")
			: t("updates.download", "Download update");
}

function PhaseIcon({ payload }: { payload: UpdateToastPayload }) {
	switch (payload.phase) {
		case "available":
			return <DownloadSimpleIcon size={20} weight="bold" />;
		case "downloading":
			return <ArrowClockwiseIcon size={20} weight="bold" className={styles.spin} />;
		case "ready":
			return <CheckCircleIcon size={20} weight="fill" />;
		case "error":
			return <WarningCircleIcon size={20} weight="fill" />;
	}
}

export function UpdateToastWindow({
	payload: suppliedPayload,
}: {
	payload?: UpdateToastPayload;
} = {}) {
	const [livePayload, setPayload] = useState<UpdateToastPayload | null>(null);
	const payload = suppliedPayload ?? livePayload;
	const { t, locale } = useI18n();
	const captureT = useScopedT("capture");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [friendlyError, setFriendlyError] = useState(false);
	const [dismissing, setDismissing] = useState(false);
	const dismissPending = useRef(false);
	const pending = useRef(false);

	useEffect(() => {
		if (suppliedPayload) return;
		let mounted = true;
		let revision = 0;
		const refresh = () => {
			const requestedRevision = revision;
			void window.electronAPI
				.getCurrentUpdateToastPayload()
				.then((nextPayload) => {
					if (mounted && revision === requestedRevision) setPayload(nextPayload);
				})
				.catch(() => {
					/* Keep the last known notification if the bridge is unavailable. */
				});
		};

		const dispose = window.electronAPI.onUpdateToastStateChanged((nextPayload) => {
			revision++;
			if (mounted) {
				setPayload(nextPayload);
				setError(null);
			}
		});
		refresh();
		window.addEventListener("focus", refresh);

		return () => {
			mounted = false;
			window.removeEventListener("focus", refresh);
			dispose();
		};
	}, [suppliedPayload]);

	if (!payload) {
		return <div className={styles.window} />;
	}

	const progress = Math.max(0, Math.min(100, Math.round(payload.progressPercent ?? 0)));
	const transferred = formatBytes(payload.transferredBytes, locale);
	const total = formatBytes(payload.totalBytes, locale);
	const speed = formatBytes(payload.bytesPerSecond, locale);
	const progressDetail = [
		transferred && total
			? captureT("transferred", undefined, { transferred, total })
			: transferred,
		speed ? captureT("speed", undefined, { speed }) : null,
	]
		.filter(Boolean)
		.join(" · ");

	const handlePrimaryAction = async () => {
		if (payload.phase === "downloading") return;

		if (payload.primaryAction === "retry-check") {
			return window.electronAPI.checkForAppUpdates();
		}
		if (payload.phase === "ready") {
			return window.electronAPI.installDownloadedUpdate();
		}
		return window.electronAPI.downloadAvailableUpdate(false);
	};

	const handleNotNow = async () => {
		return window.electronAPI.dismissUpdateToast();
	};
	const run = async (
		action: () => Promise<{ success: boolean; message?: string; code?: string } | undefined>,
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
			if (result && !result.success) {
				setFriendlyError(result.code === "restart-blocked");
				throw Error(
					result.message || t("updates.actionFailed", "Could not update. Try again."),
				);
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			lock.current = false;
			setPending(false);
		}
	};

	return (
		<div className={`${styles.window} launch-theme`}>
			<Card
				className={`${styles.card} w-full flex-row gap-3`}
				aria-live="polite"
				aria-label={captureT("updateLabel")}
			>
				<div
					className={`${styles.icon} ${payload.phase === "error" ? styles.iconError : payload.phase === "ready" ? styles.iconReady : ""}`}
				>
					<PhaseIcon payload={payload} />
				</div>

				<div className={styles.content}>
					<div className={styles.headingRow}>
						<h1>{getTitle(payload, t)}</h1>
						<Chip size="sm">v{payload.version.replace(/^v/, "")}</Chip>
						{payload.isExperimental ? (
							<Chip size="sm" color="accent">
								{t("launch.updateToast.experimentalBadge", "Experimental")}
							</Chip>
						) : null}
						{payload.isPreview ? (
							<Chip size="sm" color="accent">
								{t("launch.updateToast.previewBadge", "Preview")}
							</Chip>
						) : null}
					</div>
					<p>{getDetail(payload, t, captureT)}</p>

					{payload.phase === "downloading" ? (
						<div className={styles.progressBlock}>
							<ProgressBar
								aria-label={captureT("downloadingUpdate")}
								value={progress}
							>
								<ProgressBar.Track>
									<ProgressBar.Fill />
								</ProgressBar.Track>
							</ProgressBar>
							<div className={styles.progressMeta}>
								<strong>
									{new Intl.NumberFormat(locale, { style: "percent" }).format(
										progress / 100,
									)}
								</strong>
								{progressDetail ? <span>{progressDetail}</span> : null}
							</div>
						</div>
					) : null}
					{error && (
						<p className={styles.error} role="alert">
							{friendlyError ? error : <LocalizedError error={error} />}
						</p>
					)}
					<div className={styles.actions}>
						{payload.phase === "error" && (
							<ErrorReportButton
								error={`${getTitle(payload, t)}: ${payload.detail}`}
								context="update"
								compact
							/>
						)}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							disabled={dismissing}
							onClick={() => void run(handleNotNow, true)}
						>
							{t("launch.updateToast.notNow", "Not now")}
						</Button>
						{payload.phase !== "downloading" && (
							<Button
								type="button"
								size="sm"
								disabled={busy}
								onClick={() => void run(handlePrimaryAction)}
							>
								{getPrimaryLabel(payload, t)}
							</Button>
						)}
					</div>
				</div>
			</Card>
		</div>
	);
}
