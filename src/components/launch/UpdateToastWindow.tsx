import {
	WarningCircle as AlertCircle,
	DownloadSimple as Download,
	Spinner as LoaderCircle,
	Rocket,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

type UpdateToastPayload = {
	version: string;
	detail: string;
	phase: "available" | "downloading" | "ready" | "error";
	delayMs: number;
	isPreview?: boolean;
	progressPercent?: number;
	primaryAction?: "download-update" | "install-update" | "retry-check";
};

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function formatDelayHours(delayMs: number) {
	const hours = Math.max(1, Math.round(delayMs / (60 * 60 * 1000)));
	return `${hours}h`;
}

function getToastTitle(payload: UpdateToastPayload) {
	if (payload.isPreview) {
		return "Update Toast Preview";
	}

	switch (payload.phase) {
		case "available":
			return `Recordly ${payload.version} is available`;
		case "downloading":
			return `Downloading Recordly ${payload.version}`;
		case "ready":
			return `Recordly ${payload.version} is ready`;
		case "error":
			return `Recordly ${payload.version} needs attention`;
	}
}

function getPrimaryActionLabel(payload: UpdateToastPayload) {
	switch (payload.primaryAction) {
		case "download-update":
			return "Download Update";
		case "install-update":
			return "Install Update";
		case "retry-check":
			return "Retry Check";
		default:
			return null;
	}
}

export function UpdateToastWindow() {
	const [payload, setPayload] = useState<UpdateToastPayload | null>(null);
	const [dragOffsetX, setDragOffsetX] = useState(0);
	const dragResetKey = payload
		? `${payload.phase}:${payload.version}:${payload.progressPercent ?? ""}:${payload.detail}:${payload.delayMs}:${payload.isPreview ? "1" : "0"}:${payload.primaryAction ?? ""}`
		: "empty";
	const dragState = useRef<{
		pointerId: number | null;
		startX: number;
		active: boolean;
	}>({
		pointerId: null,
		startX: 0,
		active: false,
	});

	useEffect(() => {
		let mounted = true;
		let pollTimer: ReturnType<typeof setInterval> | null = null;

		void window.electronAPI.getCurrentUpdateToastPayload().then((nextPayload) => {
			if (mounted) {
				setPayload(nextPayload ?? null);
			}
		});

		pollTimer = setInterval(() => {
			void window.electronAPI.getCurrentUpdateToastPayload().then((nextPayload) => {
				if (!mounted) {
					return;
				}

				setPayload(nextPayload ?? null);
			});
		}, 750);

		const dispose = window.electronAPI.onUpdateToastStateChanged((nextPayload) => {
			setPayload(nextPayload ?? null);
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
		if (!dragResetKey) {
			return;
		}

		setDragOffsetX(0);
		dragState.current = {
			pointerId: null,
			startX: 0,
			active: false,
		};
	}, [dragResetKey]);

	const cardStyle = {
		background: "#0d1117",
		border: "1px solid rgba(125, 211, 252, 0.22)",
		boxShadow: "0 24px 48px rgba(0, 0, 0, 0.45)",
		borderRadius: 24,
		padding: 16,
		color: "#ffffff",
		width: "100%",
		maxWidth: 404,
		display: "flex",
		gap: 12,
		alignItems: "flex-start",
		fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
	} as const;
	const wrapperStyle = {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: "100%",
		height: "100%",
		padding: 8,
		boxSizing: "border-box",
		background: "transparent",
	} as const;
	const secondaryTextStyle = {
		color: "rgba(255, 255, 255, 0.74)",
		fontSize: 14,
		lineHeight: 1.45,
		margin: "4px 0 0 0",
	} as const;
	const titleStyle = {
		fontSize: 14,
		fontWeight: 700,
		lineHeight: 1.2,
		margin: 0,
		color: "#ffffff",
	} as const;
	const iconBoxStyle = {
		width: 40,
		height: 40,
		minWidth: 40,
		borderRadius: 16,
		background: "rgba(125, 211, 252, 0.15)",
		color: "#7dd3fc",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		marginTop: 2,
	} as const;
	const rowStyle = {
		display: "flex",
		flexWrap: "wrap" as const,
		gap: 8,
		marginTop: 12,
	} as const;
	const subtleButtonStyle = {
		border: "1px solid rgba(255, 255, 255, 0.1)",
		background: "rgba(255, 255, 255, 0.05)",
		color: "rgba(255, 255, 255, 0.92)",
		borderRadius: 12,
		padding: "8px 12px",
		fontSize: 12,
		fontWeight: 600,
		cursor: "pointer",
	} as const;
	const primaryButtonStyle = {
		...subtleButtonStyle,
		background: "#7dd3fc",
		color: "#031a2c",
		border: "none",
	} as const;
	const ghostButtonStyle = {
		...subtleButtonStyle,
		background: "transparent",
		color: "rgba(255, 255, 255, 0.72)",
		border: "1px solid rgba(125, 211, 252, 0.16)",
	} as const;

	if (!payload) {
		return null;
	}

	const normalizedProgress = Math.max(0, Math.min(100, Math.round(payload.progressPercent ?? 0)));
	const primaryActionLabel = getPrimaryActionLabel(payload);
	const swipeThreshold = 96;
	const handleSwipeDismiss = async () => {
		setDragOffsetX(0);
		dragState.current = {
			pointerId: null,
			startX: 0,
			active: false,
		};
		await window.electronAPI.dismissUpdateToast();
	};

	const handlePrimaryAction = async () => {
		switch (payload.primaryAction) {
			case "download-update":
				await window.electronAPI.downloadAvailableUpdate();
				return;
			case "install-update":
				await window.electronAPI.installDownloadedUpdate();
				return;
			case "retry-check":
				await window.electronAPI.checkForAppUpdates();
				return;
			default:
				return;
		}
	};

	return (
		<div style={wrapperStyle}>
			<div
				className="pointer-events-auto select-none"
				style={{
					...cardStyle,
					transform: `translateX(${dragOffsetX}px) rotate(${dragOffsetX / 30}deg)`,
					opacity: Math.max(0.35, 1 - Math.min(1, Math.abs(dragOffsetX) / 180)),
				}}
				onPointerDown={(event) => {
					const target = event.target as HTMLElement | null;
					if (target?.closest("button")) {
						return;
					}

					dragState.current = {
						pointerId: event.pointerId,
						startX: event.clientX,
						active: true,
					};
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					if (
						!dragState.current.active ||
						dragState.current.pointerId !== event.pointerId
					) {
						return;
					}

					setDragOffsetX(event.clientX - dragState.current.startX);
				}}
				onPointerUp={async (event) => {
					if (
						!dragState.current.active ||
						dragState.current.pointerId !== event.pointerId
					) {
						return;
					}

					const nextOffset = event.clientX - dragState.current.startX;
					dragState.current = {
						pointerId: null,
						startX: 0,
						active: false,
					};

					if (Math.abs(nextOffset) >= swipeThreshold) {
						await handleSwipeDismiss();
						return;
					}

					setDragOffsetX(0);
				}}
				onPointerCancel={() => {
					dragState.current = {
						pointerId: null,
						startX: 0,
						active: false,
					};
					setDragOffsetX(0);
				}}
			>
				<div style={iconBoxStyle}>
					{payload.phase === "available" ? <Download size={20} /> : null}
					{payload.phase === "downloading" ? (
						<LoaderCircle size={20} className="animate-spin" />
					) : null}
					{payload.phase === "ready" ? <Rocket size={20} /> : null}
					{payload.phase === "error" ? <AlertCircle size={20} /> : null}
				</div>
				<div style={{ minWidth: 0, flex: 1 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<p style={titleStyle}>{getToastTitle(payload)}</p>
						{payload.isPreview ? (
							<span
								style={{
									borderRadius: 999,
									border: "1px solid rgba(125, 211, 252, 0.2)",
									background: "rgba(125, 211, 252, 0.1)",
									padding: "2px 8px",
									fontSize: 10,
									fontWeight: 700,
									letterSpacing: "0.18em",
									textTransform: "uppercase",
									color: "#bae6fd",
								}}
							>
								Dev
							</span>
						) : null}
					</div>
					<p style={secondaryTextStyle}>{payload.detail}</p>

					{payload.phase === "downloading" ? (
						<div style={{ marginTop: 12 }}>
							<div
								style={{
									height: 8,
									overflow: "hidden",
									borderRadius: 999,
									background: "rgba(255, 255, 255, 0.1)",
								}}
							>
								<div
									style={{
										height: "100%",
										borderRadius: 999,
										background: "#7dd3fc",
										width: `${normalizedProgress}%`,
									}}
								/>
							</div>
							<p
								style={{
									margin: "8px 0 0 0",
									color: "rgba(224, 242, 254, 0.9)",
									fontSize: 12,
									fontWeight: 600,
								}}
							>
								{normalizedProgress}% downloaded
							</p>
						</div>
					) : null}

					<div style={rowStyle}>
						{primaryActionLabel ? (
							<button
								type="button"
								onClick={handlePrimaryAction}
								style={primaryButtonStyle}
							>
								{primaryActionLabel}
							</button>
						) : null}

						{payload.phase === "downloading" ? (
							<button
								type="button"
								onClick={async () => {
									await window.electronAPI.dismissUpdateToast();
								}}
								style={subtleButtonStyle}
							>
								Hide
							</button>
						) : null}

						{payload.phase !== "downloading" ? (
							<button
								type="button"
								onClick={async () => {
									if (payload.isPreview) {
										await window.electronAPI.dismissUpdateToast();
										return;
									}

									await window.electronAPI.deferDownloadedUpdate(payload.delayMs);
								}}
								style={subtleButtonStyle}
							>
								Later ({formatDelayHours(payload.delayMs)})
							</button>
						) : null}

						{payload.phase !== "downloading" ? (
							<button
								type="button"
								onClick={async () => {
									if (payload.isPreview) {
										await window.electronAPI.dismissUpdateToast();
										return;
									}

									await window.electronAPI.deferDownloadedUpdate(THREE_DAYS_MS);
								}}
								style={subtleButtonStyle}
							>
								Later (3 days)
							</button>
						) : null}

						{!payload.isPreview && payload.phase !== "downloading" ? (
							<button
								type="button"
								onClick={async () => {
									await window.electronAPI.skipUpdateVersion();
								}}
								style={ghostButtonStyle}
							>
								Skip This Version
							</button>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}
