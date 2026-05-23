type ElectronSettingsApi = Pick<Window["electronAPI"], "getAppSetting" | "setAppSetting">;

function getElectronSettingsApi(): ElectronSettingsApi | null {
	const api = (globalThis as typeof globalThis & { electronAPI?: ElectronSettingsApi })
		.electronAPI;
	if (
		!api ||
		typeof api.getAppSetting !== "function" ||
		typeof api.setAppSetting !== "function"
	) {
		return null;
	}

	return api;
}

export function loadAppSetting<T>(key: string): T | null {
	const api = getElectronSettingsApi();
	if (!api) {
		return null;
	}

	try {
		const value = api.getAppSetting(key);
		return value === undefined ? null : (value as T | null);
	} catch {
		return null;
	}
}

export function saveAppSetting(key: string, value: unknown): boolean {
	const api = getElectronSettingsApi();
	if (!api) {
		return false;
	}

	try {
		return api.setAppSetting(key, value);
	} catch {
		return false;
	}
}
