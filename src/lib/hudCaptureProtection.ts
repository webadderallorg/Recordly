export function supportsHudCaptureProtection(platform: string): boolean {
	return platform === "darwin" || platform === "win32";
}

export function getHudCaptureExcludedProcessIds(
	platform: string,
	enabled: boolean,
	processId: number,
): number[] {
	if (platform !== "darwin" || !enabled || !Number.isSafeInteger(processId) || processId <= 0) {
		return [];
	}

	return [processId];
}

export function shouldProtectHudCapture(
	enabled: boolean,
	recording: boolean,
	starting: boolean,
): boolean {
	return enabled && (recording || starting);
}
