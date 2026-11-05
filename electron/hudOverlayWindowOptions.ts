export interface HudOverlayTaskbarOptions {
	skipTaskbar: boolean;
	focusable: boolean;
	type?: "panel";
}

export function getHudOverlayTaskbarOptions(platform: NodeJS.Platform): HudOverlayTaskbarOptions {
	const showInWindowsTaskbar = platform === "win32";
	return {
		skipTaskbar: !showInWindowsTaskbar,
		focusable: showInWindowsTaskbar || platform === "darwin",
		// A regular macOS window can activate the app on click even when it
		// cannot take focus, raising Home behind the HUD. Use a native
		// non-activating panel so HUD controls leave the foreground app alone.
		// Keep the panel focusable: disabling key focus routes clicks through
		// macOS app activation and focuses the normal Home window instead.
		...(platform === "darwin" ? { type: "panel" as const } : {}),
	};
}
