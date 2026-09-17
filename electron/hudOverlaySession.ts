export interface HudOverlaySessionEnv {
	XDG_SESSION_TYPE?: string | undefined;
	WAYLAND_DISPLAY?: string | undefined;
	[key: string]: string | undefined;
}

/**
 * Detect whether the desktop session uses Wayland. The environment is stable
 * for the Electron process lifetime and is injectable so platform gating can
 * be covered without depending on the host running the tests.
 */
export function isWaylandSession(env: HudOverlaySessionEnv = process.env): boolean {
	const sessionType = env.XDG_SESSION_TYPE?.trim().toLowerCase();
	return sessionType === "wayland" || Boolean(env.WAYLAND_DISPLAY?.trim());
}
