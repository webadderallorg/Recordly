import {
	ArrowClockwiseIcon,
	CheckCircleIcon,
	DownloadSimpleIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import styles from "./UpdateToastWindow.module.css";

type UpdateToastPayload = {
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

function formatBytes(value: number | undefined) {
	if (value === undefined || !Number.isFinite(value) || value <= 0) {
		return null;
	}

	const megabytes = value / (1024 * 1024);
	return megabytes >= 1024
		? `${(megabytes / 1024).toFixed(1)} GB`
		: `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB`;
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

function getDetail(payload: UpdateToastPayload, t: Translate) {
	if (payload.phase === "available" && payload.isExperimental) {
		return t(
			"launch.updateToast.experimentalDescription",
			"You've opted into experimental updates so you have the choice to test the latest update of Recordly before it's widely available.",
		);
	}

	return payload.detail;
}

function getPrimaryLabel(payload: UpdateToastPayload, t: Translate) {
	if (payload.primaryAction === "retry-check") {
		return t("launch.updateToast.tryAgain", "Try again");
	}
	return payload.phase === "ready"
		? t("launch.updateToast.restartToUpdate", "Restart to update")
		: t("launch.updateToast.updateNow", "Update now");
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

export function UpdateToastWindow() {
	const [payload, setPayload] = useState<UpdateToastPayload | null>(null);
	const { t } = useI18n();

	useEffect(() => {
		let mounted = true;
		const refresh = () => {
			void window.electronAPI.getCurrentUpdateToastPayload().then((nextPayload) => {
				if (mounted) setPayload(nextPayload);
			});
		};

		refresh();
		const pollTimer = setInterval(refresh, 750);
		const dispose = window.electronAPI.onUpdateToastStateChanged(setPayload);

		return () => {
			mounted = false;
			clearInterval(pollTimer);
			dispose();
		};
	}, []);

	if (!payload) {
		return <div className={styles.window} />;
	}

	const progress = Math.max(0, Math.min(100, Math.round(payload.progressPercent ?? 0)));
	const transferred = formatBytes(payload.transferredBytes);
	const total = formatBytes(payload.totalBytes);
	const speed = formatBytes(payload.bytesPerSecond);
	const progressDetail = [
		transferred && total ? `${transferred} of ${total}` : transferred,
		speed ? `${speed}/s` : null,
	]
		.filter(Boolean)
		.join(" · ");

	const handlePrimaryAction = async () => {
		if (payload.phase === "downloading") return;

		if (payload.primaryAction === "retry-check") {
			await window.electronAPI.checkForAppUpdates();
			return;
		}
		if (payload.phase === "ready") {
			await window.electronAPI.installDownloadedUpdate();
			return;
		}
		await window.electronAPI.downloadAvailableUpdate(true);
	};

	const handleNotNow = async () => {
		if (payload.isPreview) {
			await window.electronAPI.dismissUpdateToast();
			return;
		}
		await window.electronAPI.deferDownloadedUpdate(payload.delayMs);
	};

	return (
		<div className={`${styles.window} launch-theme`}>
			<section
				className={styles.card}
				aria-live="polite"
				aria-label={t("launch.updateToast.ariaLabel", "Recordly update")}
			>
				<div
					className={`${styles.icon} ${payload.phase === "error" ? styles.iconError : ""}`}
				>
					<PhaseIcon payload={payload} />
				</div>

				<div className={styles.content}>
					<div className={styles.headingRow}>
						<h1>{getTitle(payload, t)}</h1>
						<span className={styles.version}>v{payload.version.replace(/^v/, "")}</span>
						{payload.isExperimental ? (
							<span className={styles.preview}>
								{t("launch.updateToast.experimentalBadge", "Experimental")}
							</span>
						) : null}
						{payload.isPreview ? (
							<span className={styles.preview}>
								{t("launch.updateToast.previewBadge", "Preview")}
							</span>
						) : null}
					</div>
					<p>{getDetail(payload, t)}</p>

					{payload.phase === "downloading" ? (
						<div className={styles.progressBlock}>
							<div className={styles.progressTrack}>
								<div
									className={styles.progressFill}
									style={{ width: `${progress}%` }}
								/>
							</div>
							<div className={styles.progressMeta}>
								<strong>{progress}%</strong>
								{progressDetail ? <span>{progressDetail}</span> : null}
							</div>
						</div>
					) : (
						<div className={styles.actions}>
							<button
								type="button"
								className={styles.secondaryButton}
								onClick={handleNotNow}
							>
								{t("launch.updateToast.notNow", "Not now")}
							</button>
							<button
								type="button"
								className={styles.primaryButton}
								onClick={handlePrimaryAction}
							>
								{getPrimaryLabel(payload, t)}
							</button>
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
