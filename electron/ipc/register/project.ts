import { constants as fsConstants } from "node:fs";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dialog, ipcMain, shell } from "electron";
import { RECORDINGS_DIR } from "../../appPaths";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import {
	PROJECT_FILE_EXTENSION,
	LEGACY_PROJECT_FILE_EXTENSIONS,
} from "../constants";
import {
	currentProjectPath,
	setCurrentProjectPath,
	currentVideoPath,
	setCurrentVideoPath,
	currentRecordingSession,
	setCurrentRecordingSession,
} from "../state";
import {
	getProjectsDir,
  getProjectThumbnailPath,
	isPathInsideDirectory,
	isTrustedProjectPath,
	listProjectLibraryEntries,
  loadRecentProjectPaths,
	loadProjectFromPath,
	persistRecordingsDirectorySetting,
	replaceApprovedSessionLocalReadPaths,
	resolveApprovedLocalMediaPath,
	rememberRecentProject,
  saveRecentProjectPaths,
	saveProjectThumbnail,
} from "../project/manager";
import {
	getTelemetryPathForVideo,
	isAutoRecordingPath,
	getRecordingsDir,
	approveUserPath,
	normalizeVideoSourcePath,
} from "../utils";
import { persistRecordingSessionManifest, resolveRecordingSession } from "../project/session";

function normalizeRecordingTimeOffsetMs(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
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
    const existingProjectData = JSON.parse(existingProjectRaw) as unknown;
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
  ipcMain.handle('reveal-in-folder', async (_, filePath: string) => {
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
        return { success: true, message: 'Could not reveal item, but opened directory.' };
      } catch (openError) {
        console.error(`Error opening directory: ${path.dirname(filePath)}`, openError);
        return { success: false, error: String(error) };
      }
    }
  });

  ipcMain.handle('open-recordings-folder', async () => {
    try {
      const recordingsDir = await getRecordingsDir();
      const openPathResult = await shell.openPath(recordingsDir);
      if (openPathResult) {
        return { success: false, error: openPathResult, message: 'Failed to open recordings folder.' };
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
      return { success: false, error: String(error), message: 'Failed to open recordings folder.' };
    }
  });

  ipcMain.handle('get-recordings-directory', async () => {
    try {
      const recordingsDir = await getRecordingsDir()
      return {
        success: true,
        path: recordingsDir,
        isDefault: recordingsDir === RECORDINGS_DIR,
      }
    } catch (error) {
      return {
        success: false,
        path: RECORDINGS_DIR,
        isDefault: true,
        error: String(error),
      }
    }
  })

  ipcMain.handle('choose-recordings-directory', async () => {
    try {
      const current = await getRecordingsDir()
      const result = await dialog.showOpenDialog({
        title: 'Choose recordings folder',
        defaultPath: current,
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true, path: current }
      }

      const selectedPath = path.resolve(result.filePaths[0])
      await fs.mkdir(selectedPath, { recursive: true })
      await fs.access(selectedPath, fsConstants.W_OK)
      await persistRecordingsDirectorySetting(selectedPath)

      return { success: true, path: selectedPath, isDefault: selectedPath === RECORDINGS_DIR }
    } catch (error) {
      return { success: false, error: String(error), message: 'Failed to set recordings folder' }
    }
  })

  ipcMain.handle('save-project-file', async (_, projectData: unknown, suggestedName?: string, existingProjectPath?: string, thumbnailDataUrl?: string | null) => {
    try {
      const projectsDir = await getProjectsDir()
      const preparedProject = ensureProjectDataHasProjectId(projectData)
      const trustedExistingProjectPath = isTrustedProjectPath(existingProjectPath)
        ? existingProjectPath
        : null

      if (trustedExistingProjectPath) {
        await fs.writeFile(trustedExistingProjectPath, JSON.stringify(preparedProject.projectData, null, 2), 'utf-8')
        setCurrentProjectPath(trustedExistingProjectPath)
        await saveProjectThumbnail(trustedExistingProjectPath, thumbnailDataUrl)
        await rememberRecentProject(trustedExistingProjectPath)
        return {
          success: true,
          path: trustedExistingProjectPath,
          projectId: preparedProject.projectId,
          message: 'Project saved successfully'
        }
      }

      const safeName = normalizeProjectSaveName(suggestedName) || `project-${Date.now()}`
      const defaultName = `${safeName}.${PROJECT_FILE_EXTENSION}`

      const result = await dialog.showSaveDialog({
        title: 'Save Recordly Project',
        defaultPath: path.join(projectsDir, defaultName),
        filters: [
          { name: 'Recordly Project', extensions: [PROJECT_FILE_EXTENSION] },
          { name: 'JSON', extensions: ['json'] }
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          canceled: true,
          message: 'Save project canceled'
        }
      }

      await fs.writeFile(result.filePath, JSON.stringify(preparedProject.projectData, null, 2), 'utf-8')
      setCurrentProjectPath(result.filePath)
      await saveProjectThumbnail(result.filePath, thumbnailDataUrl)
      await rememberRecentProject(result.filePath)

      return {
        success: true,
        path: result.filePath,
        projectId: preparedProject.projectId,
        message: 'Project saved successfully'
      }
    } catch (error) {
      console.error('Failed to save project file:', error)
      return {
        success: false,
        message: 'Failed to save project file',
        error: String(error)
      }
    }
  })

    ipcMain.handle('save-project-file-named', async (_, projectData: unknown, projectName: string, thumbnailDataUrl?: string | null) => {
      try {
        const normalizedProjectName = normalizeProjectSaveName(projectName)
        if (!normalizedProjectName) {
          return {
            success: false,
            message: 'Project name is required',
          }
        }

        const projectsDir = await getProjectsDir()
        const preparedProject = ensureProjectDataHasProjectId(projectData)
        const activeProjectPath = isTrustedProjectPath(currentProjectPath)
          ? currentProjectPath
          : null
        const targetProjectPath = path.join(
          projectsDir,
          `${normalizedProjectName}.${PROJECT_FILE_EXTENSION}`,
        )

        const overwriteCheck = await ensureNamedProjectSaveDoesNotOverwriteDifferentProject(
          targetProjectPath,
          preparedProject.projectData,
          activeProjectPath,
        )
        if (!overwriteCheck.success) {
          return overwriteCheck
        }

        await fs.writeFile(targetProjectPath, JSON.stringify(preparedProject.projectData, null, 2), 'utf-8')
        await saveProjectThumbnail(targetProjectPath, thumbnailDataUrl)
        await rememberRecentProject(targetProjectPath)

        if (activeProjectPath) {
          const [activeResolvedPath, targetResolvedPath] = await Promise.all([
            resolveComparablePath(activeProjectPath),
            resolveComparablePath(targetProjectPath),
          ])

          if (activeResolvedPath !== targetResolvedPath) {
            await fs.unlink(activeProjectPath).catch((unlinkError: NodeJS.ErrnoException) => {
              if (unlinkError.code !== 'ENOENT') {
                throw unlinkError
              }
            })
            await fs.rm(getProjectThumbnailPath(activeProjectPath), { force: true }).catch(() => undefined)

            const recentProjectPaths = await loadRecentProjectPaths()
            const filteredRecentProjectPaths: string[] = []
            for (const recentProjectPath of recentProjectPaths) {
              const recentResolvedPath = await resolveComparablePath(recentProjectPath)
              if (recentResolvedPath !== activeResolvedPath) {
                filteredRecentProjectPaths.push(recentProjectPath)
              }
            }
            await saveRecentProjectPaths(filteredRecentProjectPaths)
          }
        }

        setCurrentProjectPath(targetProjectPath)

        return {
          success: true,
          path: targetProjectPath,
          projectId: preparedProject.projectId,
          message: 'Project saved successfully'
        }
      } catch (error) {
        console.error('Failed to save named project file:', error)
        return {
          success: false,
          message: 'Failed to save project file',
          error: String(error)
        }
      }
    })

  ipcMain.handle('load-project-file', async () => {
    try {
      const projectsDir = await getProjectsDir()
      const result = await dialog.showOpenDialog({
        title: 'Open Recordly Project',
        defaultPath: projectsDir,
        filters: [
          { name: 'Recordly Project', extensions: [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true, message: 'Open project canceled' }
      }

      return await loadProjectFromPath(result.filePaths[0])
    } catch (error) {
      console.error('Failed to load project file:', error)
      return {
        success: false,
        message: 'Failed to load project file',
        error: String(error)
      }
    }
  })

  ipcMain.handle('load-current-project-file', async () => {
    try {
      if (!currentProjectPath) {
        return { success: false, message: 'No active project' }
      }

      return await loadProjectFromPath(currentProjectPath)
    } catch (error) {
      console.error('Failed to load current project file:', error)
      return {
        success: false,
        message: 'Failed to load current project file',
        error: String(error),
      }
    }
  })

  ipcMain.handle('get-projects-directory', async () => {
    try {
      return {
        success: true,
        path: await getProjectsDir(),
      }
    } catch (error) {
      return {
        success: false,
        error: String(error),
      }
    }
  })

  ipcMain.handle('list-project-files', async () => {
    try {
      const library = await listProjectLibraryEntries()
      return {
        success: true,
        projectsDir: library.projectsDir,
        entries: library.entries,
      }
    } catch (error) {
      return {
        success: false,
        projectsDir: null,
        entries: [],
        error: String(error),
      }
    }
  })

  ipcMain.handle('open-project-file-at-path', async (_, filePath: string) => {
    try {
      return await loadProjectFromPath(filePath)
    } catch (error) {
      console.error('Failed to open project file at path:', error)
      return {
        success: false,
        message: 'Failed to open project file',
        error: String(error),
      }
    }
  })

  ipcMain.handle('open-projects-directory', async () => {
    try {
      const projectsDir = await getProjectsDir()
      const openPathResult = await shell.openPath(projectsDir)
      if (openPathResult) {
        return { success: false, error: openPathResult, message: 'Failed to open projects folder.' }
      }

      return { success: true, path: projectsDir }
    } catch (error) {
      console.error('Failed to open projects folder:', error)
      return { success: false, error: String(error), message: 'Failed to open projects folder.' }
    }
  })
  ipcMain.handle('set-current-video-path', async (_, path: string, options?: { preserveProjectPath?: boolean }) => {
    setCurrentVideoPath(normalizeVideoSourcePath(path) ?? path)
    approveUserPath(currentVideoPath)
    const resolvedSession = await resolveRecordingSession(currentVideoPath)
      ?? {
        videoPath: currentVideoPath!,
        webcamPath: null,
        timeOffsetMs: 0,
      }

    setCurrentRecordingSession(resolvedSession)
    await replaceApprovedSessionLocalReadPaths([
      resolvedSession.videoPath,
      resolvedSession.webcamPath,
    ])

    if (resolvedSession.webcamPath) {
      await persistRecordingSessionManifest(resolvedSession)
    }

    if (!options?.preserveProjectPath) {
      setCurrentProjectPath(null)
    }
    return { success: true, webcamPath: resolvedSession.webcamPath ?? null }
  })

  ipcMain.handle('set-current-recording-session', async (_, session: { videoPath: string; webcamPath?: string | null; timeOffsetMs?: number }, options?: { preserveProjectPath?: boolean }) => {
    const normalizedVideoPath = normalizeVideoSourcePath(session.videoPath) ?? session.videoPath
    setCurrentVideoPath(normalizedVideoPath)
    setCurrentRecordingSession({
      videoPath: normalizedVideoPath,
      webcamPath: normalizeVideoSourcePath(session.webcamPath ?? null),
      timeOffsetMs: normalizeRecordingTimeOffsetMs(session.timeOffsetMs),
    });
    await replaceApprovedSessionLocalReadPaths([
      currentRecordingSession!.videoPath,
      currentRecordingSession!.webcamPath,
    ])
    if (!options?.preserveProjectPath) {
      setCurrentProjectPath(null)
    }
    await persistRecordingSessionManifest(currentRecordingSession!)
    return { success: true }
  })

  ipcMain.handle('get-current-recording-session', () => {
    if (!currentRecordingSession) {
      return { success: false }
    }

    return {
      success: true,
      session: currentRecordingSession,
    }
  })

  ipcMain.handle('get-current-video-path', () => {
    return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
  });

  ipcMain.handle('clear-current-video-path', () => {
    setCurrentVideoPath(null);
    setCurrentRecordingSession(null);
    return { success: true };
  });

  ipcMain.handle('delete-recording-file', async (_, filePath: string) => {
    try {
      if (!filePath) {
        return { success: false, error: 'Only auto-generated recordings can be deleted' };
      }
      const resolvedPath = await fs.realpath(filePath).catch(() => path.resolve(filePath));
			const recordingsDirRaw = await getRecordingsDir();
			const recordingsDir = await fs.realpath(recordingsDirRaw).catch(() => path.resolve(recordingsDirRaw));
      if (!isPathInsideDirectory(resolvedPath, recordingsDir) || !isAutoRecordingPath(resolvedPath)) {
        return { success: false, error: 'Only auto-generated recordings can be deleted' };
      }
      await fs.unlink(resolvedPath);
      // Also delete the cursor telemetry sidecar if it exists
      const telemetryPath = getTelemetryPathForVideo(resolvedPath);
      await fs.unlink(telemetryPath).catch(() => {});
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

  ipcMain.handle('get-local-media-url', async (_, filePath: string) => {
    const baseUrl = getMediaServerBaseUrl();
    if (!baseUrl || !filePath) {
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
