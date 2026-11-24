export async function hasRequiredRecordingPermissions(): Promise<boolean> {
	const api = window.electronAPI;
	if ((await api.getPlatform()) !== "darwin") return true;
	const [screen, accessibility] = await Promise.all([
		api.getScreenRecordingPermissionStatus(),
		api.getAccessibilityPermissionStatus(),
	]);
	return (
		screen.success &&
		screen.status === "granted" &&
		accessibility.success &&
		accessibility.trusted
	);
}

/**
 * Ask macOS directly for the first missing recording permission. Screen Recording comes
 * first; Accessibility follows on the next attempt so two settings panes never compete.
 */
export async function requestMissingRecordingPermissions(): Promise<void> {
	const api = window.electronAPI;
	if ((await api.getPlatform()) !== "darwin") return;
	const screen = await api.getScreenRecordingPermissionStatus();
	if (!screen.success || screen.status !== "granted") {
		const result = await api.openScreenRecordingPreferences();
		if (!result.success) throw new Error(result.error ?? "Could not open System Settings.");
		return;
	}
	const accessibility = await api.getAccessibilityPermissionStatus();
	if (!accessibility.success || !accessibility.trusted) {
		await api.requestAccessibilityPermission();
	}
}
