import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { RECORDINGS_DIR } from "../../appPaths";
import { PROJECTS_DIRECTORY_NAME } from "../constants";
import {
	getProjectsDir,
	persistRecordingsDirectorySetting,
} from "../project/manager";
import {
	describeStorageLocations,
	getStorageLocation,
	isStorageLocationKey,
	resetStorageLocations,
	STORAGE_LOCATION_KEYS,
	type StorageLocationKey,
	updateStorageLocations,
} from "../../storageLocations";
import { isTrustedRenderer } from "../../trustedRenderer";
import { nativeT } from "../../nativeI18n";
import type { StorageFolder, StorageFolderId } from "../../../src/types/storageFolders";
import { getRecordingsDir } from "../utils";

/**
 * A single settings surface for every folder Recordly writes into.
 *
 * `recordings` and `projects` keep their existing persistence path: the
 * recordings settings file plus the runtime cache that the library and project
 * manager already validate against. `projects` is not a separate location - it
 * is the `Projects` folder inside the recordings folder, so picking a projects
 * folder moves its parent.
 *
 * The remaining keys (exports, temp, caption models, cache) are owned by
 * `storageLocations.ts`. Both halves are merged here so the renderer handles one
 * list and one "change folder" action.
 */

export const STORAGE_FOLDER_IDS = [
	"recordings",
	"projects",
	...STORAGE_LOCATION_KEYS,
] as const;

export type { StorageFolder, StorageFolderId } from "../../../src/types/storageFolders";

export function isStorageFolderId(value: unknown): value is StorageFolderId {
	return (
		typeof value === "string" &&
		(STORAGE_FOLDER_IDS as readonly string[]).includes(value)
	);
}

export async function listStorageFolders(): Promise<Record<StorageFolderId, StorageFolder>> {
	const recordingsDir = await getRecordingsDir();
	const projectsDir = await getProjectsDir();
	// `describeStorageLocations` reports the same shape under `value`; map it to
	// the `path` field so the renderer sees one folder representation.
	const described = describeStorageLocations();
	const asFolder = (
		id: Exclude<StorageFolderId, "recordings" | "projects">,
	): StorageFolder => ({
		id,
		path: described[id].value,
		fallback: described[id].fallback,
		configured: described[id].configured,
	});
	return {
		recordings: {
			id: "recordings",
			path: recordingsDir,
			fallback: RECORDINGS_DIR,
			configured: path.resolve(recordingsDir) !== path.resolve(RECORDINGS_DIR),
		},
		projects: {
			id: "projects",
			path: projectsDir,
			fallback: path.join(RECORDINGS_DIR, PROJECTS_DIRECTORY_NAME),
			configured:
				path.resolve(path.dirname(projectsDir)) !== path.resolve(RECORDINGS_DIR),
		},
		exports: asFolder("exports"),
		temp: asFolder("temp"),
		captionModels: asFolder("captionModels"),
		cache: asFolder("cache"),
	};
}

async function assertWritableDirectory(directory: string) {
	await fs.mkdir(directory, { recursive: true });
	await fs.access(directory, fsConstants.W_OK);
}

async function applyFolderSelection(id: StorageFolderId, directory: string) {
	const resolved = path.resolve(directory);
	await assertWritableDirectory(resolved);
	if (id === "projects") {
		// The library always reads `<recordingsDir>/Projects`, so adopt the parent
		// folder the user actually picked and let the managed name stay in place.
		await persistRecordingsDirectorySetting(path.dirname(resolved));
		return;
	}
	if (id === "recordings") {
		await persistRecordingsDirectorySetting(resolved);
		return;
	}
	const result = await updateStorageLocations({ [id]: resolved });
	if (result.warnings.length) throw new Error(result.warnings.join("; "));
}

export function registerStorageLocationHandlers() {
	const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => {
		ipcMain.handle(channel, (event, ...args) => {
			if (!isTrustedRenderer(event)) return { success: false };
			return listener(event, ...args);
		});
	};

	handle("storage-locations:get", async () => {
		try {
			return { success: true, folders: await listStorageFolders() };
		} catch (error) {
			console.error("Could not read storage locations:", error);
			return { success: false, error: String(error) };
		}
	});

	handle("storage-locations:choose", async (event, id: unknown) => {
		if (!isStorageFolderId(id))
			return { success: false, error: "Unknown storage location" };
		try {
			const folders = await listStorageFolders();
			const options: Electron.OpenDialogOptions = {
				title: nativeT("chooseFolder"),
				defaultPath: folders[id].path,
				properties: ["openDirectory", "createDirectory", "promptToCreate"],
			};
			const window = BrowserWindow.fromWebContents(event.sender);
			const result = window
				? await dialog.showOpenDialog(window, options)
				: await dialog.showOpenDialog(options);
			if (result.canceled || !result.filePaths.length)
				return { success: false, canceled: true, path: folders[id].path };

			const selected = path.resolve(result.filePaths[0]);
			await applyFolderSelection(id, selected);
			return {
				success: true,
				path: selected,
				folders: await listStorageFolders(),
			};
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	handle("storage-locations:open", async (_, id: unknown) => {
		if (!isStorageFolderId(id))
			return { success: false, error: "Unknown storage location" };
		try {
			const folders = await listStorageFolders();
			await fs.mkdir(folders[id].path, { recursive: true });
			const message = await shell.openPath(folders[id].path);
			return message ? { success: false, error: message } : { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	handle("storage-locations:reset", async (_, id: unknown) => {
		if (!isStorageFolderId(id))
			return { success: false, error: "Unknown storage location" };
		try {
			if (id === "recordings" || id === "projects") {
				await persistRecordingsDirectorySetting(RECORDINGS_DIR);
			} else if (isStorageLocationKey(id)) {
				await updateStorageLocations({ [id]: null });
			}
			return { success: true, folders: await listStorageFolders() };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	handle("storage-locations:reset-all", async () => {
		try {
			await persistRecordingsDirectorySetting(RECORDINGS_DIR);
			await resetStorageLocations();
			return { success: true, folders: await listStorageFolders() };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
}

/** Kept exported so other modules can resolve a location without re-reading. */
export { getStorageLocation };
export type { StorageLocationKey };
