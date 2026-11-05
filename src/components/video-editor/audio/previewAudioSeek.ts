interface PendingSeek {
	targetTime: number;
	tolerance: number;
	src: string;
	pauseBeforeSeek: boolean;
}

const pendingSeeks = new WeakMap<HTMLAudioElement, PendingSeek>();

/** Keep the newest requested position without restarting an unfinished seek. */
export function syncPreviewAudioTime(
	audio: HTMLAudioElement,
	targetTime: number,
	tolerance: number,
	pauseBeforeSeek = false,
) {
	let pending = pendingSeeks.get(audio);
	if (pending && pending.src !== audio.src) {
		pendingSeeks.delete(audio);
		pending = undefined;
	}
	if (pending) {
		pending.targetTime = targetTime;
		pending.tolerance = Math.min(pending.tolerance, tolerance);
		pending.pauseBeforeSeek = pauseBeforeSeek;
		return;
	}
	if (Math.abs(audio.currentTime - targetTime) <= tolerance) return;
	if (audio.seeking) {
		const request = { targetTime, tolerance, src: audio.src, pauseBeforeSeek };
		pendingSeeks.set(audio, request);
		audio.addEventListener(
			"seeked",
			() => {
				if (pendingSeeks.get(audio) !== request) return;
				pendingSeeks.delete(audio);
				// An element removed while seeking must not restart abandoned media.
				if (!audio.src || audio.src !== request.src) return;
				syncPreviewAudioTime(
					audio,
					request.targetTime,
					request.tolerance,
					request.pauseBeforeSeek,
				);
			},
			{ once: true },
		);
		return;
	}
	try {
		if (pauseBeforeSeek && !audio.paused) audio.pause();
		audio.currentTime = targetTime;
	} catch {
		// The next media-ready/timeline update retries a source not ready to seek.
	}
}
