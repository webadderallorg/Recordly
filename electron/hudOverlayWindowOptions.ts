export interface HudOverlayTaskbarOptions {
	skipTaskbar: boolean;
	focusable: boolean;
}

export function getHudOverlayTaskbarOptions(platform: NodeJS.Platform): HudOverlayTaskbarOptions {
	const showInWindowsTaskbar = platform === "win32";
	return {
		skipTaskbar: !showInWindowsTaskbar,
		focusable: showInWindowsTaskbar,
	};
}
