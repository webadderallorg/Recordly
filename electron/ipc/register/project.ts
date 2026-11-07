import { nativeT } from "../../nativeI18n";
import { relinkProjectRecording } from "../project/relinkRecording";
import { persistRecentMetadata } from "../project/recentMetadata";
import { renameLibraryProject } from "../project/renameLibraryProject";
import { createUntitledProject } from "../project/createUntitledProject";
import { trashLibraryProjects } from "../project/trashProjects";
import {
	prepareLibraryDeletion,
	protectedLibrarySources,
	recordingUsesSources,
	removableLibrarySources,
} from "../project/libraryDeletion";
import { canonicalMediaSources } from "../project/canonicalMediaSources";
import { getRecordingThumbnail } from "../recording/thumbnail";
import { discardRecordingFiles } from "../recording/discardFiles";
import { findDuplicateRecordingSources } from "../recording/duplicateSources";
import { listRecordings, setRecordingsRemoved, trashRecordingSources } from "../recording/library";
import { importRecording, discardRecordingImport } from "../recording/importRecording";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { RECORDINGS_DIR } from "../../appPaths";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import { isTrustedRenderer } from "../../trustedRenderer";
import { LEGACY_PROJECT_FILE_EXTENSIONS, PROJECT_FILE_EXTENSION } from "../constants";
import { getProjectBackupPaths, writeProjectFileAtomically } from "../project/atomicSave";
import {
	cacheProjectThumbnail,
	getProjectsDir,
	getProjectThumbnailPath,
	getProjectThumbnailPaths,
	isPathInsideDirectory,
	isTrustedProjectPath,
	listProjectLibraryEntries,
	isLoadableProjectData,
	loadProjectFromPath,
	readProjectPreview,
	loadRecentProjectPaths,
	persistRecordingsDirectorySetting,
	rememberApprovedLocalReadPath,
	rememberRecentProject,
	replaceApprovedSessionLocalReadPaths,
	resolveApprovedLocalMediaPath,
	saveProjectThumbnail,
	saveRecentProjectPaths,
} from "../project/manager";
import { persistRecordingSessionManifest, resolveRecordingSession } from "../project/session";
import {
	currentProjectPath,
	currentProjectContextVersion,
	currentRecordingSession,
	currentVideoPath,
	nativeScreenRecordingActive,
	windowsNativeCaptureActive,
	ffmpegScreenRecordingActive,
	setCurrentProjectPath,
	setCurrentRecordingSession,
	setCurrentVideoPath,
	windowsPendingVideoPath,
	setWindowsPendingVideoPath,
} from "../state";
import {
	approveUserPath,
	getRecordingsDir,
	isAutoRecordingPath,
	normalizeVideoSourcePath,
	normalizePath,
	parseJsonWithByteOrderMark,
} from "../utils";

function libraryDeletionDependencies(protectedSources: unknown = []) {
	if (
		!Array.isArray(protectedSources) ||
		protectedSources.length > 10000 ||
		protectedSources.some((value) => typeof value !== "string" || value.length > 65536)
	)
		throw new Error("Invalid protected source references");
	const additionalSources = (protectedSources as string[])
		.map((value) => normalizeVideoSourcePath(value))
		.filter((value): value is string =>
			Boolean(value && !/^(https?:|blob:|data:)/i.test(value)),
		);

	return {
		list: listProjectLibraryEntries,
		backupPaths: getProjectBackupPaths,
		recordings: () => listRecordings(true),
		activeSources: () =>
			[
				currentVideoPath,
				currentRecordingSession?.videoPath,
				currentRecordingSession?.webcamPath,
				...additionalSources,
			]
				.map((file) => normalizeVideoSourcePath(file))
				.filter((file): file is string => Boolean(file)),
		readSources: async (file: string, kind: "primary" | "recovery" = "recovery") => {
			try {
				// Listed primaries may be leaf symlinks; recovery generations remain strict.
				const stat = kind === "primary" ? await fs.stat(file) : await fs.lstat(file);
				if (!stat.isFile()) throw new Error("Project reference is not a regular file");
				const project = parseJsonWithByteOrderMark(await fs.readFile(file, "utf-8"));
				if (!isLoadableProjectData(project))
					throw new Error("Project reference could not be read");
				return canonicalMediaSources(project, { preserveMissing: true });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
		},
	};
}

function normalizeRecordingTimeOffsetMs(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/**
 * Produces a filesystem-safe project base name without the project extension.
 */
function normalizeProjectSaveName(projectName?: string | null) {
	if (typeof projectName !== "string") {
		return null;
	}

	const trimmedName = projectName.trim();
	if (!trimmedName) {
		return null;
	}

	const withoutExtension = trimmedName.replace(
		new RegExp(`\\.${PROJECT_FILE_EXTENSION}$`, "i"),
		"",
	);
	const withoutInvalidFilesystemChars = withoutExtension.replace(/[<>:"/\\|?*]/g, "");
	const withoutControlChars = Array.from(withoutInvalidFilesystemChars)
		.filter((character) => character.charCodeAt(0) > 31)
		.join("");
	const sanitizedName = withoutControlChars
		.replace(/\s+/g, " ")
		.replace(/[. ]+$/g, "")
		.trim();

	return sanitizedName || null;
}

type NamedProjectSaveMode = "rename" | "copy";

function normalizeNamedProjectSaveMode(value: unknown): NamedProjectSaveMode {
	return value === "copy" ? "copy" : "rename";
}

/**
 * Extracts the persisted source video path from a saved project payload.
 */
function getProjectVideoPath(projectData: unknown) {
	if (!projectData || typeof projectData !== "object") {
		return null;
	}

	const candidate = projectData as { videoPath?: unknown };
	return typeof candidate.videoPath === "string" ? candidate.videoPath : null;
}

function getProjectId(projectData: unknown) {
	if (!projectData || typeof projectData !== "object") {
		return null;
	}

	const candidate = projectData as { projectId?: unknown };
	return typeof candidate.projectId === "string" && candidate.projectId.trim().length > 0
		? candidate.projectId
		: null;
}

function withProjectId(projectData: unknown, projectId: string) {
	if (!projectData || typeof projectData !== "object" || Array.isArray(projectData)) {
		return projectData;
	}

	return {
		...projectData,
		projectId,
	};
}

function ensureProjectDataHasProjectId(projectData: unknown) {
	const existingProjectId = getProjectId(projectData);
	if (existingProjectId) {
		return {
			projectId: existingProjectId,
			projectData,
		};
	}

	const projectId = randomUUID();
	return {
		projectId,
		projectData: withProjectId(projectData, projectId),
	};
}

async function resolveComparablePath(filePath: string) {
	return fs.realpath(filePath).catch(() => path.resolve(filePath));
}

/**
 * Prevents a named save from silently overwriting a different project file.
 */
async function ensureNamedProjectSaveDoesNotOverwriteDifferentProject(
	targetProjectPath: string,
	projectData: unknown,
	activeProjectPath?: string | null,
) {
	try {
		await fs.stat(targetProjectPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			return { success: true };
		}
		throw error;
	}

	const targetResolvedPath = await resolveComparablePath(targetProjectPath);
	if (activeProjectPath) {
		const activeResolvedPath = await resolveComparablePath(activeProjectPath);
		if (activeResolvedPath === targetResolvedPath) {
			return { success: true };
		}
	}

	const incomingProjectId = getProjectId(projectData);
	const incomingVideoPath = getProjectVideoPath(projectData);

	try {
		const existingProjectRaw = await fs.readFile(targetProjectPath, "utf-8");
		const existingProjectData = parseJsonWithByteOrderMark(existingProjectRaw);
		const existingProjectId = getProjectId(existingProjectData);
		const existingVideoPath = getProjectVideoPath(existingProjectData);

		if (existingProjectId && incomingProjectId) {
			if (existingProjectId === incomingProjectId) {
				return { success: true };
			}

			return {
				success: false,
				message: "A different project already uses this name",
			};
		}

		if (existingVideoPath && incomingVideoPath && existingVideoPath !== incomingVideoPath) {
			return {
				success: false,
				message: "A different project already uses this name",
			};
		}

		if (!existingProjectId && !incomingProjectId && existingVideoPath && incomingVideoPath) {
			return {
				success: false,
				message: "Unable to verify project identity for the chosen name",
			};
		}

		return {
			success: false,
			message: "Unable to verify project identity for the chosen name",
		};
	} catch (error) {
		console.error("Failed to verify existing named project before overwrite:", error);
		return {
			success: false,
			message: "Unable to verify project identity for the chosen name",
		};
	}
}

export function registerProjectHandlers() {
	const relinkingProjects = new Set<string>();
	// Project handlers expose private recordings, files and media capabilities.
	// Apply the document boundary to every entry point, including read-only IPC.
	const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => {
		ipcMain.handle(channel, (event, ...args) => {
			if (!isTrustedRenderer(event)) return { success: false };
			return listener(event, ...args);
		});
	};
	handle("rename-library-project", async (_, source: string, name: string) => {
		try {
			const entries = await listProjectLibraryEntries();
			const target = await renameLibraryProject(
				source,
				name,
				entries.entries.map((entry) => entry.path),
				(value) => [
					{ paths: getProjectThumbnailPaths(value), kind: "preview" },
					getProjectBackupPaths(value),
				],
			);
			if (currentProjectPath && normalizePath(currentProjectPath) === normalizePath(source))
				setCurrentProjectPath(target);
			const warning = await persistRecentMetadata(() => rememberRecentProject(target));
			return { success: true, path: target, warning };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	const imports = new Map<number, AbortController>();
	const pendingImports = new Map<number, Set<string>>();
	const watchedImportSenders = new WeakSet<Electron.WebContents>();
	const abandonImports = (owner: number) => {
		imports.get(owner)?.abort();
		const outputs = pendingImports.get(owner);
		pendingImports.delete(owner);
		void Promise.allSettled([...(outputs ?? [])].map(discardRecordingImport)).then(
			(results) => {
				for (const result of results)
					if (result.status === "rejected")
						console.warn("Could not discard abandoned import", result.reason);
			},
		);
	};
	handle("finish-recording-import", async (event, keepPath: string, commit = false) => {
		if (imports.has(event.sender.id))
			return { success: false, error: "Import is still running" };
		const outputs = pendingImports.get(event.sender.id);
		// Commit only after the renderer confirms that its project is still active.
		if (commit) outputs?.delete(keepPath);
		try {
			for (const output of outputs ?? []) {
				if (output === keepPath) continue;
				await discardRecordingImport(output);
				outputs?.delete(output);
			}
			if (!outputs?.size) pendingImports.delete(event.sender.id);
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	handle("cancel-recording-import", (event) => {
		imports.get(event.sender.id)?.abort();
		return { success: true };
	});
	handle("get-recording-thumbnail", async (_, file: string) => {
		try {
			return { success: true, value: await getRecordingThumbnail(file) };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	handle(
		"cache-project-thumbnail",
		async (_, projectPath: string, revision: string, dataUrl: string) => {
			try {
				return {
					success: true,
					value: await cacheProjectThumbnail(projectPath, revision, dataUrl),
				};
			} catch (error) {
				return { success: false, error: String(error) };
			}
		},
	);
	handle("get-project-preview", async (_, projectPath: string) => {
		try {
			return { success: true, value: await readProjectPreview(projectPath) };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	handle("find-duplicate-recording-sources", async () => {
		try {
			if (
				nativeScreenRecordingActive ||
				windowsNativeCaptureActive ||
				ffmpegScreenRecordingActive
			)
				throw new Error("Stop recording before scanning source files");
			return { success: true, value: await findDuplicateRecordingSources() };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	handle("list-recordings", async (_, includeSources?: boolean) => {
		try {
			return { success: true, value: await listRecordings(includeSources === true) };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	handle("set-recordings-removed", async (_, paths: string[], removed: boolean) => {
		try {
			await setRecordingsRemoved(paths, removed);
			return { success: true, value: null };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	handle("trash-recording-sources", async (_, paths: unknown, protectedSources?: string[]) => {
		try {
			if (
				nativeScreenRecordingActive ||
				windowsNativeCaptureActive ||
				ffmpegScreenRecordingActive
			)
				throw new Error("Stop recording before deleting source files");
			if (
				!Array.isArray(paths) ||
				!paths.length ||
				paths.some((file) => typeof file !== "string")
			)
				throw new Error("Invalid source file selection");
			const protectedReferences = await protectedLibrarySources(
				libraryDeletionDependencies(protectedSources),
			);
			const preserved = (paths as string[]).filter((file) =>
				recordingUsesSources(file, protectedReferences),
			);
			const removable = (paths as string[]).filter((file) => !preserved.includes(file));
			const result = removable.length
				? await trashRecordingSources(removable)
				: { deleted: [], errors: [] as string[] };
			if (preserved.length)
				result.errors.push(
					`Kept ${preserved.length} source files used by saved projects or the current editor.`,
				);
			return { success: true, value: result };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	handle(
		"import-recording",
		async (
			event,
			currentPath: string,
			recordingPath: string,
			webcam?: import("../../../src/types/recordingLibrary").RecordingWebcamSource,
		) => {
			const owner = event.sender.id;
			if (!watchedImportSenders.has(event.sender)) {
				watchedImportSenders.add(event.sender);
				event.sender.once("destroyed", () => abandonImports(owner));
				event.sender.on("render-process-gone", () => abandonImports(owner));
				event.sender.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
					if (isMainFrame && !isInPlace) abandonImports(owner);
				});
			}
			if (imports.has(owner))
				return { success: false, error: "An import is already running" };
			const controller = new AbortController();
			imports.set(owner, controller);
			try {
				const value = await importRecording(
					currentPath,
					recordingPath,
					webcam,
					controller.signal,
				);
				if (controller.signal.aborted || event.sender.isDestroyed()) {
					await discardRecordingImport(value.path);
					throw new Error("Import cancelled because its editor closed or reloaded");
				}
				const outputs = pendingImports.get(owner) ?? new Set<string>();
				outputs.add(value.path);
				pendingImports.set(owner, outputs);
				return { success: true, value };
			} catch (error) {
				return { success: false, error: String(error) };
			} finally {
				imports.delete(owner);
			}
		},
	);
	handle("reveal-in-folder", async (_, filePath: string) => {
		try {
			// shell.showItemInFolder doesn't return a value, it throws on error
			shell.showItemInFolder(filePath);
			return { success: true };
		} catch (error) {
			console.error(`Error revealing item in folder: ${filePath}`, error);
			// Fallback to open the directory if revealing the item fails
			// This might happen if the file was moved or deleted after export,
			// or if the path is somehow invalid for showItemInFolder
			try {
				const openPathResult = await shell.openPath(path.dirname(filePath));
				if (openPathResult) {
					// openPath returned an error message
					return { success: false, error: openPathResult };
				}
				return { success: true, message: "Could not reveal item, but opened directory." };
			} catch (openError) {
				console.error(`Error opening directory: ${path.dirname(filePath)}`, openError);
				return { success: false, error: String(error) };
			}
		}
	});

	handle("open-recordings-folder", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const openPathResult = await shell.openPath(recordingsDir);
			if (openPathResult) {
				return {
					success: false,
					error: openPathResult,
					message: "Failed to open recordings folder.",
				};
			}

			return { success: true };
		} catch (error) {
			console.error("Failed to open recordings folder:", error);
			return {
				success: false,
				error: String(error),
				message: "Failed to open recordings folder.",
			};
		}
	});

	handle("get-recordings-directory", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			return {
				success: true,
				path: recordingsDir,
				isDefault: recordingsDir === RECORDINGS_DIR,
			};
		} catch (error) {
			return {
				success: false,
				path: RECORDINGS_DIR,
				isDefault: true,
				error: String(error),
			};
		}
	});

	handle("choose-recordings-directory", async () => {
		try {
			const current = await getRecordingsDir();
			const result = await dialog.showOpenDialog({
				title: nativeT("chooseRecordings"),
				defaultPath: current,
				properties: ["openDirectory", "createDirectory", "promptToCreate"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true, path: current };
			}

			const selectedPath = path.resolve(result.filePaths[0]);
			await fs.mkdir(selectedPath, { recursive: true });
			await fs.access(selectedPath, fsConstants.W_OK);
			await persistRecordingsDirectorySetting(selectedPath);

			return {
				success: true,
				path: selectedPath,
				isDefault: selectedPath === RECORDINGS_DIR,
			};
		} catch (error) {
			return {
				success: false,
				error: String(error),
				message: "Failed to set recordings folder",
			};
		}
	});

	handle(
		"save-project-file",
		async (
			_,
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
			thumbnailDataUrl?: string | null,
		) => {
			const saveContextVersion = currentProjectContextVersion;
			try {
				const projectsDir = await getProjectsDir();
				const preparedProject = ensureProjectDataHasProjectId(projectData);
				const trustedExistingProjectPath =
					existingProjectPath &&
					path.extname(existingProjectPath).toLowerCase() ===
						`.${PROJECT_FILE_EXTENSION}` &&
					(isTrustedProjectPath(existingProjectPath) ||
						isPathInsideDirectory(existingProjectPath, projectsDir))
						? path.resolve(existingProjectPath)
						: null;

				if (trustedExistingProjectPath) {
					await writeProjectFileAtomically(
						trustedExistingProjectPath,
						JSON.stringify(preparedProject.projectData, null, 2),
					);
					if (currentProjectContextVersion === saveContextVersion)
						setCurrentProjectPath(trustedExistingProjectPath);
					await saveProjectThumbnail(trustedExistingProjectPath, thumbnailDataUrl);
					await rememberRecentProject(trustedExistingProjectPath);
					return {
						success: true,
						path: trustedExistingProjectPath,
						projectId: preparedProject.projectId,
						message: "Project saved successfully",
					};
				}

				if (existingProjectPath) {
					return {
						success: false,
						message:
							"Project path is no longer trusted. Use Save As to choose a project file.",
					};
				}

				const safeName = normalizeProjectSaveName(suggestedName) || `project-${Date.now()}`;
				const defaultName = `${safeName}.${PROJECT_FILE_EXTENSION}`;

				const result = await dialog.showSaveDialog({
					title: nativeT("saveRecordlyProject"),
					defaultPath: path.join(projectsDir, defaultName),
					filters: [
						{ name: nativeT("recordlyProject"), extensions: [PROJECT_FILE_EXTENSION] },
						{ name: "JSON", extensions: ["json"] },
					],
					properties: ["createDirectory", "showOverwriteConfirmation"],
				});

				if (result.canceled || !result.filePath) {
					return {
						success: false,
						canceled: true,
						message: "Save project canceled",
					};
				}

				await writeProjectFileAtomically(
					result.filePath,
					JSON.stringify(preparedProject.projectData, null, 2),
				);
				if (currentProjectContextVersion === saveContextVersion)
					setCurrentProjectPath(result.filePath);
				await saveProjectThumbnail(result.filePath, thumbnailDataUrl);
				await rememberRecentProject(result.filePath);

				return {
					success: true,
					path: result.filePath,
					projectId: preparedProject.projectId,
					message: "Project saved successfully",
				};
			} catch (error) {
				console.error("Failed to save project file:", error);
				return {
					success: false,
					message: "Failed to save project file",
					error: String(error),
				};
			}
		},
	);

	handle(
		"save-project-file-named",
		async (
			_,
			projectData: unknown,
			projectName: string,
			thumbnailDataUrl?: string | null,
			mode?: unknown,
		) => {
			const saveContextVersion = currentProjectContextVersion;
			const sourceProjectPath = currentProjectPath;
			try {
				const normalizedProjectName = normalizeProjectSaveName(projectName);
				if (!normalizedProjectName) {
					return {
						success: false,
						message: "Project name is required",
					};
				}

				const projectsDir = await getProjectsDir();
				const namedSaveMode = normalizeNamedProjectSaveMode(mode);
				const activeProjectPath = isTrustedProjectPath(sourceProjectPath)
					? sourceProjectPath
					: null;
				const targetProjectPath = path.join(
					projectsDir,
					`${normalizedProjectName}.${PROJECT_FILE_EXTENSION}`,
				);
				const [activeResolvedPath, targetResolvedPath] = await Promise.all([
					activeProjectPath
						? resolveComparablePath(activeProjectPath)
						: Promise.resolve(null),
					resolveComparablePath(targetProjectPath),
				]);
				const isSavingToDifferentPath =
					!activeResolvedPath || activeResolvedPath !== targetResolvedPath;
				const preparedProject =
					namedSaveMode === "copy" && isSavingToDifferentPath
						? (() => {
								const projectId = randomUUID();
								return {
									projectId,
									projectData: withProjectId(projectData, projectId),
								};
							})()
						: ensureProjectDataHasProjectId(projectData);

				const overwriteCheck = await ensureNamedProjectSaveDoesNotOverwriteDifferentProject(
					targetProjectPath,
					preparedProject.projectData,
					activeProjectPath,
				);
				if (!overwriteCheck.success) {
					return overwriteCheck;
				}

				await writeProjectFileAtomically(
					targetProjectPath,
					JSON.stringify(preparedProject.projectData, null, 2),
				);
				await saveProjectThumbnail(targetProjectPath, thumbnailDataUrl);
				await rememberRecentProject(targetProjectPath);

				// A newer session may have reopened the source while this save was pending.
				// Keep the saved file, but do not remove files belonging to that session.
				if (
					currentProjectContextVersion === saveContextVersion &&
					namedSaveMode === "rename" &&
					activeProjectPath &&
					isSavingToDifferentPath
				) {
					await fs
						.unlink(activeProjectPath)
						.catch((unlinkError: NodeJS.ErrnoException) => {
							if (unlinkError.code !== "ENOENT") {
								throw unlinkError;
							}
						});
					await Promise.all(
						getProjectThumbnailPaths(activeProjectPath).map((thumbnailPath) =>
							fs.rm(thumbnailPath, { force: true }).catch(() => undefined),
						),
					);
					await Promise.all(
						getProjectBackupPaths(activeProjectPath).map((backupPath) =>
							fs.rm(backupPath, { force: true }).catch(() => undefined),
						),
					);

					const recentProjectPaths = await loadRecentProjectPaths();
					const filteredRecentProjectPaths: string[] = [];
					for (const recentProjectPath of recentProjectPaths) {
						const recentResolvedPath = await resolveComparablePath(recentProjectPath);
						if (recentResolvedPath !== activeResolvedPath) {
							filteredRecentProjectPaths.push(recentProjectPath);
						}
					}
					await saveRecentProjectPaths(filteredRecentProjectPaths);
				}

				if (currentProjectContextVersion === saveContextVersion)
					setCurrentProjectPath(targetProjectPath);

				return {
					success: true,
					path: targetProjectPath,
					projectId: preparedProject.projectId,
					message: "Project saved successfully",
				};
			} catch (error) {
				console.error("Failed to save named project file:", error);
				return {
					success: false,
					message: "Failed to save project file",
					error: String(error),
				};
			}
		},
	);

	handle("load-project-file", async () => {
		try {
			const projectsDir = await getProjectsDir();
			const result = await dialog.showOpenDialog({
				title: nativeT("openRecordlyProject"),
				defaultPath: projectsDir,
				filters: [
					{
						name: nativeT("recordlyProject"),
						extensions: [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS],
					},
					{ name: "JSON", extensions: ["json"] },
					{ name: nativeT("allFiles"), extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true, message: "Open project canceled" };
			}

			return await loadProjectFromPath(result.filePaths[0]);
		} catch (error) {
			console.error("Failed to load project file:", error);
			return {
				success: false,
				message: "Failed to load project file",
				error: String(error),
			};
		}
	});

	handle("load-current-project-file", async () => {
		try {
			if (!currentProjectPath) {
				return { success: false, message: "No active project" };
			}

			return await loadProjectFromPath(currentProjectPath);
		} catch (error) {
			console.error("Failed to load current project file:", error);
			return {
				success: false,
				message: "Failed to load current project file",
				error: String(error),
			};
		}
	});

	handle("get-projects-directory", async () => {
		try {
			return {
				success: true,
				path: await getProjectsDir(),
			};
		} catch (error) {
			return {
				success: false,
				error: String(error),
			};
		}
	});

	handle(
		"create-project-file",
		async (_, projectData: unknown, thumbnailDataUrl?: string | null) => {
			const saveContextVersion = currentProjectContextVersion;
			try {
				const prepared = ensureProjectDataHasProjectId(projectData);
				const target = await createUntitledProject(
					await getProjectsDir(),
					JSON.stringify(prepared.projectData, null, 2),
				);
				if (currentProjectContextVersion === saveContextVersion)
					setCurrentProjectPath(target);
				const warning = await persistRecentMetadata(() => rememberRecentProject(target));
				try {
					await saveProjectThumbnail(target, thumbnailDataUrl);
				} catch (error) {
					console.warn("Could not save project thumbnail", error);
				}
				return { success: true, path: target, projectId: prepared.projectId, warning };
			} catch (error) {
				return { success: false, message: String(error) };
			}
		},
	);
	handle("review-project-deletion", async (_, paths: unknown, protectedSources?: string[]) => {
		try {
			const plan = await prepareLibraryDeletion(
				paths,
				libraryDeletionDependencies(protectedSources),
			);
			return {
				success: true,
				sourceCount: Object.keys(plan.sourceOwners).length,
				preservedSourceCount: plan.preservedSources.length,
			};
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	handle(
		"trash-project-files",
		async (
			_,
			paths: unknown,
			options?: { includeSources?: boolean; protectedSources?: string[] },
		) => {
			try {
				if (
					options?.includeSources &&
					(nativeScreenRecordingActive ||
						windowsNativeCaptureActive ||
						ffmpegScreenRecordingActive)
				)
					throw new Error("Stop recording before deleting source files");
				const deps = libraryDeletionDependencies(options?.protectedSources);
				const plan = options?.includeSources
					? await prepareLibraryDeletion(paths, deps)
					: null;
				const result = await trashLibraryProjects(paths, {
					list: listProjectLibraryEntries,
					trash: (filePath) => shell.trashItem(filePath),
					thumbnailPath: getProjectThumbnailPath,
					thumbnailPaths: getProjectThumbnailPaths,
				});
				const sourcesDeleted: string[] = [];
				const sourcesKept = [...(plan?.preservedSources ?? [])];
				if (plan && result.deleted.length && !result.errors.length) {
					try {
						// Re-read remaining projects/recovery copies after Trash, before touching media.
						const protectedSources = await protectedLibrarySources(
							deps,
							new Set(result.deleted),
						);
						const { removable, kept } = removableLibrarySources(
							plan.sourceOwners,
							result.deleted,
							protectedSources,
						);
						sourcesKept.push(...kept);
						for (let index = 0; index < removable.length; index += 500) {
							const media = await trashRecordingSources(
								removable.slice(index, index + 500),
							);
							sourcesDeleted.push(...media.deleted);
							result.errors.push(...media.errors);
						}
					} catch {
						result.errors.push(
							"Some source files could not be safely removed and were kept.",
						);
					}
				}
				if (plan && result.errors.length)
					sourcesKept.push(
						...Object.keys(plan.sourceOwners).filter(
							(file) => !sourcesDeleted.includes(file),
						),
					);
				if (currentProjectPath && result.deleted.includes(path.resolve(currentProjectPath)))
					setCurrentProjectPath(null);
				const warning = await persistRecentMetadata(async () =>
					saveRecentProjectPaths(
						(await loadRecentProjectPaths()).filter(
							(p) => !result.deleted.includes(path.resolve(p)),
						),
					),
				);
				return {
					success: result.errors.length === 0,
					...result,
					warning,
					sourcesDeleted,
					sourcesKept: [...new Set(sourcesKept)],
				};
			} catch (error) {
				return { success: false, deleted: [], errors: [String(error)] };
			}
		},
	);

	handle("list-project-files", async (event) => {
		try {
			const library = await listProjectLibraryEntries((ready) => {
				if (!event.sender.isDestroyed())
					event.sender.send("project-library-thumbnail-ready", ready);
			});
			return {
				success: true,
				projectsDir: library.projectsDir,
				entries: library.entries,
			};
		} catch (error) {
			return {
				success: false,
				projectsDir: null,
				entries: [],
				error: String(error),
			};
		}
	});

	handle("relink-project-recording", async (_, filePath: string) => {
		let key: string | undefined;
		let acquired = false;
		try {
			if (typeof filePath !== "string" || !filePath) throw new Error("Invalid project path");
			key = normalizePath(filePath);
			if (relinkingProjects.has(key)) return { success: false, canceled: true };
			relinkingProjects.add(key);
			acquired = true;
			const contextVersion = currentProjectContextVersion;
			const isCurrent = () =>
				currentProjectContextVersion === contextVersion &&
				!nativeScreenRecordingActive &&
				!windowsNativeCaptureActive &&
				!ffmpegScreenRecordingActive;
			if (!isCurrent()) return { success: false, canceled: true };
			const result = await relinkProjectRecording(
				key,
				async (missingPath) => {
					const selected = await dialog.showOpenDialog({
						title: nativeT("locateProjectRecording"),
						defaultPath: missingPath,
						filters: [
							{
								name: nativeT("replacementRecording"),
								extensions: ["mp4", "mov", "webm", "mkv", "avi"],
							},
						],
						properties: ["openFile"],
					});
					return selected.canceled ? null : (selected.filePaths[0] ?? null);
				},
				undefined,
				isCurrent,
			);
			if (!result.success || !("path" in result) || !result.path) return result;
			const loaded = await loadProjectFromPath(result.path, isCurrent);
			return {
				...loaded,
				recovered: Boolean(
					loaded.success &&
						(("recovered" in result && result.recovered) ||
							("recovered" in loaded && loaded.recovered)),
				),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const localized =
				message === "relinkRecordingInvalid" ||
				message === "relinkRecordingTooShort" ||
				message === "relinkProjectChanged"
					? nativeT(message)
					: message;
			return { success: false, error: localized };
		} finally {
			if (key && acquired) relinkingProjects.delete(key);
		}
	});

	handle("open-project-file-at-path", async (_, filePath: string) => {
		try {
			return await loadProjectFromPath(filePath);
		} catch (error) {
			console.error("Failed to open project file at path:", error);
			return {
				success: false,
				message: "Failed to open project file",
				error: String(error),
			};
		}
	});

	handle("open-projects-directory", async () => {
		try {
			const projectsDir = await getProjectsDir();
			const openPathResult = await shell.openPath(projectsDir);
			if (openPathResult) {
				return {
					success: false,
					error: openPathResult,
					message: "Failed to open projects folder.",
				};
			}

			return { success: true, path: projectsDir };
		} catch (error) {
			console.error("Failed to open projects folder:", error);
			return {
				success: false,
				error: String(error),
				message: "Failed to open projects folder.",
			};
		}
	});
	handle(
		"set-current-video-path",
		async (
			_,
			path: string,
			options?: { preserveProjectPath?: boolean; hideOverlayCursorByDefault?: boolean },
		) => {
			setCurrentVideoPath(normalizeVideoSourcePath(path) ?? path);
			approveUserPath(currentVideoPath);
			const resolvedSession = (await resolveRecordingSession(currentVideoPath)) ?? {
				videoPath: currentVideoPath!,
				webcamPath: null,
				timeOffsetMs: 0,
			};

			const nextSession = {
				...resolvedSession,
				hideOverlayCursorByDefault:
					normalizeBoolean(options?.hideOverlayCursorByDefault) ||
					normalizeBoolean(resolvedSession.hideOverlayCursorByDefault),
			};

			setCurrentRecordingSession(nextSession);
			if (options?.preserveProjectPath) {
				// Project loading already approved its audio, including undo/redo media.
				await rememberApprovedLocalReadPath(resolvedSession.videoPath);
				await rememberApprovedLocalReadPath(resolvedSession.webcamPath);
			} else {
				await replaceApprovedSessionLocalReadPaths([
					resolvedSession.videoPath,
					resolvedSession.webcamPath,
				]);
			}

			if (nextSession.webcamPath) {
				await persistRecordingSessionManifest(nextSession);
			}

			if (!options?.preserveProjectPath) {
				setCurrentProjectPath(null);
			}

			for (const window of BrowserWindow.getAllWindows()) {
				if (!window.isDestroyed()) {
					window.webContents.send("recording-session-changed", nextSession);
				}
			}

			return { success: true, webcamPath: nextSession.webcamPath ?? null };
		},
	);

	handle(
		"set-current-recording-session",
		async (
			_,
			session: {
				videoPath: string;
				webcamPath?: string | null;
				timeOffsetMs?: number;
				hideOverlayCursorByDefault?: boolean;
			},
			options?: { preserveProjectPath?: boolean },
		) => {
			const normalizedVideoPath =
				normalizeVideoSourcePath(session.videoPath) ?? session.videoPath;
			setCurrentVideoPath(normalizedVideoPath);
			setCurrentRecordingSession({
				videoPath: normalizedVideoPath,
				webcamPath: normalizeVideoSourcePath(session.webcamPath ?? null),
				timeOffsetMs: normalizeRecordingTimeOffsetMs(session.timeOffsetMs),
				hideOverlayCursorByDefault: normalizeBoolean(session.hideOverlayCursorByDefault),
			});
			await rememberApprovedLocalReadPath(currentRecordingSession!.videoPath);
			await rememberApprovedLocalReadPath(currentRecordingSession!.webcamPath);
			if (!options?.preserveProjectPath) {
				setCurrentProjectPath(null);
			}
			await persistRecordingSessionManifest(currentRecordingSession!);

			for (const window of BrowserWindow.getAllWindows()) {
				if (!window.isDestroyed()) {
					window.webContents.send("recording-session-changed", currentRecordingSession);
				}
			}

			return { success: true };
		},
	);

	handle("get-current-recording-session", () => {
		if (!currentRecordingSession) {
			return { success: false };
		}

		return {
			success: true,
			session: currentRecordingSession,
		};
	});

	handle("get-current-video-path", () => {
		return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
	});

	handle("clear-current-video-path", () => {
		setCurrentVideoPath(null);
		setCurrentRecordingSession(null);
		return { success: true };
	});

	handle("delete-recording-file", async (_, filePath: string) => {
		try {
			if (!filePath) {
				return { success: false, error: "Only auto-generated recordings can be deleted" };
			}
			const resolvedPath = await fs.realpath(filePath).catch(() => path.resolve(filePath));
			const recordingsDirRaw = await getRecordingsDir();
			const recordingsDir = await fs
				.realpath(recordingsDirRaw)
				.catch(() => path.resolve(recordingsDirRaw));
			if (
				!isPathInsideDirectory(resolvedPath, recordingsDir) ||
				!isAutoRecordingPath(resolvedPath)
			) {
				return { success: false, error: "Only auto-generated recordings can be deleted" };
			}
			await discardRecordingFiles(resolvedPath);
			if (windowsPendingVideoPath && path.resolve(windowsPendingVideoPath) === resolvedPath) {
				setWindowsPendingVideoPath(null);
			}
			const currentResolved = currentVideoPath
				? await fs.realpath(currentVideoPath).catch(() => currentVideoPath)
				: null;
			if (currentResolved === resolvedPath) {
				setCurrentVideoPath(null);
				setCurrentRecordingSession(null);
			}
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	handle("get-local-media-url", async (_, filePath: unknown) => {
		const baseUrl = getMediaServerBaseUrl();
		if (!baseUrl || typeof filePath !== "string" || !filePath) {
			return { success: false as const };
		}
		const resolved = await resolveApprovedLocalMediaPath(filePath);
		if (!resolved) {
			const normalized = path.resolve(filePath);
			console.warn(`[get-local-media-url] Blocked disallowed path: ${normalized}`);
			return { success: false as const };
		}
		return { success: true as const, url: buildMediaUrl(baseUrl, resolved) };
	});
}
