export interface HudOverlaySessionEnv {
	XDG_SESSION_TYPE?: string | undefined;
	WAYLAND_DISPLAY?: string | undefined;
	// Index signature mirrors Node's ProcessEnv shape so `process.env`
	// satisfies the interface without casts.
	[key: string]: string | undefined;
}

/**
 * Wayland detection for HUD platform gating. Pure and injectable so callers
 * (and tests) never read process.env directly.
 *
 * A session counts as Wayland when XDG_SESSION_TYPE says so OR a Wayland
 * socket is exposed via WAYLAND_DISPLAY. Empty strings are treated as
 * unset (a stray `FOO=` must not flip the gate).
 */
export function isWaylandSession(env: HudOverlaySessionEnv = process.env): boolean {
	return env.XDG_SESSION_TYPE === "wayland" || isSet(env.WAYLAND_DISPLAY);
}

function isSet(value: string | undefined): boolean {
	return typeof value === "string" && value.length > 0;
}
