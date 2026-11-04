/**
 * start() requests recording; Chromium emits `start` when the muxer begins
 * producing data. Starting telemetry at the request includes portal/encoder
 * startup latency that is absent from the media's zero-based timeline.
 * This is a startup boundary, not a frame-accurate encoder timestamp.
 */
export function startBrowserRecorder(
	recorder: MediaRecorder,
	timesliceMs: number,
	timeoutMs = 15_000,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			recorder.removeEventListener("start", onStart);
			recorder.removeEventListener("error", onError);
			recorder.removeEventListener("stop", onStop);
		};
		const onStart = () => {
			// Chromium may emit `start` while flushing a recorder stopped before
			// its first frame. That must not re-enable recording in the HUD.
			if (recorder.state !== "recording") {
				onStop();
				return;
			}
			const startedAtMs = Date.now();
			cleanup();
			resolve(startedAtMs);
		};
		const onError = () => {
			cleanup();
			reject(new Error("The browser recorder failed to start."));
		};
		const onStop = () => {
			cleanup();
			reject(new Error("The browser recorder stopped before starting."));
		};
		const timeout = setTimeout(() => {
			cleanup();
			try {
				if (recorder.state !== "inactive") recorder.stop();
			} catch {
				// The caller also releases capture tracks on startup failure.
			}
			reject(new Error("Timed out waiting for the browser recorder to start."));
		}, timeoutMs);
		recorder.addEventListener("start", onStart);
		recorder.addEventListener("error", onError);
		recorder.addEventListener("stop", onStop);
		try {
			recorder.start(timesliceMs);
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}
