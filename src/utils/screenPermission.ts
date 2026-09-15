export type ScreenPermissionOutcome = "granted" | "denied";

export interface ScreenPermissionTrack {
	readyState: string;
	addEventListener(type: "ended", listener: () => void): void;
	removeEventListener(type: "ended", listener: () => void): void;
}

export interface ScreenPermissionFrameProbe {
	listen(onFirstFrame: () => void): void;
	dispose(): void;
}

/**
 * Waits for the user to actually grant screen capture.
 *
 * On Linux/Wayland the xdg-desktop-portal picker resolves `getDisplayMedia`
 * before the user accepts: the returned track is already `live` and unmuted
 * while the dialog is still open (verified against verbose WebRTC logs —
 * track created `muted:false` ~6s before the first PipeWire frame). The only
 * reliable "user accepted" signal is the first video frame reaching a
 * consumer; denial surfaces as the track transitioning to `ended`.
 */
export function waitForScreenPermission(
	track: ScreenPermissionTrack,
	probe: ScreenPermissionFrameProbe,
): Promise<ScreenPermissionOutcome> {
	if (track.readyState === "ended") {
		probe.dispose();
		return Promise.resolve("denied");
	}

	return new Promise<ScreenPermissionOutcome>((resolve) => {
		let settled = false;

		const settle = (outcome: ScreenPermissionOutcome) => {
			if (settled) return;
			settled = true;
			track.removeEventListener("ended", onEnded);
			probe.dispose();
			resolve(outcome);
		};

		const onEnded = () => settle("denied");
		track.addEventListener("ended", onEnded);
		probe.listen(() => settle("granted"));
	});
}

/**
 * Creates a detached, muted video element whose `requestVideoFrameCallback`
 * fires on the first delivered frame of the given track.
 *
 * Returns null when `requestVideoFrameCallback` is unavailable — callers
 * should treat that as "cannot gate" (fail open) and log a warning.
 */
export function createVideoFramePermissionProbe(
	track: MediaStreamTrack,
): ScreenPermissionFrameProbe | null {
	if (typeof document === "undefined" || document.createElement === undefined) {
		return null;
	}

	const video = document.createElement("video");
	video.muted = true;
	video.setAttribute("playsinline", "");
	video.srcObject = new MediaStream([track]);
	void video.play().catch(() => {
		// A detached muted element may refuse to play in some environments;
		// requestVideoFrameCallback still fires for MediaStream sources that
		// are producing frames, which is the signal we gate on.
	});

	if (typeof video.requestVideoFrameCallback !== "function") {
		video.srcObject = null;
		return null;
	}

	return {
		listen(onFirstFrame) {
			video.requestVideoFrameCallback(() => {
				onFirstFrame();
			});
		},
		dispose() {
			video.srcObject = null;
		},
	};
}

const SCREEN_PERMISSION_DENIED_ERROR_NAMES = new Set([
	"NotAllowedError",
	"AbortError",
	"SecurityError",
]);

/**
 * Whether an error thrown while acquiring screen capture represents the user
 * denying or dismissing the portal permission dialog (a choice, not a
 * failure).
 */
export function isScreenPermissionDeniedError(error: unknown): boolean {
	return (
		error instanceof DOMException && SCREEN_PERMISSION_DENIED_ERROR_NAMES.has(error.name)
	);
}
