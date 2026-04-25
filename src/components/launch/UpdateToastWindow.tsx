import {
	WarningCircle as AlertCircle,
	DownloadSimple as Download,
	Spinner as LoaderCircle,
	Rocket,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type UpdateToastPayload = {
	version: string;
	detail: string;
	phase: "available" | "downloading" | "ready" | "error";
	delayMs: number;
	isPreview?: boolean;
	progressPercent?: number;
	transferredBytes?: number;
	totalBytes?: number;
	remainingBytes?: number;
	bytesPerSecond?: number;
	primaryAction?: "install-and-restart" | "retry-check";
};

const DEFAULT_REMINDER_DELAY_MS = 3 * 60 * 60 * 1000;
const REMINDER_OPTIONS = [
	{ label: "1 hour", value: 1 * 60 * 60 * 1000 },
	{ label: "3 hours", value: 3 * 60 * 60 * 1000 },
	{ label: "Tomorrow", value: 24 * 60 * 60 * 1000 },
	{ label: "3 days", value: 3 * 24 * 60 * 60 * 1000 },
];

function formatBytes(value: number | undefined) {
	if (value === undefined || !Number.isFinite(value) || value <= 0) {
		return null;
	}

	const megabytes = value / (1024 * 1024);
	if (megabytes >= 1024) {
		return `${(megabytes / 1024).toFixed(1)} GB`;
	}

	return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB`;
}

function getToastTitle(payload: UpdateToastPayload) {
	if (payload.isPreview) {
		return "Update Prompt Preview";
	}

	switch (payload.phase) {
		case "available":
			return `Recordly ${payload.version} is available`;
		case "downloading":
			return `Installing Recordly ${payload.version}`;
		case "ready":
			return `Recordly ${payload.version} is ready`;
		case "error":
			return payload.primaryAction === "retry-check"
				? "Could not check for updates"
				: `Recordly ${payload.version} needs attention`;
	}
}

function getPrimaryButtonLabel(payload: UpdateToastPayload) {
	return payload.primaryAction === "retry-check" ? "Try Again" : "Install & Restart";
}

function getPhaseIcon(payload: UpdateToastPayload) {
	switch (payload.phase) {
		case "available":
			return <Download size={20} />;
		case "downloading":
			return <LoaderCircle size={20} className="animate-spin" />;
		case "ready":
			return <Rocket size={20} />;
		case "error":
			return <AlertCircle size={20} />;
	}
}

export function UpdateToastWindow() {
	const [payload, setPayload] = useState<UpdateToastPayload | null>(null);
	const [reminderDelayMs, setReminderDelayMs] = useState(DEFAULT_REMINDER_DELAY_MS);

	useEffect(() => {
		let mounted = true;
		let pollTimer: ReturnType<typeof setInterval> | null = null;

		void window.electronAPI.getCurrentUpdateToastPayload().then((nextPayload) => {
			if (mounted) {
				setPayload(nextPayload);
			}
		});

		pollTimer = setInterval(() => {
			void window.electronAPI.getCurrentUpdateToastPayload().then((nextPayload) => {
				if (mounted) {
					setPayload(nextPayload);
				}
			});
		}, 750);

		const dispose = window.electronAPI.onUpdateToastStateChanged((nextPayload) => {
			setPayload(nextPayload);
		});

		return () => {
			mounted = false;
			if (pollTimer) {
				clearInterval(pollTimer);
			}
			dispose();
		};
	}, []);

	useEffect(() => {
		if (!payload) {
			return;
		}

		setReminderDelayMs(payload.delayMs || DEFAULT_REMINDER_DELAY_MS);
	}, [payload]);

	const normalizedProgress = Math.max(
		0,
		Math.min(100, Math.round(payload?.progressPercent ?? 0)),
	);
	const downloadedLabel = formatBytes(payload?.transferredBytes);
	const totalLabel = formatBytes(payload?.totalBytes);
	const remainingLabel = formatBytes(payload?.remainingBytes);
	const speedLabel = formatBytes(payload?.bytesPerSecond);
	const phaseStats: Array<{ label: string; value: string }> = [];
	if (payload?.phase === "downloading") {
		if (downloadedLabel && totalLabel) {
			phaseStats.push({ label: "Downloaded", value: `${downloadedLabel} / ${totalLabel}` });
		} else if (downloadedLabel) {
			phaseStats.push({ label: "Downloaded", value: downloadedLabel });
		}
		if (remainingLabel) {
			phaseStats.push({ label: "Left", value: remainingLabel });
		}
		if (speedLabel) {
			phaseStats.push({ label: "Speed", value: `${speedLabel}/s` });
		}
	}

	const isMacOS = /mac/i.test(navigator.platform);
	const wrapperStyle = {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: "100%",
		height: "100%",
		padding: 10,
		boxSizing: "border-box",
		background: isMacOS ? "transparent" : "#0b1220",
	} as const;
	const cardStyle = {
		width: "100%",
		maxWidth: 440,
		display: "flex",
		gap: 14,
		alignItems: "flex-start",
		padding: "18px 18px 16px",
		borderRadius: 24,
		background:
			"linear-gradient(180deg, rgba(12, 19, 34, 0.98) 0%, rgba(10, 17, 30, 0.98) 100%)",
		border: "1px solid rgba(37, 99, 235, 0.24)",
		boxShadow: "0 20px 48px rgba(2, 6, 23, 0.5), inset 0 1px 0 rgba(148, 163, 184, 0.08)",
		color: "#ffffff",
		fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
	} as const;
	const iconBoxStyle = {
		width: 42,
		height: 42,
		minWidth: 42,
		borderRadius: 16,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		background: "rgba(37, 99, 235, 0.16)",
		color: "#60a5fa",
		boxShadow: "inset 0 0 0 1px rgba(37, 99, 235, 0.18)",
	} as const;
	const titleStyle = {
		fontSize: 15,
		fontWeight: 700,
		lineHeight: 1.25,
		margin: 0,
		color: "#f8fafc",
	} as const;
	const secondaryTextStyle = {
		color: "rgba(226, 232, 240, 0.78)",
		fontSize: 13,
		lineHeight: 1.5,
		margin: "6px 0 0 0",
	} as const;
	const subtleButtonStyle = {
		height: 38,
		borderRadius: 12,
		padding: "0 14px",
		border: "1px solid rgba(148, 163, 184, 0.16)",
		background: "rgba(15, 23, 42, 0.72)",
		color: "#e2e8f0",
		fontSize: 13,
		fontWeight: 600,
		cursor: "pointer",
		transition: "all 0.15s ease",
	} as const;
	const primaryButtonStyle = {
		...subtleButtonStyle,
		border: "none",
		background: "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)",
		color: "#ffffff",
		boxShadow: "0 12px 24px rgba(37, 99, 235, 0.26)",
	} as const;
	const selectStyle = {
		height: 38,
		borderRadius: 12,
		padding: "0 34px 0 12px",
		border: "1px solid rgba(37, 99, 235, 0.22)",
		background:
			"linear-gradient(180deg, rgba(18, 29, 51, 0.96) 0%, rgba(12, 22, 42, 0.96) 100%)",
		color: "#dbeafe",
		fontSize: 13,
		fontWeight: 600,
		outline: "none",
		boxShadow: "inset 0 0 0 1px rgba(37, 99, 235, 0.06)",
		cursor: "pointer",
	} as const;

	const handlePrimaryAction = async () => {
		if (!payload || payload.phase === "downloading") {
			return;
		}

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

	const handleLater = async () => {
		if (!payload) {
			return;
		}

		if (payload.isPreview) {
			await window.electronAPI.dismissUpdateToast();
			return;
		}

		await window.electronAPI.deferDownloadedUpdate(reminderDelayMs);
	};

	if (!payload) {
		return <div style={wrapperStyle} />;
	}

	return (
		<div style={wrapperStyle}>
			<div style={cardStyle}>
				<div style={iconBoxStyle}>{getPhaseIcon(payload)}</div>
				<div style={{ minWidth: 0, flex: 1 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<p style={titleStyle}>{getToastTitle(payload)}</p>
						{payload.isPreview ? (
							<span
								style={{
									borderRadius: 999,
									padding: "2px 8px",
									fontSize: 10,
									fontWeight: 700,
									letterSpacing: "0.18em",
									textTransform: "uppercase",
									color: "#93c5fd",
									background: "rgba(37, 99, 235, 0.14)",
									border: "1px solid rgba(37, 99, 235, 0.18)",
								}}
							>
								Dev
							</span>
						) : null}
					</div>
					<p style={secondaryTextStyle}>{payload.detail}</p>

					{payload.phase === "downloading" ? (
						<div style={{ marginTop: 14 }}>
							<div
								style={{
									height: 10,
									overflow: "hidden",
									borderRadius: 999,
									background: "rgba(148, 163, 184, 0.14)",
								}}
							>
								<div
									style={{
										height: "100%",
										width: `${normalizedProgress}%`,
										borderRadius: 999,
										background:
											"linear-gradient(90deg, #60a5fa 0%, #2563eb 45%, #1d4ed8 100%)",
										boxShadow: "0 0 22px rgba(37, 99, 235, 0.38)",
									}}
								/>
							</div>
							<div
								style={{
									display: "flex",
									flexWrap: "wrap",
									gap: 8,
									marginTop: 10,
								}}
							>
								<span
									style={{
										fontSize: 12,
										fontWeight: 700,
										color: "#dbeafe",
									}}
								>
									{normalizedProgress}% complete
								</span>
								{phaseStats.map((stat) => (
									<span
										key={stat.label}
										style={{
											fontSize: 11,
											fontWeight: 600,
											color: "rgba(191, 219, 254, 0.9)",
											background: "rgba(37, 99, 235, 0.12)",
											borderRadius: 999,
											padding: "4px 8px",
											border: "1px solid rgba(37, 99, 235, 0.16)",
										}}
									>
										{stat.label}: {stat.value}
									</span>
								))}
							</div>
						</div>
					) : null}

					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: 10,
							marginTop: 14,
							alignItems: "center",
						}}
					>
						{payload.phase !== "downloading" ? (
							<>
								<button
									type="button"
									onClick={handlePrimaryAction}
									style={primaryButtonStyle}
								>
									{getPrimaryButtonLabel(payload)}
								</button>
								<select
									value={String(reminderDelayMs)}
									onChange={(event) => {
										setReminderDelayMs(Number.parseInt(event.target.value, 10));
									}}
									style={selectStyle}
								>
									{REMINDER_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
								<button
									type="button"
									onClick={handleLater}
									style={subtleButtonStyle}
								>
									Later
								</button>
							</>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}
