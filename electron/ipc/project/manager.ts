import { existsSync, constants as fsConstants, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { RECORDINGS_DIR, USER_DATA_PATH } from "../../appPaths";
import { isSupportedLocalMediaPath } from "../../mediaTypes";
import {
	LEGACY_PROJECT_FILE_EXTENSIONS,
	MAX_RECENT_PROJECTS,
	PROJECT_FILE_EXTENSION,
	PROJECT_THUMBNAIL_SUFFIX,
	PROJECTS_DIRECTORY_NAME,
	RECENT_PROJECTS_FILE,
	RECORDINGS_SETTINGS_FILE,
} from "../constants";
import {
	approvedLocalReadPaths,
	currentProjectPath,
	customRecordingsDir,
	foldPathComparisonKey,
	setCurrentProjectPath,
	setCurrentRecordingSession,
	setCurrentVideoPath,
	setCustomRecordingsDir,
	setRecordingsDirLoaded,
} from "../state";
import type { ProjectLibraryEntry, RecordingSessionData } from "../types";
import {
	getRecordingsDir,
	normalizePath,
	normalizeVideoSourcePath,
	parseJsonWithByteOrderMark,
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
	const foldedCandidatePath = foldPathComparisonKey(normalizedCandidatePath);
	const foldedDirectoryPath = foldPathComparisonKey(normalizedDirectoryPath);
	return (
		foldedCandidatePath === foldedDirectoryPath ||
		foldedCandidatePath.startsWith(`${foldedDirectoryPath}${path.sep}`)
	);
}

// Approved roots are derived from the live app paths plus the configured
// recordings directory (state keeps the value loaded from the recordings
// settings file; the async media path re-reads it through getRecordingsDir).
// Hard-coding a literal recordings path here would silently reject users who
// configured a custom recordings directory outside the default userData path.
export function getAllowedLocalReadRootsSync() {
	return [
		customRecordingsDir ?? RECORDINGS_DIR,
		USER_DATA_PATH,
		getAssetRootPath(),
		app.getPath("temp"),
	];
}

export async function getAllowedLocalReadRoots() {
	return [await getRecordingsDir(), USER_DATA_PATH, getAssetRootPath(), app.getPath("temp")];
}

export function isAllowedLocalReadPath(candidatePath: string) {
	const allowedPrefixes = getAllowedLocalReadRootsSync();
	const normalizedCandidatePath = normalizePath(candidatePath);
	const foldedCandidatePath = foldPathComparisonKey(normalizedCandidatePath);

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
		approvedLocalReadPaths.has(foldedCandidatePath);
	if (!lexicalAllowed) {
		return false;
	}

	if (canonicalCandidatePath === normalizedCandidatePath) {
		return true;
	}

	return (
		allowedPrefixes.some((prefix) => isPathInsideDirectory(canonicalCandidatePath, prefix)) ||
		approvedLocalReadPaths.has(foldPathComparisonKey(canonicalCandidatePath))
	);
}

// Keep loopback media-server access restricted to allowlisted or explicitly
// approved files. Direct renderer-side read-local-file calls can be more
// permissive, but URL-based serving must stay scoped so arbitrary paths do not
// become fetchable inside the app.
export async function isAllowedLocalMediaPath(candidatePath: string) {
	const normalizedCandidatePath = normalizePath(candidatePath);
	return isAllowedLocalReadPathWithRoots(
		normalizedCandidatePath,
		await getAllowedLocalReadRoots(),
	);
}

async function isAllowedLocalReadPathWithRoots(candidatePath: string, allowedPrefixes: string[]) {
	const normalizedCandidatePath = normalizePath(candidatePath);
	const foldedCandidatePath = foldPathComparisonKey(normalizedCandidatePath);

	let canonicalCandidatePath = normalizedCandidatePath;
	try {
		canonicalCandidatePath = normalizePath(realpathSync(normalizedCandidatePath));
	} catch {
		// File may not exist yet; keep the lexical path.
	}

	const lexicalAllowed =
		allowedPrefixes.some((prefix) => isPathInsideDirectory(normalizedCandidatePath, prefix)) ||
		approvedLocalReadPaths.has(foldedCandidatePath);
	if (!lexicalAllowed) {
		return false;
	}

	if (canonicalCandidatePath === normalizedCandidatePath) {
		return true;
	}

	return (
		allowedPrefixes.some((prefix) => isPathInsideDirectory(canonicalCandidatePath, prefix)) ||
		approvedLocalReadPaths.has(foldPathComparisonKey(canonicalCandidatePath))
	);
}

async function collectApprovedLocalReadPaths(filePath?: string | null): Promise<string[]> {
	const normalizedPath = normalizeVideoSourcePath(filePath);
	if (!normalizedPath) {
		return [];
	}

	const approvedPaths = [foldPathComparisonKey(normalizePath(normalizedPath))];

	try {
		const realPath = await fs.realpath(normalizePath(normalizedPath));
		const foldedRealPath = foldPathComparisonKey(normalizePath(realPath));
		if (!approvedPaths.includes(foldedRealPath)) {
			approvedPaths.push(foldedRealPath);
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

export type LocalMediaUrlResolution =
	| { status: "approved"; path: string }
	| { status: "pending"; path: string }
	| {
			status: "rejected";
			reason:
				| "missing"
				| "unsupported-type"
				| "outside-allowed-roots"
				| "not-file"
				| "symlink-escape";
	  };

// Resolve a candidate for the local media server URL. Existing files go
// through the strict realpath + allowlist path. Files that do not exist yet
// (speculative audio sidecar candidates requested before the mux rename
// completes on Windows) may still receive a PENDING url when they are a
// supported media type on a lexical path inside an allowed recordings root;
// the media server re-validates realpath and symlink containment at serve time
// when the file actually appears, so no canonical security is weakened.
export async function resolveLocalMediaUrlPath(
	candidatePath: string,
): Promise<LocalMediaUrlResolution> {
	const normalizedCandidatePath = normalizeVideoSourcePath(candidatePath) ?? candidatePath;
	const resolvedCandidatePath = normalizePath(normalizedCandidatePath);

	const realPath = await fs.realpath(resolvedCandidatePath).catch((error: unknown) => {
		return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? null : undefined;
	});

	if (realPath === undefined) {
		return { status: "rejected", reason: "missing" };
	}

	if (realPath === null) {
		// The file does not exist yet. Grant a pending URL only for a supported
		// media type under an allowed root; never for arbitrary missing paths.
		if (!isSupportedLocalMediaPath(resolvedCandidatePath)) {
			return { status: "rejected", reason: "unsupported-type" };
		}
		const allowedRoots = await getAllowedLocalReadRoots();
		if (!(await isAllowedLocalReadPathWithRoots(resolvedCandidatePath, allowedRoots))) {
			return { status: "rejected", reason: "outside-allowed-roots" };
		}
		await rememberApprovedLocalReadPath(normalizedCandidatePath);
		return { status: "pending", path: resolvedCandidatePath };
	}

	const stat = await fs.stat(realPath).catch(() => null);
	if (!stat?.isFile()) {
		return { status: "rejected", reason: "not-file" };
	}
	if (!isSupportedLocalMediaPath(realPath)) {
		return { status: "rejected", reason: "unsupported-type" };
	}
	const allowedRoots = await getAllowedLocalReadRoots();
	const lexicalAllowed = await isAllowedLocalReadPathWithRoots(
		resolvedCandidatePath,
		allowedRoots,
	);
	if (!(await isAllowedLocalMediaPath(realPath))) {
		// The real path is not accepted by the roots or the approved set; if the
		// lexical path looked allowed, this is a symlink/reparse-point escape.
		return {
			status: "rejected",
			reason: lexicalAllowed ? "symlink-escape" : "outside-allowed-roots",
		};
	}
	await rememberApprovedLocalReadPath(normalizedCandidatePath);
	return { status: "approved", path: realPath };
}

export async function resolveApprovedLocalMediaPath(candidatePath: string): Promise<string | null> {
	// Accept file:/// URLs and bare paths; persisted project sources can carry
	// either form and both must resolve through the local media server.
	const normalizedCandidatePath = normalizeVideoSourcePath(candidatePath) ?? candidatePath;
	const resolvedCandidatePath = normalizePath(normalizedCandidatePath);
	const realPath = await fs.realpath(resolvedCandidatePath).catch(() => null);

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

	await rememberApprovedLocalReadPath(normalizedCandidatePath);
	return realPath;
}

export async function replaceApprovedSessionLocalReadPaths(
	filePaths: Array<string | null | undefined>,
) {
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

export async function resolveProjectMediaSources(
	project: unknown,
): Promise<
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

function isLoadableProjectData(projectData: unknown) {
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

export async function loadProjectFromPath(projectPath: string) {
	const normalizedPath = normalizePath(projectPath);
	let project: unknown;
	try {
		const content = await fs.readFile(normalizedPath, "utf-8");
		project = parseJsonWithByteOrderMark(content);
	} catch (error) {
		return {
			success: false,
			canceled: false,
			message: `Failed to read project file: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (!isLoadableProjectData(project)) {
		return {
			success: false,
			canceled: false,
			message: "Invalid project file format",
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
