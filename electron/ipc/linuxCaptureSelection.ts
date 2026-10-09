export type LinuxCaptureSourceLike = {
	id?: string;
};

/**
 * True when the session can drive ffmpeg's x11grab: an X11 display is
 * configured and the session is not running Wayland natively.
 */
export function isX11CaptureSession(
	env: Record<string, string | string[] | undefined>,
): boolean {
	if (env.XDG_SESSION_TYPE === "wayland") {
		return false;
	}
	if (env.WAYLAND_DISPLAY) {
		return false;
	}
	const display = env.DISPLAY;
	if (typeof display !== "string" || display.trim().length === 0) {
		return false;
	}
	return true;
}

/**
 * Only whole-screen sources use the native Linux backend in phase 1; windows
 * keep the browser capture path because x11grab records a fixed region, not a
 * moving window.
 */
export function shouldUseNativeLinuxCaptureForSource(
	source: LinuxCaptureSourceLike | null | undefined,
): boolean {
	return source?.id?.startsWith("screen:") === true;
}
