import type { BrowserWindow } from "electron";

import { isWaylandSession } from "./hudOverlaySession";

export type HudOverlayHideTarget = Pick<BrowserWindow, "hide" | "minimize">;

export function hideHudOverlayWindow(
	hud: HudOverlayHideTarget,
	platform: NodeJS.Platform = process.platform,
	waylandSession: boolean = isWaylandSession(),
): void {
	// Wayland compositors ignore minimize() and there is no taskbar entry
	// to restore from, so the "−" control must hide the window instead.
	// Gated to Wayland sessions: on X11 minimize() works and the taskbar
	// restores the HUD — main's behavior. The tray "Show HUD" action
	// (showHudOverlayFromTray) restores a hidden window with show(), which
	// works on every platform.
	if (platform === "linux" && waylandSession) {
		hud.hide();
		return;
	}

	hud.minimize();
}

export type HudOverlayRestoreStrategy = "show-existing" | "recreate";

export type HudOverlayRestoreInput = {
	platform: NodeJS.Platform;
	isFocused: boolean;
	isVisible: boolean;
	isMinimized: boolean;
	isEditor: boolean;
	recordingActive: boolean;
};

export function decideHudOverlayRestoreStrategy(
	input: HudOverlayRestoreInput,
): HudOverlayRestoreStrategy {
	// On Linux, tray activation can't focus an existing window (compositors
	// ignore focus()), so main destroys and recreates the HUD to regain
	// focus via the creation path. That workaround must never fire for a
	// hidden or minimized window — and never during an active recording,
	// when the HUD stays visible but unfocused: destroy kills the renderer
	// — and with it the in-flight MediaRecorder, which lives in the HUD
	// renderer — while the fresh renderer starts with idle state and main
	// keeps recording=true in the tray. Hidden/minimized/recording windows
	// restore through the show() path instead, exactly like the tray menu
	// items (showHudOverlayFromTray) already do.
	if (
		input.platform === "linux" &&
		!input.isEditor &&
		input.isVisible &&
		!input.isMinimized &&
		!input.isFocused &&
		!input.recordingActive
	) {
		return "recreate";
	}

	return "show-existing";
}
