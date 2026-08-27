export const LINUX_PORTAL_SCREEN_SOURCE_ID = "screen:linux-portal";

export function isLikelyLinuxWaylandSession(env: NodeJS.ProcessEnv) {
	const sessionType = env.XDG_SESSION_TYPE?.trim().toLowerCase();
	if (sessionType === "wayland") {
		return true;
	}
	if (sessionType === "x11") {
		return false;
	}

	return Boolean(env.WAYLAND_DISPLAY);
}

export type LinuxWindowSystem = "wayland" | "x11";

/**
 * Best-effort detection of the Linux window system Electron is running under.
 * Returns null off Linux. Wayland is detected via the session type or a Wayland
 * socket; anything else with an X display is treated as X11.
 */
export function getLinuxWindowSystem(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform | string = process.platform,
): LinuxWindowSystem | null {
	if (platform !== "linux") {
		return null;
	}
	if (isLikelyLinuxWaylandSession(env)) {
		return "wayland";
	}
	if (env.XDG_SESSION_TYPE?.trim().toLowerCase() === "x11" || env.DISPLAY) {
		return "x11";
	}
	return null;
}

/**
 * The portal sentinel exists to collapse the double xdg-desktop-portal prompt
 * on Wayland. On X11, desktopCapturer sources are stable and the sentinel's
 * synthetic id cannot be resolved by Chromium (capture fails with "Could not
 * start video source"), so it must only be used for Wayland sessions.
 */
export function shouldUseLinuxPortalSentinel({
	env = process.env,
	platform = process.platform,
	sourceId,
}: {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform | string;
	sourceId: string | null | undefined;
}) {
	if (platform !== "linux" || !isLikelyLinuxWaylandSession(env)) {
		return false;
	}
	return sourceId === LINUX_PORTAL_SCREEN_SOURCE_ID || !sourceId;
}

export function getScreenSourceIdForDisplay({
	displayId,
	env = process.env,
	matchedSourceId,
	platform,
}: {
	displayId: string;
	env?: NodeJS.ProcessEnv;
	matchedSourceId?: string | null;
	platform: NodeJS.Platform | string;
}) {
	if (matchedSourceId) {
		return matchedSourceId;
	}

	if (platform === "linux" && isLikelyLinuxWaylandSession(env)) {
		return LINUX_PORTAL_SCREEN_SOURCE_ID;
	}

	return `screen:fallback:${displayId}`;
}
