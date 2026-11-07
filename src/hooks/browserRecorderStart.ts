/**
 * Wait for startup success, but do not confuse muxer output with media time zero.
 * Chromium can buffer audio before the first video frame and only emit `start`
 * when both track headers are ready. In that case the saved audio already covers
 * the wait, so duration, telemetry and webcam offsets must retain the request
 * clock. Video-only recordings keep the first-output startup boundary.
 *
 * Both boundaries are wall-clock approximations, not encoder timestamps. In
 * particular this does not remove a missing-video interval from the media.
 */
export function startBrowserRecorder(
	recorder: MediaRecorder,
	timesliceMs: number,
	timeoutMs = 15_000,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const hasAudio = recorder.stream.getAudioTracks().length > 0;
		let requestedAtMs: number;
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
			const startedAtMs = hasAudio ? requestedAtMs : Date.now();
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
			requestedAtMs = Date.now();
			recorder.start(timesliceMs);
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}
