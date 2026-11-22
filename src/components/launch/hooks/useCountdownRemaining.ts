import { useEffect, useState } from "react";

/** Subscribe before querying so a late snapshot cannot rewind the countdown. */
export function useCountdownRemaining(active: boolean, delay: number) {
	const [remaining, setRemaining] = useState<number | null>(null);
	useEffect(() => {
		let mounted = true;
		let receivedTick = false;
		const unsubscribe = window.electronAPI.onCountdownTick((seconds) => {
			receivedTick = true;
			if (mounted) setRemaining(Math.max(0, seconds));
		});
		void window.electronAPI
			.getActiveCountdown()
			.then((result) => {
				if (mounted && !receivedTick && result.success) setRemaining(result.seconds);
			})
			.catch(() => undefined);
		return () => {
			mounted = false;
			unsubscribe();
		};
	}, []);
	useEffect(() => {
		if (!active) setRemaining(null);
		else setRemaining((current) => current ?? delay);
	}, [active, delay]);
	return remaining;
}
