/**
 * Storage folders as the renderer sees them.
 *
 * Declared here rather than under `electron/` so the settings UI can import the
 * shape without reaching into the main-process tree, matching how other shared
 * renderer types (for example `recordingLibrary`) are organised.
 */

export const STORAGE_FOLDER_IDS = [
	"recordings",
	"projects",
	"exports",
	"temp",
	"captionModels",
	"cache",
] as const;

export type StorageFolderId = (typeof STORAGE_FOLDER_IDS)[number];

export type StorageFolder = {
	id: StorageFolderId;
	/** Folder currently in use. */
	path: string;
	/** Folder used when nothing is configured. */
	fallback: string;
	/** True when `path` comes from the user's settings. */
	configured: boolean;
};

export type StorageFoldersResponse = {
	success: boolean;
	folders?: Record<StorageFolderId, StorageFolder>;
	error?: string;
};

export type StorageFolderMutationResponse = StorageFoldersResponse & {
	canceled?: boolean;
	path?: string;
};
