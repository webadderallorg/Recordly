import { constants as fsConstants } from "node:fs";
import { existsSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { RECORDINGS_DIR, USER_DATA_PATH } from "../../appPaths";
import { isSupportedLocalMediaPath } from "../../mediaTypes";
import {
	PROJECT_FILE_EXTENSION,
	LEGACY_PROJECT_FILE_EXTENSIONS,
	PROJECTS_DIRECTORY_NAME,
	PROJECT_THUMBNAIL_SUFFIX,
	RECENT_PROJECTS_FILE,
	MAX_RECENT_PROJECTS,
	RECORDINGS_SETTINGS_FILE,
} from "../constants";
import type { ProjectLibraryEntry, RecordingSessionData } from "../types";
import {
	currentProjectPath,
	setCurrentProjectPath,
	setCurrentVideoPath,
	setCurrentRecordingSession,
	approvedLocalReadPaths,
	setCustomRecordingsDir,
	setRecordingsDirLoaded,
} from "../state";
import {
	normalizePath,
	normalizeVideoSourcePath,
	getRecordingsDir,
} from "../utils";


export { normalizePath, normalizeVideoSourcePath };

export function getAssetRootPath() {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, "assets");
	}

	return path.join(app.getAppPath(), "public");
}

export function isPathInsideDirectory(candidatePath: string, directoryPath: string) {
	const normalizedCandidatePath = normalizePath(candidatePath);
	const normalizedDirectoryPath = normalizePath(directoryPath);
	return (
		normalizedCandidatePath === normalizedDirectoryPath ||
		normalizedCandidatePath.startsWith(`${normalizedDirectoryPath}${path.sep}`)
	);
}

export function isAllowedLocalReadPath(candidatePath: string) {
	const allowedPrefixes = [RECORDINGS_DIR, USER_DATA_PATH, getAssetRootPath(), app.getPath("temp")];
	const normalizedCandidatePath = normalizePath(candidatePath);

	// Canonicalize so a symlink placed under an allowed prefix can't smuggle in a
	// target that lives outside it. realpathSync throws when the path doesn't
	// exist yet (e.g. a pending export approved before the file is written) — in
	// that case fall back to the lexical path, which can only succeed via the
	// approvedLocalReadPaths check below since no symlink target exists yet.
	let canonicalCandidatePath = normalizedCandidatePath;
	try {
		canonicalCandidatePath = normalizePath(realpathSync(normalizedCandidatePath));
	} catch {
		// File may not exist yet; keep the lexical path.
	}

	// Security: only allow paths under app-managed directories or paths the user
	// has explicitly opted into (recording session sources, files chosen via
	// dialog, app-produced exports). The lexical path must satisfy the policy
	// AND the canonical (real) path must satisfy it too, so a symlink under an
	// allowed prefix that points outside the allowlist is rejected. Previously
	// this returned true for any existing file, which made the allowlist a no-op
	// for read-local-file and the local media URL handler.
	const lexicalAllowed =
		allowedPrefixes.some((prefix) => isPathInsideDirectory(normalizedCandidatePath, prefix)) ||
		approvedLocalReadPaths.has(normalizedCandidatePath);
	if (!lexicalAllowed) {
		return false;
	}

	if (canonicalCandidatePath === normalizedCandidatePath) {
		return true;
	}

	return (
		allowedPrefixes.some((prefix) => isPathInsideDirectory(canonicalCandidatePath, prefix)) ||
		approvedLocalReadPaths.has(canonicalCandidatePath)
	);
}

// Keep loopback media-server access restricted to allowlisted or explicitly
// approved files. Direct renderer-side read-local-file calls can be more
// permissive, but URL-based serving must stay scoped so arbitrary paths do not
// become fetchable inside the app.
export async function isAllowedLocalMediaPath(candidatePath: string) {
	const normalizedCandidatePath = normalizePath(candidatePath);
	return isAllowedLocalReadPath(normalizedCandidatePath);
}

async function collectApprovedLocalReadPaths(filePath?: string | null): Promise<string[]> {
	const normalizedPath = normalizeVideoSourcePath(filePath);
	if (!normalizedPath) {
		return [];
	}

	const approvedPaths = [normalizePath(normalizedPath)];

	try {
		const realPath = await fs.realpath(approvedPaths[0]);
		const normalizedRealPath = normalizePath(realPath);
		if (!approvedPaths.includes(normalizedRealPath)) {
			approvedPaths.push(normalizedRealPath);
		}
	} catch {
		// Ignore missing files; the eventual read will surface the real error.
	}

	return approvedPaths;
}

export async function rememberApprovedLocalReadPath(filePath?: string | null) {
	const normalizedPath = normalizeVideoSourcePath(filePath);
	if (!normalizedPath) {
		return;
	}

	const approvedPaths = await collectApprovedLocalReadPaths(normalizedPath);
	for (const approvedPath of approvedPaths) {
		approvedLocalReadPaths.add(approvedPath);
	}
}

export async function resolveApprovedLocalMediaPath(candidatePath: string): Promise<string | null> {
	const normalizedCandidatePath = normalizePath(candidatePath);
	const realPath = await fs.realpath(normalizedCandidatePath).catch(() => null);

	if (!realPath) {
		return null;
	}

	const stat = await fs.stat(realPath).catch(() => null);
	if (!stat?.isFile() || !isSupportedLocalMediaPath(realPath)) {
		return null;
	}

	if (!(await isAllowedLocalMediaPath(realPath))) {
		return null;
	}

	await rememberApprovedLocalReadPath(candidatePath);
	return realPath;
}

export async function replaceApprovedSessionLocalReadPaths(filePaths: Array<string | null | undefined>) {
	const nextApprovedPaths = new Set<string>();
	const approvedPathLists = await Promise.all(
		filePaths.map((filePath) => collectApprovedLocalReadPaths(filePath)),
	);

	for (const approvedPathList of approvedPathLists) {
		for (const approvedPath of approvedPathList) {
			nextApprovedPaths.add(approvedPath);
		}
	}

	approvedLocalReadPaths.clear();
	for (const approvedPath of nextApprovedPaths) {
		approvedLocalReadPaths.add(approvedPath);
	}
}

export async function resolveProjectMediaSources(project: unknown): Promise<
	| { success: true; videoPath: string; webcamPath: string | null }
	| { success: false; message: string }
> {
	if (!project || typeof project !== "object") {
		return { success: false, message: "Invalid project file format" };
	}

	const rawVideoPath = (project as { videoPath?: unknown }).videoPath;
	if (typeof rawVideoPath !== "string") {
		return { success: false, message: "Project file is missing a video path" };
	}

	const normalizedVideoPath = normalizeVideoSourcePath(rawVideoPath);
	if (!normalizedVideoPath) {
		return { success: false, message: "Project file is missing a valid video path" };
	}

	try {
		await fs.access(normalizedVideoPath, fsConstants.F_OK);
	} catch {
		return {
			success: false,
			message: `Project video file not found: ${normalizedVideoPath}`,
		};
	}

	const rawWebcamPath =
		typeof (project as { editor?: { webcam?: { sourcePath?: unknown } } }).editor?.webcam
			?.sourcePath === "string"
			? ((project as { editor?: { webcam?: { sourcePath?: string } } }).editor?.webcam
					?.sourcePath ?? null)
			: null;
	const normalizedWebcamPath = normalizeVideoSourcePath(rawWebcamPath);

	if (!normalizedWebcamPath) {
		return {
			success: true,
			videoPath: normalizedVideoPath,
			webcamPath: null,
		};
	}

	try {
		await fs.access(normalizedWebcamPath, fsConstants.F_OK);
		return {
			success: true,
			videoPath: normalizedVideoPath,
			webcamPath: normalizedWebcamPath,
		};
	} catch {
		return {
			success: true,
			videoPath: normalizedVideoPath,
			webcamPath: null,
		};
	}
}

export async function getProjectsDir() {
	const projectsDir = path.join(await getRecordingsDir(), PROJECTS_DIRECTORY_NAME);
	await fs.mkdir(projectsDir, { recursive: true });
	return projectsDir;
}

export async function persistRecordingsDirectorySetting(nextDir: string) {
	setCustomRecordingsDir(path.resolve(nextDir));
	setRecordingsDirLoaded(true);
	await fs.writeFile(
		RECORDINGS_SETTINGS_FILE,
		JSON.stringify({ recordingsDir: path.resolve(nextDir) }, null, 2),
		"utf-8",
	);
}

export function hasProjectFileExtension(filePath: string) {
	const extension = path.extname(filePath).replace(/^\./, "").toLowerCase();
	return [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS].includes(extension);
}

export function getProjectThumbnailPath(projectPath: string) {
	return `${projectPath}${PROJECT_THUMBNAIL_SUFFIX}`;
}

export async function saveProjectThumbnail(projectPath: string, thumbnailDataUrl?: string | null) {
	const thumbnailPath = getProjectThumbnailPath(projectPath);
	if (thumbnailDataUrl === undefined) {
		return existsSync(thumbnailPath) ? thumbnailPath : null;
	}

	if (!thumbnailDataUrl) {
		await fs.rm(thumbnailPath, { force: true }).catch(() => undefined);
		return null;
	}

	const match = thumbnailDataUrl.match(/^data:image\/png;base64,(.+)$/);
	if (!match) {
		throw new Error("Project thumbnail must be a PNG data URL.");
	}

	await fs.writeFile(thumbnailPath, Buffer.from(match[1], "base64"));
	return thumbnailPath;
}

export async function loadRecentProjectPaths() {
	try {
		const content = await fs.readFile(RECENT_PROJECTS_FILE, "utf-8");
		const parsed = JSON.parse(content) as { paths?: unknown };
		return Array.isArray(parsed.paths)
			? parsed.paths.filter(
					(value): value is string =>
						typeof value === "string" && value.trim().length > 0,
				)
			: [];
	} catch {
		return [];
	}
}

export async function saveRecentProjectPaths(paths: string[]) {
	const normalizedPaths = Array.from(new Set(paths.map((value) => normalizePath(value)))).slice(
		0,
		MAX_RECENT_PROJECTS,
	);
	await fs.writeFile(
		RECENT_PROJECTS_FILE,
		JSON.stringify({ paths: normalizedPaths }, null, 2),
		"utf-8",
	);
}

export async function rememberRecentProject(projectPath: string) {
	if (!hasProjectFileExtension(projectPath)) {
		return;
	}

	const existingPaths = await loadRecentProjectPaths();
	await saveRecentProjectPaths([projectPath, ...existingPaths]);
}

export async function buildProjectLibraryEntry(
	projectPath: string,
	projectsDir: string,
): Promise<ProjectLibraryEntry | null> {
	try {
		const normalizedPath = normalizePath(projectPath);
		if (!hasProjectFileExtension(normalizedPath)) {
			return null;
		}

		const stats = await fs.stat(normalizedPath);
		if (!stats.isFile()) {
			return null;
		}

		const thumbnailPath = getProjectThumbnailPath(normalizedPath);
		const thumbnailExists = await fs
			.access(thumbnailPath, fsConstants.R_OK)
			.then(() => true)
			.catch(() => false);

		return {
			path: normalizedPath,
			name: path.basename(normalizedPath).replace(
			new RegExp(`\\.(${[PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS].join("|")})$`, "i"),
			"",
		),
			updatedAt: stats.mtimeMs,
			thumbnailPath: thumbnailExists ? thumbnailPath : null,
			isCurrent: Boolean(
				currentProjectPath && normalizePath(currentProjectPath) === normalizedPath,
			),
			isInProjectsDirectory: path.dirname(normalizedPath) === normalizePath(projectsDir),
		};
	} catch {
		return null;
	}
}

export async function listProjectLibraryEntries() {
	const projectsDir = await getProjectsDir();
	const projectPaths: string[] = [];

	try {
		const entries = await fs.readdir(projectsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) {
				continue;
			}

			const entryPath = path.join(projectsDir, entry.name);
			if (hasProjectFileExtension(entryPath)) {
				projectPaths.push(entryPath);
			}
		}
	} catch {
		// Ignore directory read failures and fall back to recent files.
	}

	const recentProjectPaths = await loadRecentProjectPaths();
	const candidatePaths = Array.from(new Set([...projectPaths, ...recentProjectPaths]));
	const entries = (
		await Promise.all(
			candidatePaths.map((candidatePath) =>
				buildProjectLibraryEntry(candidatePath, projectsDir),
			),
		)
	)
		.filter((entry): entry is ProjectLibraryEntry => entry != null)
		.sort((left, right) => right.updatedAt - left.updatedAt);

	await saveRecentProjectPaths(entries.map((entry) => entry.path));

	return {
		projectsDir,
		entries,
	};
}

export async function loadProjectFromPath(projectPath: string) {
	const normalizedPath = normalizePath(projectPath);
	let project: unknown;
	try {
		const content = await fs.readFile(normalizedPath, "utf-8");
		project = JSON.parse(content);
	} catch (error) {
		return {
			success: false,
			canceled: false,
			message: `Failed to read project file: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const mediaSources = await resolveProjectMediaSources(project);

	if (!mediaSources.success) {
		return {
			success: false,
			canceled: false,
			message: mediaSources.message,
		};
	}
	const projectObj = project as Record<string, unknown>;
	const editorObj = projectObj?.editor as Record<string, unknown> | undefined;
	const audioTracks = editorObj?.audioTracks as { sourcePath?: unknown }[] | undefined;
	const approvedProjectPaths: Array<string | null | undefined> = [
		mediaSources.videoPath,
		mediaSources.webcamPath,
	];
	if (Array.isArray(audioTracks)) {
		for (const track of audioTracks) {
			if (typeof track?.sourcePath === "string") {
				approvedProjectPaths.push(track.sourcePath);
			}
		}
	}
	await replaceApprovedSessionLocalReadPaths(approvedProjectPaths);
	await rememberRecentProject(normalizedPath);

	setCurrentProjectPath(normalizedPath);
	setCurrentVideoPath(mediaSources.videoPath);
	setCurrentRecordingSession({
		videoPath: mediaSources.videoPath,
		webcamPath: mediaSources.webcamPath,
		timeOffsetMs: 0,
	} as RecordingSessionData);

	return {
		success: true,
		path: normalizedPath,
		project,
	};
}

export function isTrustedProjectPath(filePath?: string | null): boolean {
	if (!filePath || !currentProjectPath) return false;
	return normalizePath(filePath) === normalizePath(currentProjectPath);
}
