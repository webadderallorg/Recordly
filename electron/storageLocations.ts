import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { USER_DATA_PATH } from "./appPaths";

/**
 * User-configurable storage locations.
 *
 * Recordly writes several kinds of files: exports, scratch data while encoding,
 * downloaded caption models and thumbnail caches. All of them used to live in
 * fixed OS locations, which forced users with a small system drive to move data
 * by hand. Recordings and projects already had their own setting, so this module
 * owns the remaining four locations and keeps the whole set in one file.
 *
 * Only the four keys below are stored here. `recordings` and `projects` stay
 * owned by `RECORDINGS_SETTINGS_FILE` so the existing safety rules around the
 * recordings library keep working unchanged; the UI reads both sources and
 * presents one list.
 */

export const STORAGE_LOCATION_KEYS = [
	"exports",
	"temp",
	"captionModels",
	"cache",
] as const;

export type StorageLocationKey = (typeof STORAGE_LOCATION_KEYS)[number];

export type StorageLocationSetting = {
	/** Location in use; may be a default until the user picks a folder. */
	value: string;
	/** Fallback used when the key has no stored value. */
	fallback: string;
	/** True when the value comes from the stored settings file. */
	configured: boolean;
};

const STORAGE_LOCATIONS_FILE = path.join(USER_DATA_PATH, "storage-locations.json");

let loaded = false;
let stored: Partial<Record<StorageLocationKey, string>> = {};

export function isStorageLocationKey(value: unknown): value is StorageLocationKey {
	return (
		typeof value === "string" &&
		(STORAGE_LOCATION_KEYS as readonly string[]).includes(value)
	);
}

/** Defaults mirror the OS locations Recordly relied on before this setting existed. */
export function getStorageLocationFallback(key: StorageLocationKey): string {
	switch (key) {
		case "exports":
			return app.getPath("downloads");
		case "temp":
			return app.getPath("temp");
		case "captionModels":
			return path.join(USER_DATA_PATH, "captions");
		case "cache":
			return USER_DATA_PATH;
	}
}

function normalizeDirectory(candidate: string) {
	return path.resolve(candidate);
}

function readStore() {
	try {
		const parsed = JSON.parse(readFileSync(STORAGE_LOCATIONS_FILE, "utf-8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const next: Partial<Record<StorageLocationKey, string>> = {};
		for (const key of STORAGE_LOCATION_KEYS) {
			const value = Reflect.get(parsed, key);
			if (typeof value === "string" && value.trim()) next[key] = normalizeDirectory(value);
		}
		return next;
	} catch (error) {
		// A first run has no settings file; any other failure means "use defaults".
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
			console.error("Could not read storage locations:", error);
		}
		return {};
	}
}

/**
 * Writes atomically so a crash mid-write cannot leave the app pointing at a
 * half-written path list that would silently fall back to defaults.
 */
function writeStore(next: Partial<Record<StorageLocationKey, string>>) {
	mkdirSync(path.dirname(STORAGE_LOCATIONS_FILE), { recursive: true });
	const temporary = `${STORAGE_LOCATIONS_FILE}.${process.pid}.tmp`;
	const fd = openSync(temporary, "wx", 0o600);
	let closed = false;
	try {
		writeFileSync(fd, JSON.stringify(next, null, 2), "utf-8");
		fsyncSync(fd);
		closeSync(fd);
		closed = true;
		renameSync(temporary, STORAGE_LOCATIONS_FILE);
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

export function loadStorageLocations() {
	if (loaded) return;
	loaded = true;
	stored = readStore();
}

export function getStorageLocation(key: StorageLocationKey): string {
	loadStorageLocations();
	return stored[key] ?? getStorageLocationFallback(key);
}

/** Configured locations only; used to extend local-path read allowlists. */
export function getConfiguredStorageLocations(): string[] {
	loadStorageLocations();
	return STORAGE_LOCATION_KEYS.flatMap((key) => {
		const value = stored[key];
		return value ? [value] : [];
	});
}

export function describeStorageLocations(): Record<StorageLocationKey, StorageLocationSetting> {
	loadStorageLocations();
	const result = {} as Record<StorageLocationKey, StorageLocationSetting>;
	for (const key of STORAGE_LOCATION_KEYS) {
		const configured = stored[key];
		result[key] = {
			value: configured ?? getStorageLocationFallback(key),
			fallback: getStorageLocationFallback(key),
			configured: configured !== undefined,
		};
	}
	return result;
}

export type StorageLocationPatch = Partial<Record<StorageLocationKey, string | null>>;

export type StorageLocationUpdateResult = {
	values: Record<StorageLocationKey, StorageLocationSetting>;
	warnings: string[];
};

/**
 * Applies a patch, skipping keys whose folder cannot be created or written.
 * Validation is per key so one bad folder does not discard the other edits.
 */
export async function updateStorageLocations(
	patch: StorageLocationPatch,
): Promise<StorageLocationUpdateResult> {
	loadStorageLocations();
	const next: Partial<Record<StorageLocationKey, string>> = { ...stored };
	const warnings: string[] = [];

	for (const key of STORAGE_LOCATION_KEYS) {
		// `Object.hasOwn` needs ES2022; the project targets ES2020, so use the
		// descriptor check the rest of the main process already relies on.
		if (Reflect.getOwnPropertyDescriptor(patch, key) === undefined) continue;
		const requested = patch[key];
		if (requested === null || requested === undefined || !String(requested).trim()) {
			Reflect.deleteProperty(next, key);
			continue;
		}
		const candidate = normalizeDirectory(String(requested).trim());
		try {
			await fs.mkdir(candidate, { recursive: true });
			await fs.access(candidate, fsConstants.W_OK);
		} catch (error) {
			warnings.push(`${key}: ${candidate} is not writable (${String(error)})`);
			continue;
		}
		next[key] = candidate;
	}

	writeStore(next);
	stored = next;
	await Promise.all(
		STORAGE_LOCATION_KEYS.map((key) => fs.mkdir(getStorageLocation(key), { recursive: true }).catch(() => {})),
	);
	return { values: describeStorageLocations(), warnings };
}

export async function resetStorageLocations(): Promise<StorageLocationUpdateResult> {
	loadStorageLocations();
	writeStore({});
	stored = {};
	await Promise.all(
		STORAGE_LOCATION_KEYS.map((key) => fs.mkdir(getStorageLocation(key), { recursive: true }).catch(() => {})),
	);
	return { values: describeStorageLocations(), warnings: [] };
}

// ── Convenience accessors used across the main process ────────────────────────

/** Scratch space for export sessions and intermediate encoders. */
export function getTempStorageDir(): string {
	return getStorageLocation("temp");
}

/** Default folder for the export save dialog. */
export function getExportsDir(): string {
	return getStorageLocation("exports");
}

/** Root for downloaded caption models. Each model keeps its own subfolder. */
export function getCaptionModelsDir(): string {
	return getStorageLocation("captionModels");
}

/** Root for derived caches such as wallpaper and project thumbnails. */
export function getCacheDir(subdirectory?: string): string {
	const root = getStorageLocation("cache");
	return subdirectory ? path.join(root, subdirectory) : root;
}
