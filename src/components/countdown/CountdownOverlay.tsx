import { useCallback, useEffect, useState } from "react";

export function CountdownOverlay() {
	const [countdown, setCountdown] = useState<number | null>(null);

	useEffect(() => {
		void window.electronAPI.getActiveCountdown().then((result) => {
			if (result.success && typeof result.seconds === "number") {
				setCountdown(result.seconds);
			}
		});

		const cleanup = window.electronAPI.onCountdownTick((seconds: number) => {
			setCountdown(seconds);
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

	if (countdown === null) {
		return null;
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
