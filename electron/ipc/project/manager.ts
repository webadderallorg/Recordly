import { createHash, randomUUID } from "node:crypto";
import { realpathSync, type Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { ProjectPreviewData } from "../../../src/types/projectPreview";
import { RECORDINGS_DIR, USER_DATA_PATH } from "../../appPaths";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import { isSupportedLocalMediaPath } from "../../mediaTypes";
import {
	LEGACY_PROJECT_FILE_EXTENSIONS,
	MAX_RECENT_PROJECTS,
	PROJECT_FILE_EXTENSION,
	PROJECT_THUMBNAIL_SUFFIX,
	PROJECTS_DIRECTORY_NAME,
	RECENT_PROJECTS_FILE,
} from "../constants";
import { recordingPreferencesStore } from "../settings/recordingPreferencesStore";
import {
	approvedLocalReadPaths,
	currentProjectPath,
	setCurrentProjectPath,
	setCurrentRecordingSession,
	setCurrentVideoPath,
	setCustomRecordingsDir,
	setRecordingsDirLoaded,
} from "../state";
import type { ProjectLibraryEntry, RecordingSessionData } from "../types";
import {
	getRecordingsDirPath,
	normalizePath,
	normalizeVideoSourcePath,
	parseJsonWithByteOrderMark,
} from "../utils";
import {
	getProjectStorageKey,
	readProjectFileWithRecovery,
	setProjectRecoveryDirectory,
} from "./atomicSave";
import { canonicalMediaSources } from "./canonicalMediaSources";
import { encodeComposedThumbnail } from "./composedThumbnail";
import { createProjectFirstFrameThumbnail } from "./firstFrameThumbnail";
import { applyRelinkedProjectMedia, resolveProjectMediaSources } from "./projectMedia";
import { hasFreshProjectThumbnail } from "./thumbnailFreshness";

setProjectRecoveryDirectory(path.join(USER_DATA_PATH, "project-recovery"), (contents) =>
	isLoadableProjectData(parseJsonWithByteOrderMark(contents)),
);

export { normalizePath, normalizeVideoSourcePath };
export { resolveProjectMediaSources } from "./projectMedia";

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
	const allowedPrefixes = [
		RECORDINGS_DIR,
		USER_DATA_PATH,
		getAssetRootPath(),
		app.getPath("temp"),
	];
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

async function collectApprovedLocalReadPaths(
	filePath?: string | null,
	resolveAliases = true,
): Promise<string[]> {
	const normalizedPath = normalizeVideoSourcePath(filePath);
	if (!normalizedPath) {
		return [];
	}

	const approvedPaths = [normalizePath(normalizedPath)];
	if (!resolveAliases) return approvedPaths;

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

export async function rememberApprovedLocalReadPath(
	filePath?: string | null,
	resolveAliases = true,
) {
	const normalizedPath = normalizeVideoSourcePath(filePath);
	if (!normalizedPath) {
		return;
	}

	const approvedPaths = await collectApprovedLocalReadPaths(normalizedPath, resolveAliases);
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

	// Register only the literal and the target checked above. Resolving the alias
	// again could approve a replacement symlink target that was never validated.
	approvedLocalReadPaths.add(normalizePath(candidatePath));
	approvedLocalReadPaths.add(normalizePath(realPath));
	return realPath;
}

export async function replaceApprovedSessionLocalReadPaths(
	filePaths: Array<string | null | undefined>,
	isCurrent = () => true,
	exactPaths: ReadonlySet<string> = new Set(),
) {
	const nextApprovedPaths = new Set<string>();
	const approvedPathLists = await Promise.all(
		filePaths.map((filePath) =>
			collectApprovedLocalReadPaths(filePath, !filePath || !exactPaths.has(filePath)),
		),
	);

	for (const approvedPathList of approvedPathLists) {
		for (const approvedPath of approvedPathList) {
			nextApprovedPaths.add(approvedPath);
		}
	}

	if (!isCurrent()) return false;
	approvedLocalReadPaths.clear();
	for (const approvedPath of nextApprovedPaths) {
		approvedLocalReadPaths.add(approvedPath);
	}
	return true;
}

export async function getProjectsDirPath() {
	return path.join(await getRecordingsDirPath(), PROJECTS_DIRECTORY_NAME);
}

export async function getProjectsDir() {
	const projectsDir = await getProjectsDirPath();
	await fs.mkdir(projectsDir, { recursive: true });
	return projectsDir;
}

export async function persistRecordingsDirectorySetting(nextDir: string) {
	const recordingsDir = path.resolve(nextDir);
	await recordingPreferencesStore.update({ recordingsDir });
	setCustomRecordingsDir(recordingsDir);
	setRecordingsDirLoaded(true);
}

export function hasProjectFileExtension(filePath: string) {
	const extension = path.extname(filePath).replace(/^\./, "").toLowerCase();
	return [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS].includes(extension);
}

export async function getProjectThumbnailPath(projectPath: string) {
	return projectThumbnailStoragePath(await getProjectStorageKey(projectPath));
}

function projectThumbnailStoragePath(key: string) {
	const digest = createHash("sha256").update(key).digest("hex");
	return path.join(USER_DATA_PATH, "project-thumbnails", `${digest}.png`);
}

export function getLegacyProjectThumbnailPath(projectPath: string) {
	return `${projectPath}${PROJECT_THUMBNAIL_SUFFIX}`;
}

export async function getProjectThumbnailPaths(projectPath: string) {
	const resolved = path.resolve(projectPath);
	const oldKey = process.platform === "win32" ? resolved.toLowerCase() : resolved;
	return [
		...new Set([
			await getProjectThumbnailPath(projectPath),
			projectThumbnailStoragePath(oldKey),
			getLegacyProjectThumbnailPath(projectPath),
		]),
	];
}

async function findFreshProjectThumbnail(projectPath: string, modifiedAt: number) {
	for (const thumbnailPath of await getProjectThumbnailPaths(projectPath)) {
		const stats = await fs.lstat(thumbnailPath).catch(() => null);
		if (stats?.isFile() && (await hasFreshProjectThumbnail(thumbnailPath, modifiedAt)))
			return thumbnailPath;
	}
	return null;
}

export async function saveProjectThumbnail(projectPath: string, thumbnailDataUrl?: string | null) {
	const thumbnailPath = await getProjectThumbnailPath(projectPath);
	if (thumbnailDataUrl === undefined) {
		const revision = await fs.stat(projectPath).catch(() => null);
		return findFreshProjectThumbnail(projectPath, revision?.mtimeMs ?? 0);
	}

	if (!thumbnailDataUrl) {
		await fs.rm(thumbnailPath, { force: true }).catch(() => undefined);
		return null;
	}

	const contents = encodeComposedThumbnail(thumbnailDataUrl);
	await fs.mkdir(path.dirname(thumbnailPath), { recursive: true, mode: 0o700 });
	const temporary = `${thumbnailPath}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, contents, { flag: "wx" });
		await fs.rename(temporary, thumbnailPath);
		return thumbnailPath;
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
	}
}

export async function loadRecentProjectPaths() {
	try {
		const content = await fs.readFile(RECENT_PROJECTS_FILE, "utf-8");
		const parsed = parseJsonWithByteOrderMark<{ paths?: unknown }>(content);
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

export type ProjectThumbnailReady = { path: string; thumbnailPath: string; updatedAt: number };
const thumbnailJobs = new Map<string, Promise<ProjectThumbnailReady | null>>();

export async function requireLibraryProject(projectPath: string) {
	if (typeof projectPath !== "string") throw new Error("Invalid project path");
	const normalized = normalizePath(projectPath);
	if (!hasProjectFileExtension(normalized)) throw new Error("Project is not in the library");
	const projectsDir = normalizePath(await getProjectsDirPath());
	if (path.dirname(normalized) === projectsDir && (await fs.lstat(normalized)).isFile())
		return normalized;
	const recent = await loadRecentProjectPaths();
	if (
		!recent.some((entry) => normalizePath(entry) === normalized) ||
		!(await fs.stat(normalized)).isFile()
	)
		throw new Error("Project is not in the library");
	return normalized;
}

function projectPreviewRevision(stats: Stats) {
	return JSON.stringify([stats.mtimeMs, stats.ctimeMs, stats.size, stats.ino, stats.dev]);
}

/** Persist generated previews without changing the project or overwriting a newer edit. */
export async function cacheProjectThumbnail(
	projectPath: string,
	revision: string,
	dataUrl: string,
) {
	if (typeof projectPath !== "string" || typeof revision !== "string")
		throw new Error("Invalid project revision");
	const normalizedPath = await requireLibraryProject(projectPath);
	const stats = await fs.stat(normalizedPath);
	if (projectPreviewRevision(stats) !== revision) return null;
	const png = encodeComposedThumbnail(dataUrl);
	const target = await getProjectThumbnailPath(normalizedPath);
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
		await fs.writeFile(temporary, png, { flag: "wx" });
		// A subsequent project edit must invalidate the cached frame, even if it races this write.
		await fs.utimes(temporary, new Date(), Math.ceil(stats.mtimeMs) / 1000);
		if (!sameProjectRevision(stats, await fs.stat(normalizedPath))) return null;
		await fs.rename(temporary, target);
		return target;
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
	}
}

function sameProjectRevision(left: Stats, right: Stats) {
	return (
		left.mtimeMs === right.mtimeMs &&
		left.ctimeMs === right.ctimeMs &&
		left.size === right.size &&
		left.ino === right.ino &&
		left.dev === right.dev
	);
}

export function refreshProjectThumbnail(projectPath: string, revision: Stats) {
	const pending = thumbnailJobs.get(projectPath);
	if (pending) return pending;
	const task = (async (): Promise<ProjectThumbnailReady | null> => {
		const thumbnailPath = await getProjectThumbnailPath(projectPath);
		let temporary: string | undefined;
		try {
			if (!sameProjectRevision(revision, await fs.stat(projectPath))) return null;
			const project = parseJsonWithByteOrderMark(await fs.readFile(projectPath, "utf-8"));
			if (!isLoadableProjectData(project)) return null;
			const media = await resolveProjectMediaSources(project, projectPath);
			if (!media.success) return null;
			const thumbnail = await createProjectFirstFrameThumbnail(media.videoPath);
			if (!sameProjectRevision(revision, await fs.stat(projectPath))) return null;
			if (!(await hasFreshProjectThumbnail(thumbnailPath, revision.mtimeMs))) {
				temporary = `${thumbnailPath}.${randomUUID()}.tmp`;
				await fs.mkdir(path.dirname(thumbnailPath), { recursive: true, mode: 0o700 });
				await fs.writeFile(temporary, thumbnail, { flag: "wx" });
				// Stamp the source revision, rather than generation time, so a later edit invalidates it.
				await fs.utimes(temporary, new Date(), Math.ceil(revision.mtimeMs) / 1000);
				if (!sameProjectRevision(revision, await fs.stat(projectPath))) return null;
				// Rename replaces a sidecar symlink itself; it never writes through its target.
				await fs.rename(temporary, thumbnailPath);
			}
			return { path: projectPath, thumbnailPath, updatedAt: revision.mtimeMs };
		} catch {
			// Offline, corrupt or deleted media must not hold up the library.
			return null;
		} finally {
			if (temporary) await fs.rm(temporary, { force: true }).catch(() => undefined);
		}
	})().finally(() => thumbnailJobs.delete(projectPath));
	thumbnailJobs.set(projectPath, task);
	return task;
}

export async function buildProjectLibraryEntry(
	projectPath: string,
	projectsDir: string,
	_onThumbnailReady?: (ready: ProjectThumbnailReady) => void,
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

		const thumbnailPath = await findFreshProjectThumbnail(normalizedPath, stats.mtimeMs);
		const thumbnailExists = thumbnailPath !== null;
		// Listed projects may live outside the default recordings directory.
		// Approve only their validated regular sidecar, never its siblings or a symlink target.
		if (thumbnailPath) await rememberApprovedLocalReadPath(thumbnailPath);
		// Missing previews are composed by the renderer from the saved editor state.
		// A source-only ffmpeg frame would discard padding, wallpaper and overlays.

		return {
			path: normalizedPath,
			name: path
				.basename(normalizedPath)
				.replace(
					new RegExp(
						`\\.(${[PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS].join("|")})$`,
						"i",
					),
					"",
				),
			updatedAt: stats.mtimeMs,
			createdAt: stats.birthtimeMs || stats.ctimeMs,
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

export async function listProjectLibraryEntries(
	onThumbnailReady?: (ready: ProjectThumbnailReady) => void,
) {
	const projectsDir = await getProjectsDirPath();
	const projectPaths = new Set<string>();
	let directoryReadable = false;
	let warning: string | undefined;

	try {
		const entries = await fs.readdir(projectsDir, { withFileTypes: true });
		directoryReadable = true;
		for (const entry of entries) {
			if (!entry.isFile()) {
				continue;
			}

			const entryPath = path.join(projectsDir, entry.name);
			if (hasProjectFileExtension(entryPath)) {
				projectPaths.add(entryPath);
			}
		}
	} catch (error) {
		// A new library can be empty. An inaccessible library should still show its recent files.
		if (
			(error as NodeJS.ErrnoException).code !== "ENOENT" ||
			!(await isAbsentProjectsDir(projectsDir))
		) {
			warning = String(error);
		}
	}

	const recentProjectPaths = await loadRecentProjectPaths();
	const candidatePaths = Array.from(new Set([...projectPaths, ...recentProjectPaths]));
	const candidates = await Promise.all(
		candidatePaths.map((candidatePath) =>
			buildProjectLibraryEntry(candidatePath, projectsDir, onThumbnailReady),
		),
	);
	if (
		!warning &&
		candidates.some((entry, index) => !entry && projectPaths.has(candidatePaths[index]))
	) {
		warning = "Some projects in the library could not be checked.";
	}
	const entries = candidates
		.filter((entry): entry is ProjectLibraryEntry => entry != null)
		.sort((left, right) => right.updatedAt - left.updatedAt);

	// Keep remembered paths when the project directory or one of its entries is unavailable.
	if (directoryReadable && !warning)
		await saveRecentProjectPaths(entries.map((entry) => entry.path));

	return {
		projectsDir,
		entries,
		warning,
	};
}

async function isAbsentProjectsDir(projectsDir: string): Promise<boolean> {
	try {
		// lstat detects a dangling link, which readdir also reports as ENOENT.
		await fs.lstat(projectsDir);
		return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
		return fs.stat(path.dirname(projectsDir)).then(
			(directory) => directory.isDirectory(),
			() => false,
		);
	}
}

export function isLoadableProjectData(projectData: unknown): projectData is {
	version: number;
	videoPath: string;
	editor: Record<string, unknown>;
	[key: string]: unknown;
} {
	if (!projectData || typeof projectData !== "object" || Array.isArray(projectData)) {
		return false;
	}

	const candidate = projectData as {
		version?: unknown;
		projectId?: unknown;
		videoPath?: unknown;
		editor?: unknown;
	};

	return (
		typeof candidate.version === "number" &&
		(candidate.projectId === undefined || typeof candidate.projectId === "string") &&
		typeof candidate.videoPath === "string" &&
		candidate.videoPath.trim().length > 0 &&
		candidate.editor != null &&
		typeof candidate.editor === "object" &&
		!Array.isArray(candidate.editor)
	);
}

/** Read a listed project's preview without changing the active project or recording session. */
export async function readProjectPreview(projectPath: string): Promise<ProjectPreviewData> {
	const normalizedPath = await requireLibraryProject(projectPath);
	const revision = await fs.stat(normalizedPath);
	const project = parseJsonWithByteOrderMark(await fs.readFile(normalizedPath, "utf-8"));
	if (!sameProjectRevision(revision, await fs.stat(normalizedPath)))
		throw new Error("Project changed while loading its preview");
	if (!isLoadableProjectData(project)) throw new Error("Invalid project file format");
	const media = await resolveProjectMediaSources(project, normalizedPath);
	if (!media.success) throw new Error(media.message);
	const baseUrl = getMediaServerBaseUrl();
	if (!baseUrl) throw new Error("Media server is not ready");
	const relinked = applyRelinkedProjectMedia(project, media);
	await rememberApprovedLocalReadPath(media.videoPath, !relinked.has(media.videoPath));
	if (media.webcamPath)
		await rememberApprovedLocalReadPath(media.webcamPath, !relinked.has(media.webcamPath));
	for (const item of relinked) {
		await rememberApprovedLocalReadPath(item, false);
	}
	return {
		revision: projectPreviewRevision(revision),
		project: project as ProjectPreviewData["project"],
		videoUrl: buildMediaUrl(baseUrl, media.videoPath),
		webcamUrl: media.webcamPath ? buildMediaUrl(baseUrl, media.webcamPath) : null,
		...(await canonicalMediaSources(project)),
	};
}

export async function loadProjectFromPath(projectPath: string, isCurrent = () => true) {
	const normalizedPath = normalizePath(projectPath);
	let project: unknown;
	let recovered = false;
	try {
		const result = await readProjectFileWithRecovery(normalizedPath, (contents) => {
			const parsed = parseJsonWithByteOrderMark(contents);
			if (!isLoadableProjectData(parsed)) throw new Error("Invalid project file format");
			return parsed;
		});
		project = result.project;
		recovered = result.recovered;
	} catch (error) {
		return {
			success: false,
			canceled: false,
			message:
				error instanceof Error && error.message === "Invalid project file format"
					? error.message
					: `Failed to read project file: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (!isLoadableProjectData(project)) {
		return {
			success: false,
			canceled: false,
			message: "Invalid project file format",
		};
	}
	const mediaSources = await resolveProjectMediaSources(project, normalizedPath);

	if (!mediaSources.success) {
		const missingRecordingPath = /Project video file not found/i.test(mediaSources.message)
			? normalizeVideoSourcePath((project as { videoPath: string }).videoPath)
			: undefined;
		if (missingRecordingPath) await rememberRecentProject(normalizedPath);
		return {
			success: false,
			canceled: false,
			path: normalizedPath,
			missingRecordingPath,
			message: mediaSources.message,
		};
	}
	const relinked = applyRelinkedProjectMedia(project, mediaSources);
	const projectObj = project as Record<string, unknown>;
	const editorObj = projectObj?.editor as Record<string, unknown> | undefined;
	const audioTracks = editorObj?.audioTracks as { sourcePath?: unknown }[] | undefined;
	const audioRegions = editorObj?.audioRegions as { audioPath?: unknown }[] | undefined;
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
	if (Array.isArray(audioRegions)) {
		for (const region of audioRegions) {
			if (typeof region?.audioPath === "string") {
				approvedProjectPaths.push(region.audioPath);
			}
		}
	}
	// Deleted audio can still be restored by undo after the project is reopened.
	const history = projectObj.history as { version?: unknown; values?: unknown } | undefined;
	if (history?.version === 1 && Array.isArray(history.values)) {
		for (const value of history.values) {
			if (value && typeof value === "object" && typeof value.audioPath === "string") {
				approvedProjectPaths.push(value.audioPath);
			}
		}
	}
	if (!isCurrent()) return { success: false, canceled: true };
	await rememberRecentProject(normalizedPath);
	if (
		(await replaceApprovedSessionLocalReadPaths(approvedProjectPaths, isCurrent, relinked)) ===
			false ||
		!isCurrent()
	)
		return { success: false, canceled: true };

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
		recovered,
	};
}

export function isTrustedProjectPath(filePath?: string | null): boolean {
	if (!filePath || !currentProjectPath) return false;
	return normalizePath(filePath) === normalizePath(currentProjectPath);
}
