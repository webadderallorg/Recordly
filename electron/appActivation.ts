interface ActivationWindow {
	isDestroyed(): boolean;
	isVisible(): boolean;
	isMinimized(): boolean;
}

/** Desktop icons reopen the current controls without raising an unrelated Home window. */
export function activateFromDesktopIcon(options: {
	stopRecording: () => boolean;
	getPriorityWindow: () => ActivationWindow | null;
	getHudWindow: () => ActivationWindow | null;
	restoreHiddenHud: boolean;
	showHud: () => void;
	showMain: () => void;
}): void {
	if (options.stopRecording()) return;
	const priorityWindow = options.getPriorityWindow();
	if (priorityWindow && !priorityWindow.isDestroyed()) {
		options.showMain();
		return;
	}
	const hud = options.getHudWindow();
	if (
		hud &&
		!hud.isDestroyed() &&
		(options.restoreHiddenHud || (hud.isVisible() && !hud.isMinimized()))
	) {
		options.showHud();
		return;
	}
	options.showMain();
}
