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
