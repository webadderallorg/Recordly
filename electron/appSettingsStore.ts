import { readFileSync, writeFileSync } from "node:fs";
import { APP_SETTINGS_FILE } from "./ipc/constants";
import { parseJsonWithByteOrderMark } from "./ipc/utils";

export function readAppSettingsStoreWithStatus():
	| { success: true; store: Record<string, unknown> }
	| { success: false } {
	try {
		const content = readFileSync(APP_SETTINGS_FILE, "utf-8");
		const parsed = parseJsonWithByteOrderMark<unknown>(content);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { success: false };
		}

		return { success: true, store: parsed as Record<string, unknown> };
	} catch (error) {
		// A first run has no settings file. Other failures cannot establish absence.
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			return { success: true, store: {} };
		}
		return { success: false };
	}
}

export function readAppSettingsStore(): Record<string, unknown> {
	const result = readAppSettingsStoreWithStatus();
	return result.success ? result.store : {};
}

export function writeAppSettingsStore(store: Record<string, unknown>) {
	writeFileSync(APP_SETTINGS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function hasAppSetting(store: Record<string, unknown>, key: string): boolean {
	return Reflect.getOwnPropertyDescriptor(store, key) !== undefined;
}

export function readAppSetting(key: string): unknown {
	const store = readAppSettingsStore();
	return hasAppSetting(store, key) ? store[key] : null;
}

export function writeAppSetting(key: string, value: unknown) {
	const result = readAppSettingsStoreWithStatus();
	if (!result.success) throw new Error("Could not read app settings before saving");
	const store = result.store;
	store[key] = value;
	writeAppSettingsStore(store);
}
