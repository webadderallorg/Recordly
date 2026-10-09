export interface HudSizingRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface HudSizingWorkArea extends HudSizingRect {}

/**
 * Transparent padding added around the measured HUD content when sizing the
 * window — room for the bar's shadow/glow so it isn't cut off, while keeping
 * the dead click ring thin (Linux has no mouse passthrough, so every window
 * pixel blocks the desktop).
 */
export const HUD_CONTENT_RING_PX = 10;

export type HudSizingEnv = Record<string, string | string[] | undefined>;

/**
 * True when Electron's windows are driven by an X server — native X11 or
 * XWayland — where programmatic setBounds positioning is exact and the HUD
 * window can use the shape extension. False for native-Wayland Electron,
 * which uses the grow-downward mode instead (compositors there refuse
 * client-side positioning but pin the top-left on resize).
 *
	 * Empirical rule (learned on Cinnamon Wayland, commit history): when a
 * Wayland display is reachable, Electron runs native Wayland even with no
 * ozone hint and DISPLAY set — the old "no hint means X11/XWayland"
 * assumption produced a shape-mode window whose setShape/setBounds tricks
 * silently do nothing on Wayland. So a reachable Wayland display means
 * grow, and shape is for sessions where Wayland does not exist at all
 * (unless the user explicitly steered to X11 via hint=x11 or
 * --ozone-platform=x11). Grow mode degrades gracefully if Electron still
 * ends up on X11: its setBounds resizing works there too.
 */
export function isXClientWindowing(
	env: HudSizingEnv,
	platform: NodeJS.Platform,
	argv: string[] = [],
): boolean {
	if (platform !== "linux") {
		return false;
	}
	if (argv.some((arg) => arg.includes("ozone-platform=wayland"))) {
		return false;
	}
	const waylandDisplay =
		typeof env.WAYLAND_DISPLAY === "string" && env.WAYLAND_DISPLAY.trim().length > 0;
	const sessionType = typeof env.XDG_SESSION_TYPE === "string" ? env.XDG_SESSION_TYPE : "";
	const waylandReachable = waylandDisplay || sessionType === "wayland";
	const hint = typeof env.ELECTRON_OZONE_PLATFORM_HINT === "string" ? env.ELECTRON_OZONE_PLATFORM_HINT : "";
	if (hint === "x11" || argv.some((arg) => arg.includes("ozone-platform=x11"))) {
		return true;
	}
	if (waylandReachable) {
		return false;
	}
	return typeof env.DISPLAY === "string" && env.DISPLAY.trim().length > 0;
}

export type HudWindowMode = "legacy" | "shape" | "grow";

/**
 * Which sizing strategy the HUD window uses:
 * - "shape": X clients — constant tall window, X11 shape extension carves
 *   paint+input to the content rects (see electron/hudOverlayShape.ts).
 * - "grow": native-Wayland Electron (anything Linux that is not an X client)
 *   — the compositor owns placement but pins the top-left corner on resizes,
 *   so the bar is anchored to the window's TOP and opening a popover grows
 *   the window downward. Idle rectangle hugs the bar; menus appear below it.
 * - "legacy": everything else — today's fixed 860x160 window, unchanged.
 *
 * RECORDLY_FORCE_HUD_WINDOW_MODE=shape|grow|legacy overrides for testing a
 * mode on a machine that wouldn't get it natively (dev-only escape hatch).
 */
export function resolveHudWindowMode(
	env: HudSizingEnv,
	platform: NodeJS.Platform,
	argv: string[] = [],
): HudWindowMode {
	const forced = env.RECORDLY_FORCE_HUD_WINDOW_MODE;
	if (forced === "shape" || forced === "grow" || forced === "legacy") {
		return forced;
	}
	if (platform !== "linux") {
		return "legacy";
	}
	return isXClientWindowing(env, platform, argv) ? "shape" : "grow";
}
