import { readFileSync, writeFileSync } from "node:fs";
import { APP_SETTINGS_FILE } from "./ipc/constants";
import { parseJsonWithByteOrderMark } from "./ipc/utils";

export function readAppSettingsStore(): Record<string, unknown> {
	try {
		const content = readFileSync(APP_SETTINGS_FILE, "utf-8");
		const parsed = parseJsonWithByteOrderMark<unknown>(content);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}

		return parsed as Record<string, unknown>;
	} catch {
		return {};
	}
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
	const store = readAppSettingsStore();
	store[key] = value;
	writeAppSettingsStore(store);
}
