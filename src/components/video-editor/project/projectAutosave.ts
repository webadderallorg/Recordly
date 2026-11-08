export const PROJECT_AUTOSAVE_INTERVAL_MS = 300;

/** Keep a fixed cadence, sampling the latest editor state on each tick. */
export function startProjectAutosave(saveLatest: () => Promise<unknown> | undefined) {
	let inFlight = false;
	const timer = setInterval(() => {
		if (inFlight) return;
		inFlight = true;
		// The save action reports failures. A failed write must not stop later ticks.
		void Promise.resolve()
			.then(saveLatest)
			.catch(() => undefined)
			.finally(() => {
				inFlight = false;
			});
	}, PROJECT_AUTOSAVE_INTERVAL_MS);
	return () => clearInterval(timer);
}
