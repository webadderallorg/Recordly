type ElectronSettingsApi = Pick<Window["electronAPI"], "getAppSetting" | "setAppSetting">;

// "missing" (the key was never stored) is deliberately distinct from
// "unavailable" (no Electron bridge, e.g. a plain browser) and "error" (the IPC
// read threw). Callers that fall back to another store need to know whether the
// value is genuinely absent or the bridge failed.
export type AppSettingReadResult =
	| { status: "found"; value: unknown }
	| { status: "missing" }
	| { status: "unavailable" }
	| { status: "error"; error: unknown };

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

export function readAppSetting(key: string): AppSettingReadResult {
	const api = getElectronSettingsApi();
	if (!api) {
		return { status: "unavailable" };
	}

	try {
		const value = api.getAppSetting(key);
		return value === undefined ? { status: "missing" } : { status: "found", value };
	} catch (error) {
		console.error(
			`[appSettings] Failed to read "${key}" through the Electron settings bridge.`,
			error,
		);
		return { status: "error", error };
	}
}

export function loadAppSetting<T>(key: string): T | null {
	const result = readAppSetting(key);
	if (result.status !== "found") {
		return null;
	}

	return result.value as T | null;
}

export function saveAppSetting(key: string, value: unknown): boolean {
	const api = getElectronSettingsApi();
	if (!api) {
		return false;
	}

	try {
		const saved = api.setAppSetting(key, value) === true;
		if (!saved) {
			console.error(`[appSettings] The Electron settings bridge did not persist "${key}".`);
		}
		return saved;
	} catch (error) {
		console.error(
			`[appSettings] Failed to save "${key}" through the Electron settings bridge.`,
			error,
		);
		return false;
	}
}
