import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../contexts/I18nContext";

export function CountdownOverlay() {
	const { t } = useI18n();
	const [countdown, setCountdown] = useState<number | null>(null);
	const [awaitingScreenPermission, setAwaitingScreenPermission] = useState(false);

	useEffect(() => {
		void window.electronAPI.getActiveCountdown().then((result) => {
			if (result.success && typeof result.seconds === "number") {
				setCountdown(result.seconds);
			}
		});

		// Pull the current awaiting state: the awaiting event may have fired
		// before this (lazily loaded) component mounted its listener.
		void window.electronAPI.getAwaitingScreenPermission().then((result) => {
			if (result.success && result.awaiting) {
				setAwaitingScreenPermission(true);
			}
		});

		const cleanup = window.electronAPI.onCountdownTick((seconds: number) => {
			// A tick means the countdown has taken over the overlay.
			setAwaitingScreenPermission(false);
			setCountdown(seconds);
		});

		return cleanup;
	}, []);

	useEffect(() => {
		const cleanup = window.electronAPI.onAwaitingScreenPermission((awaiting: boolean) => {
			if (awaiting) {
				setCountdown(null);
			}
			setAwaitingScreenPermission(awaiting);
		});

		return cleanup;
	}, []);

	const handleCancel = useCallback(() => {
		window.electronAPI.cancelCountdown();
	}, []);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				handleCancel();
			}
		},
		[handleCancel],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	if (countdown === null && !awaitingScreenPermission) {
		return null;
	}

	if (awaitingScreenPermission) {
		return (
			<div
				className="fixed inset-0 flex items-center justify-center select-none cursor-pointer"
				onClick={handleCancel}
				onKeyDown={(e) => e.key === "Escape" && handleCancel()}
			>
				<div
					className="flex flex-col items-center gap-4 rounded-3xl px-6 py-6"
					style={{
						width: 320,
						background: "rgba(0, 0, 0, 0.85)",
						backdropFilter: "blur(20px)",
					}}
				>
					<div
						className="flex items-center justify-center"
						style={{ width: 180, height: 180 }}
					>
						<span
							className="animate-spin rounded-full"
							style={{
								width: 56,
								height: 56,
								border: "6px solid rgba(255, 255, 255, 0.2)",
								borderTopColor: "rgba(255, 255, 255, 1)",
							}}
						/>
					</div>
					<div className="flex flex-col items-center gap-1 text-center">
						<span className="text-white font-semibold" style={{ fontSize: 15 }}>
							{t("recording.awaitingScreenPermission", "Waiting for screen permission…")}
						</span>
						<span className="text-white/70 text-sm">
							{t("recording.cancelCountdownHint", "Click here or press Esc to cancel")}
						</span>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className="fixed inset-0 flex items-center justify-center select-none cursor-pointer"
			onClick={handleCancel}
			onKeyDown={(e) => e.key === "Escape" && handleCancel()}
		>
			<div
				className="flex items-center justify-center rounded-3xl"
				style={{
					width: 180,
					height: 180,
					background: "rgba(0, 0, 0, 0.85)",
					backdropFilter: "blur(20px)",
				}}
			>
				<span
					className="text-white font-bold tabular-nums"
					style={{
						fontSize: "100px",
						lineHeight: 1,
						textShadow: "0 0 30px rgba(255,255,255,0.2)",
					}}
				>
					{countdown}
				</span>
			</div>
		</div>
	);
}
