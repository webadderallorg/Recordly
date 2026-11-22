import { randomUUID } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
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
	const serialized = JSON.stringify(store, null, 2);
	const temporary = `${APP_SETTINGS_FILE}.${randomUUID()}.tmp`;
	const fd = openSync(temporary, "wx", 0o600);
	let closed = false;
	try {
		writeFileSync(fd, serialized, "utf-8");
		fsyncSync(fd);
		closeSync(fd);
		closed = true;
		renameSync(temporary, APP_SETTINGS_FILE);
	} finally {
		if (!closed) {
			try {
				closeSync(fd);
			} catch {
				/* Preserve the original write failure. */
			}
		}
		try {
			unlinkSync(temporary);
		} catch {
			/* The rename may have consumed the temporary file. */
		}
	}
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
