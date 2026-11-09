type Result = { success: boolean; cancelled?: boolean; error?: string };

/** Keep countdown timing in the main process; the recorder button renders its ticks. */
export function createCountdownController(onRemaining: (seconds: number | null) => void) {
	let finishActive: ((result: Result) => void) | null = null;
	return {
		start(seconds: number): Promise<Result> {
			if (finishActive)
				return Promise.resolve({ success: false, error: "Countdown already in progress" });
			if (!Number.isFinite(seconds) || seconds < 0)
				return Promise.resolve({ success: false, error: "Invalid countdown delay" });
			return new Promise((resolve) => {
				let timer: ReturnType<typeof setInterval> | undefined;
				let remaining = Math.ceil(seconds);
				const finish = (result: Result) => {
					if (finishActive !== finish) return;
					if (timer) clearInterval(timer);
					finishActive = null;
					onRemaining(null);
					resolve(result);
				};
				finishActive = finish;
				if (remaining === 0) {
					finish({ success: true });
					return;
				}
				onRemaining(remaining);
				timer = setInterval(() => {
					remaining--;
					if (remaining <= 0) finish({ success: true });
					else onRemaining(remaining);
				}, 1000);
			});
		},
		cancel() {
			finishActive?.({ success: false, cancelled: true });
			return { success: true };
		},
	};
}
