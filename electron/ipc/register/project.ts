import { constants as fsConstants } from "node:fs";
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
	isAllowedLocalMediaPath,
	isPathInsideDirectory,
	isTrustedProjectPath,
	listProjectLibraryEntries,
	loadProjectFromPath,
	persistRecordingsDirectorySetting,
	replaceApprovedSessionLocalReadPaths,
	rememberRecentProject,
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
      const trustedExistingProjectPath = isTrustedProjectPath(existingProjectPath)
        ? existingProjectPath
        : null

      if (trustedExistingProjectPath) {
        await fs.writeFile(trustedExistingProjectPath, JSON.stringify(projectData, null, 2), 'utf-8')
        setCurrentProjectPath(trustedExistingProjectPath)
        await saveProjectThumbnail(trustedExistingProjectPath, thumbnailDataUrl)
        await rememberRecentProject(trustedExistingProjectPath)
        return {
          success: true,
          path: trustedExistingProjectPath,
          message: 'Project saved successfully'
        }
      }

      const safeName = (suggestedName || `project-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, '_')
      const defaultName = safeName.endsWith(`.${PROJECT_FILE_EXTENSION}`)
        ? safeName
        : `${safeName}.${PROJECT_FILE_EXTENSION}`

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

      await fs.writeFile(result.filePath, JSON.stringify(projectData, null, 2), 'utf-8')
      setCurrentProjectPath(result.filePath)
      await saveProjectThumbnail(result.filePath, thumbnailDataUrl)
      await rememberRecentProject(result.filePath)

      return {
        success: true,
        path: result.filePath,
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
  ipcMain.handle('set-current-video-path', async (_, path: string) => {
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

    setCurrentProjectPath(null)
    return { success: true, webcamPath: resolvedSession.webcamPath ?? null }
  })

  ipcMain.handle('set-current-recording-session', async (_, session: { videoPath: string; webcamPath?: string | null; timeOffsetMs?: number }) => {
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
    setCurrentProjectPath(null)
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
    const normalized = path.resolve(filePath);
    let resolved: string;
    try {
      resolved = await fs.realpath(normalized);
    } catch {
      return { success: false as const };
    }
    if (!(await isAllowedLocalMediaPath(resolved))) {
      console.warn(`[get-local-media-url] Blocked disallowed path: ${resolved}`);
      return { success: false as const };
    }
    return { success: true as const, url: buildMediaUrl(baseUrl, resolved) };
  });

}
