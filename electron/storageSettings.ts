import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

export const STORAGE_SETTINGS_FILE_NAME = "storage-settings.json";
export const WORKSPACE_DIRECTORY_NAME = "RecordlyData";

export interface WorkspaceLayout {
	root: string;
	recordings: string;
	projects: string;
	temp: string;
	cache: string;
}

interface StorageSettingsFile {
	version: 1;
	workspaceRoot: string;
}

interface AppPathController {
	getPath(name: "temp" | "sessionData"): string;
	setPath(name: "temp" | "sessionData", value: string): void;
}

let activeWorkspaceRoot: string | null = null;
let workspaceInitializationError: string | null = null;

export function resolveWorkspaceLayout(workspaceRoot: string): WorkspaceLayout {
	const root = path.resolve(workspaceRoot);
	return {
		root,
		recordings: path.join(root, "Recordings"),
		projects: path.join(root, "Projects"),
		temp: path.join(root, "Temp"),
		cache: path.join(root, "Cache"),
	};
}

export function getStorageSettingsPath(userDataPath: string) {
	return path.join(userDataPath, STORAGE_SETTINGS_FILE_NAME);
}

export function normalizeWorkspaceRoot(value: unknown): string | null {
	if (typeof value !== "string" || value.trim().length === 0) {
		return null;
	}

	return path.resolve(value.trim());
}

export function readWorkspaceRootSync(userDataPath: string): string | null {
	try {
		const content = fs.readFileSync(getStorageSettingsPath(userDataPath), "utf-8");
		const parsed = JSON.parse(content) as Partial<StorageSettingsFile>;
		return normalizeWorkspaceRoot(parsed.workspaceRoot);
	} catch {
		return null;
	}
}

function ensureWorkspaceLayoutSync(layout: WorkspaceLayout) {
	for (const directoryPath of Object.values(layout)) {
		fs.mkdirSync(directoryPath, { recursive: true });
	}
}

export async function ensureWorkspaceLayout(layout: WorkspaceLayout) {
	await Promise.all(
		Object.values(layout).map((directoryPath) =>
			fsPromises.mkdir(directoryPath, { recursive: true }),
		),
	);
}

export function initializeWorkspaceStorage(
	app: AppPathController,
	userDataPath: string,
): WorkspaceLayout | null {
	const configuredRoot = readWorkspaceRootSync(userDataPath);
	if (!configuredRoot) {
		activeWorkspaceRoot = null;
		workspaceInitializationError = null;
		return null;
	}

	const layout = resolveWorkspaceLayout(configuredRoot);
	try {
		ensureWorkspaceLayoutSync(layout);
		app.setPath("temp", layout.temp);
		app.setPath("sessionData", layout.cache);
		activeWorkspaceRoot = layout.root;
		workspaceInitializationError = null;
		return layout;
	} catch (error) {
		// A removable drive or network share may be unavailable during startup.
		// Keep Recordly usable with Electron's default paths and surface the error
		// through the storage status IPC instead of failing app startup.
		activeWorkspaceRoot = null;
		workspaceInitializationError = error instanceof Error ? error.message : String(error);
		return null;
	}
}

export function getActiveWorkspaceLayout(): WorkspaceLayout | null {
	return activeWorkspaceRoot ? resolveWorkspaceLayout(activeWorkspaceRoot) : null;
}

export function getWorkspaceInitializationError() {
	return workspaceInitializationError;
}

export async function persistWorkspaceRoot(userDataPath: string, workspaceRoot: string) {
	const layout = resolveWorkspaceLayout(workspaceRoot);
	await ensureWorkspaceLayout(layout);
	await fsPromises.mkdir(userDataPath, { recursive: true });

	const settingsPath = getStorageSettingsPath(userDataPath);
	const temporaryPath = `${settingsPath}.tmp`;
	const settings: StorageSettingsFile = {
		version: 1,
		workspaceRoot: layout.root,
	};

	await fsPromises.writeFile(temporaryPath, JSON.stringify(settings, null, 2), "utf-8");
	await fsPromises.rename(temporaryPath, settingsPath);
	activeWorkspaceRoot = layout.root;
	workspaceInitializationError = null;
	return layout;
}

export function getWorkspaceRootFromSelectedDirectory(selectedDirectory: string) {
	const selectedPath = path.resolve(selectedDirectory);
	return path.basename(selectedPath).toLowerCase() === WORKSPACE_DIRECTORY_NAME.toLowerCase()
		? selectedPath
		: path.join(selectedPath, WORKSPACE_DIRECTORY_NAME);
}

async function getPathSize(targetPath: string): Promise<number> {
	let stats: fs.Stats;
	try {
		stats = await fsPromises.lstat(targetPath);
	} catch {
		return 0;
	}
	if (stats.isSymbolicLink()) {
		return 0;
	}

	if (!stats.isDirectory()) {
		return stats.size;
	}

	const entries = await fsPromises.readdir(targetPath, { withFileTypes: true });
	const sizes = await Promise.all(
		entries.map((entry) => getPathSize(path.join(targetPath, entry.name))),
	);
	return sizes.reduce((total, size) => total + size, 0);
}

function getRelativePathInside(parentPath: string, candidatePath: string): string | null {
	const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
	if (relativePath === "") {
		return "";
	}
	if (
		relativePath.startsWith(`..${path.sep}`) ||
		relativePath === ".." ||
		path.isAbsolute(relativePath)
	) {
		return null;
	}
	return relativePath;
}

function replaceStoredPathPrefix(
	value: string,
	sourcePath: string,
	destinationPath: string,
): string {
	const relativePath = getRelativePathInside(sourcePath, value);
	return relativePath === null ? value : path.join(destinationPath, relativePath);
}

function rewriteStoredPaths(
	value: unknown,
	mappings: Array<{ source: string; destination: string }>,
): unknown {
	if (typeof value === "string" && path.isAbsolute(value)) {
		return mappings.reduce(
			(current, mapping) =>
				replaceStoredPathPrefix(current, mapping.source, mapping.destination),
			value,
		);
	}
	if (Array.isArray(value)) {
		return value.map((item) => rewriteStoredPaths(item, mappings));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, rewriteStoredPaths(item, mappings)]),
		);
	}
	return value;
}

export interface WorkspaceMigrationSource {
	recordings: string;
	projects: string;
}

export interface WorkspaceMigrationCopy {
	source: string;
	destination: string;
}

export interface WorkspaceMigrationResult {
	copiedCount: number;
	copiedBytes: number;
	skippedConflicts: number;
	skippedLinks: number;
	copiedFiles: WorkspaceMigrationCopy[];
}

export async function getStorageMigrationUsage(source: WorkspaceMigrationSource) {
	const projectsInsideRecordings = getRelativePathInside(source.recordings, source.projects);
	const recordingsBytes = await getPathSize(source.recordings);
	const projectsBytes =
		projectsInsideRecordings === null ? await getPathSize(source.projects) : 0;
	return recordingsBytes + projectsBytes;
}

async function rewriteMigratedProjectFile(
	projectPath: string,
	source: WorkspaceMigrationSource,
	destination: WorkspaceLayout,
) {
	if (!/[.](?:recordly|json)$/i.test(projectPath)) {
		return;
	}

	try {
		const content = await fsPromises.readFile(projectPath, "utf-8");
		const project = JSON.parse(content) as unknown;
		const rewritten = rewriteStoredPaths(project, [
			{ source: source.projects, destination: destination.projects },
			{ source: source.recordings, destination: destination.recordings },
		]);
		const temporaryPath = `${projectPath}.migration.tmp`;
		await fsPromises.writeFile(temporaryPath, JSON.stringify(rewritten, null, 2), "utf-8");
		await fsPromises.rename(temporaryPath, projectPath);
	} catch {
		// Not every JSON file in Projects is a Recordly project. Leave unknown files unchanged.
	}
}

export async function migrateStorageData(
	source: WorkspaceMigrationSource,
	destination: WorkspaceLayout,
): Promise<WorkspaceMigrationResult> {
	const result: WorkspaceMigrationResult = {
		copiedCount: 0,
		copiedBytes: 0,
		skippedConflicts: 0,
		skippedLinks: 0,
		copiedFiles: [],
	};

	for (const sourceRoot of [source.recordings, source.projects]) {
		if (getRelativePathInside(sourceRoot, destination.root) !== null) {
			throw new Error(
				"The new RecordlyData folder cannot be inside the current storage folder.",
			);
		}
	}

	const copyTree = async (
		sourceDirectory: string,
		destinationDirectory: string,
		excludedDirectory?: string,
	): Promise<void> => {
		let entries: fs.Dirent[];
		try {
			entries = await fsPromises.readdir(sourceDirectory, { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			throw error;
		}

		await fsPromises.mkdir(destinationDirectory, { recursive: true });
		for (const entry of entries) {
			const sourcePath = path.join(sourceDirectory, entry.name);
			if (excludedDirectory && path.resolve(sourcePath) === path.resolve(excludedDirectory)) {
				continue;
			}

			const destinationPath = path.join(destinationDirectory, entry.name);
			if (entry.isDirectory()) {
				await copyTree(sourcePath, destinationPath, excludedDirectory);
				continue;
			}
			if (!entry.isFile()) {
				result.skippedLinks += 1;
				continue;
			}

			await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
			try {
				await fsPromises.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") {
					result.skippedConflicts += 1;
					continue;
				}
				throw error;
			}

			const stats = await fsPromises.stat(sourcePath);
			result.copiedCount += 1;
			result.copiedBytes += stats.size;
			result.copiedFiles.push({ source: sourcePath, destination: destinationPath });
		}
	};

	const projectsInsideRecordings = getRelativePathInside(source.recordings, source.projects);
	if (path.resolve(source.recordings) !== path.resolve(destination.recordings)) {
		await copyTree(
			source.recordings,
			destination.recordings,
			projectsInsideRecordings === null ? undefined : source.projects,
		);
	}
	if (path.resolve(source.projects) !== path.resolve(destination.projects)) {
		const copiedBeforeProjects = result.copiedFiles.length;
		await copyTree(source.projects, destination.projects);
		for (const copiedFile of result.copiedFiles.slice(copiedBeforeProjects)) {
			await rewriteMigratedProjectFile(copiedFile.destination, source, destination);
		}
	}

	return result;
}

async function removeEmptyDirectories(directoryPath: string, keepRoot: boolean): Promise<boolean> {
	let entries: fs.Dirent[];
	try {
		entries = await fsPromises.readdir(directoryPath, { withFileTypes: true });
	} catch {
		return false;
	}

	for (const entry of entries) {
		if (entry.isDirectory()) {
			await removeEmptyDirectories(path.join(directoryPath, entry.name), false);
		}
	}

	const remainingEntries = await fsPromises.readdir(directoryPath).catch(() => ["unavailable"]);
	if (remainingEntries.length > 0 || keepRoot) {
		return false;
	}
	await fsPromises.rmdir(directoryPath).catch(() => undefined);
	return true;
}

export async function deleteMigratedSourceFiles(
	copiedFiles: WorkspaceMigrationCopy[],
	sourceRoots: string[],
) {
	let deletedCount = 0;
	let deletedBytes = 0;

	for (const copiedFile of copiedFiles) {
		if (!sourceRoots.some((root) => getRelativePathInside(root, copiedFile.source) !== null)) {
			continue;
		}
		const destinationStats = await fsPromises.stat(copiedFile.destination).catch(() => null);
		const sourceStats = await fsPromises.stat(copiedFile.source).catch(() => null);
		if (!destinationStats?.isFile() || !sourceStats?.isFile()) {
			continue;
		}
		await fsPromises.unlink(copiedFile.source);
		deletedCount += 1;
		deletedBytes += sourceStats.size;
	}

	for (const sourceRoot of sourceRoots) {
		await removeEmptyDirectories(sourceRoot, true);
	}
	return { deletedCount, deletedBytes };
}

export async function getWorkspaceUsage(layout: WorkspaceLayout) {
	const [recordingsBytes, projectsBytes, tempBytes, cacheBytes] = await Promise.all([
		getPathSize(layout.recordings),
		getPathSize(layout.projects),
		getPathSize(layout.temp),
		getPathSize(layout.cache),
	]);

	return {
		recordingsBytes,
		projectsBytes,
		tempBytes,
		cacheBytes,
		totalBytes: recordingsBytes + projectsBytes + tempBytes + cacheBytes,
	};
}

const RECORDLY_TEMP_ARTIFACT_PREFIXES = ["recordly-"];

export async function cleanupRecordlyTempArtifacts(
	tempDirectory: string,
	minimumAgeMs = 60 * 60 * 1_000,
) {
	const now = Date.now();
	let removedBytes = 0;
	let removedCount = 0;
	let entries: fs.Dirent[];

	try {
		entries = await fsPromises.readdir(tempDirectory, { withFileTypes: true });
	} catch {
		return { removedBytes, removedCount };
	}

	for (const entry of entries) {
		if (!RECORDLY_TEMP_ARTIFACT_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
			continue;
		}

		const artifactPath = path.join(tempDirectory, entry.name);
		const stats = await fsPromises.stat(artifactPath).catch(() => null);
		if (!stats || now - stats.mtimeMs < minimumAgeMs) {
			continue;
		}

		const artifactBytes = await getPathSize(artifactPath);
		try {
			await fsPromises.rm(artifactPath, { force: true, recursive: true });
			removedBytes += artifactBytes;
			removedCount += 1;
		} catch {
			// The artifact may still be held by an encoder. Leave it for the next pass.
		}
	}

	return { removedBytes, removedCount };
}
