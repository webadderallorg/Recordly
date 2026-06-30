import fs from "node:fs/promises";
import path from "node:path";
import { dialog, ipcMain, shell } from "electron";
import {
	type CaptionGenerationProgress,
	generateAutoCaptionsFromVideo,
	resolveWhisperExecutablePath,
} from "../captions/generate";
import {
	deleteWhisperSmallModel,
	downloadWhisperSmallModel,
	getWhisperSmallModelStatus,
	sendWhisperModelDownloadProgress,
} from "../captions/whisper";
import { LEGACY_PROJECT_FILE_EXTENSIONS, PROJECT_FILE_EXTENSION } from "../constants";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { hasProjectFileExtension, loadProjectFromPath } from "../project/manager";
import { setCurrentProjectPath } from "../state";
import { approveUserPath, getRecordingsDir } from "../utils";

const VIDEO_FILE_EXTENSIONS = ["webm", "mp4", "mov", "avi", "mkv"];
const PROJECT_FILE_EXTENSIONS = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS];

function getErrorMessage(error: unknown) {
	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === "string") {
		return error.replace(/^Error:\s*/i, "");
	}

	return "Something went wrong";
}

type OpenVideoFilePickerOptions = {
	includeProjects?: boolean;
};

type WhisperFilePickerOptions = {
	currentPath?: string | null;
	selectionMode?: "file" | "directory";
};

async function resolveExistingDialogPath(candidatePath?: string | null) {
	const trimmedPath = candidatePath?.trim();
	if (!trimmedPath) {
		return null;
	}

	try {
		const stats = await fs.stat(trimmedPath);
		return stats.isDirectory() ? trimmedPath : path.dirname(trimmedPath);
	} catch {
		const parentPath = path.dirname(trimmedPath);
		try {
			const stats = await fs.stat(parentPath);
			return stats.isDirectory() ? parentPath : null;
		} catch {
			return null;
		}
	}
}

async function resolveDialogDefaultPath(candidates: Array<string | null | undefined>) {
	for (const candidatePath of candidates) {
		const dialogPath = await resolveExistingDialogPath(candidatePath);
		if (dialogPath) {
			return dialogPath;
		}
	}

	return undefined;
}

function getWhisperRuntimeDefaultPathCandidates(currentPath?: string | null) {
	return [
		currentPath,
		process.env["WHISPER_CPP_PATH"],
		process.platform === "win32" ? "C:\\Tools\\whisper" : null,
		process.platform === "win32" ? "C:\\whisper" : null,
		process.platform === "darwin" ? "/opt/homebrew/bin" : null,
		process.platform === "darwin" ? "/usr/local/bin" : null,
	];
}

function sendCaptionGenerationProgress(
	webContents: Electron.WebContents,
	payload: CaptionGenerationProgress,
) {
	if (webContents.isDestroyed()) {
		return;
	}

	webContents.send("caption-generation-progress", payload);
}

export function registerCaptionHandlers() {
	ipcMain.handle("open-video-file-picker", async (_, options?: OpenVideoFilePickerOptions) => {
		try {
			const includeProjects = Boolean(options?.includeProjects);
			const recordingsDir = await getRecordingsDir();
			const result = await dialog.showOpenDialog({
				title: includeProjects ? "Import Media or Recordly Project" : "Select Video File",
				defaultPath: recordingsDir,
				filters: [
					...(includeProjects
						? [
								{
									name: "Media or Recordly Projects",
									extensions: [
										...VIDEO_FILE_EXTENSIONS,
										...PROJECT_FILE_EXTENSIONS,
									],
								},
							]
						: []),
					{ name: "Video Files", extensions: VIDEO_FILE_EXTENSIONS },
					...(includeProjects
						? [{ name: "Recordly Projects", extensions: PROJECT_FILE_EXTENSIONS }]
						: []),
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			const selectedPath = result.filePaths[0];

			if (includeProjects && hasProjectFileExtension(selectedPath)) {
				const projectResult = await loadProjectFromPath(selectedPath);
				return projectResult.success
					? { ...projectResult, kind: "project" }
					: projectResult;
			}

			approveUserPath(selectedPath);
			setCurrentProjectPath(null);
			return {
				success: true,
				kind: "media",
				path: selectedPath,
				extension: path.extname(selectedPath).replace(/^\./, "").toLowerCase(),
			};
		} catch (error) {
			console.error("Failed to open file picker:", error);
			return {
				success: false,
				message: "Failed to open file picker",
				error: String(error),
			};
		}
	});

	ipcMain.handle("open-audio-file-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Select Audio File",
				filters: [
					{
						name: "Audio Files",
						extensions: ["mp3", "wav", "aac", "m4a", "flac", "ogg"],
					},
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			approveUserPath(result.filePaths[0]);
			return {
				success: true,
				path: result.filePaths[0],
			};
		} catch (error) {
			console.error("Failed to open audio file picker:", error);
			return {
				success: false,
				message: "Failed to open audio file picker",
				error: String(error),
			};
		}
	});

	ipcMain.handle(
		"open-whisper-executable-picker",
		async (_, options?: WhisperFilePickerOptions) => {
			try {
				const selectionMode = options?.selectionMode ?? "directory";
				const defaultPath = await resolveDialogDefaultPath(
					getWhisperRuntimeDefaultPathCandidates(options?.currentPath),
				);
				const result = await dialog.showOpenDialog({
					title:
						selectionMode === "file"
							? "Choose whisper-cli"
							: "Choose Whisper Engine Folder",
					defaultPath,
					buttonLabel:
						selectionMode === "file" ? "Use This Executable" : "Use This Folder",
					filters:
						selectionMode === "file"
							? [
									{
										name: "Whisper Engine",
										extensions:
											process.platform === "win32"
												? ["exe", "cmd", "bat"]
												: ["*"],
									},
									{ name: "All Files", extensions: ["*"] },
								]
							: undefined,
					properties: [selectionMode === "file" ? "openFile" : "openDirectory"],
				});

				if (result.canceled || result.filePaths.length === 0) {
					return { success: false, canceled: true };
				}

				approveUserPath(result.filePaths[0]);
				return { success: true, path: result.filePaths[0] };
			} catch (error) {
				console.error("Failed to open Whisper executable picker:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle("open-whisper-model-picker", async (_, options?: WhisperFilePickerOptions) => {
		try {
			const modelStatus = await getWhisperSmallModelStatus();
			const defaultPath = await resolveDialogDefaultPath([
				options?.currentPath,
				modelStatus.path,
				modelStatus.expectedPath,
			]);
			const result = await dialog.showOpenDialog({
				title: "Choose Whisper Model",
				defaultPath,
				buttonLabel: "Use This Model",
				filters: [
					{ name: "Whisper Models", extensions: ["bin"] },
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			approveUserPath(result.filePaths[0]);
			return { success: true, path: result.filePaths[0] };
		} catch (error) {
			console.error("Failed to open Whisper model picker:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-whisper-runtime-status", async (_, options?: WhisperFilePickerOptions) => {
		try {
			const runtimePath = await resolveWhisperExecutablePath(options?.currentPath);
			return { success: true, exists: true, path: runtimePath };
		} catch (error) {
			return {
				success: true,
				exists: false,
				path: null,
				error: getErrorMessage(error),
			};
		}
	});

	ipcMain.handle("get-caption-ffmpeg-status", async () => {
		try {
			const ffmpegPath = getFfmpegBinaryPath();
			return { success: true, exists: true, path: ffmpegPath };
		} catch (error) {
			return {
				success: true,
				exists: false,
				path: null,
				error: getErrorMessage(error),
			};
		}
	});

	ipcMain.handle("show-caption-path-in-folder", async (_, targetPath?: string | null) => {
		const trimmedPath = targetPath?.trim();
		if (!trimmedPath) {
			return { success: false, error: "No path is selected." };
		}

		try {
			const stats = await fs.stat(trimmedPath);
			if (stats.isFile()) {
				shell.showItemInFolder(trimmedPath);
				return { success: true };
			}

			const openError = await shell.openPath(trimmedPath);
			if (openError) {
				return { success: false, error: openError };
			}

			return { success: true };
		} catch (error) {
			return { success: false, error: getErrorMessage(error) };
		}
	});

	ipcMain.handle("get-whisper-small-model-status", async () => {
		try {
			return await getWhisperSmallModelStatus();
		} catch (error) {
			return { success: false, exists: false, path: null, error: String(error) };
		}
	});

	ipcMain.handle("download-whisper-small-model", async (event) => {
		try {
			const existing = await getWhisperSmallModelStatus();
			if (existing.exists) {
				sendWhisperModelDownloadProgress(event.sender, {
					status: "downloaded",
					progress: 100,
					path: existing.path,
				});
				return { success: true, path: existing.path, alreadyDownloaded: true };
			}

			const modelPath = await downloadWhisperSmallModel(event.sender);
			return { success: true, path: modelPath };
		} catch (error) {
			console.error("Failed to download Whisper small model:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("delete-whisper-small-model", async (event) => {
		try {
			await deleteWhisperSmallModel();
			sendWhisperModelDownloadProgress(event.sender, {
				status: "idle",
				progress: 0,
				path: null,
			});
			return { success: true };
		} catch (error) {
			console.error("Failed to delete Whisper small model:", error);
			// Verify whether the file was actually removed despite the error
			const status = await getWhisperSmallModelStatus();
			if (!status.exists) {
				// File is gone — treat as success
				sendWhisperModelDownloadProgress(event.sender, {
					status: "idle",
					progress: 0,
					path: null,
				});
				return { success: true };
			}
			sendWhisperModelDownloadProgress(event.sender, {
				status: "error",
				progress: 0,
				path: null,
				error: String(error),
			});
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle(
		"generate-auto-captions",
		async (
			event,
			options: {
				videoPath: string;
				whisperExecutablePath: string;
				whisperModelPath: string;
				language?: string;
			},
		) => {
			try {
				const result = await generateAutoCaptionsFromVideo({
					...options,
					onProgress: (progress) => sendCaptionGenerationProgress(event.sender, progress),
				});
				return {
					success: true,
					cues: result.cues,
					message:
						result.audioSourceLabel === "recording"
							? `Generated ${result.cues.length} caption cues.`
							: `Generated ${result.cues.length} caption cues from the ${result.audioSourceLabel}.`,
				};
			} catch (error) {
				console.error("Failed to generate auto captions:", error);
				const errorMessage = getErrorMessage(error);
				return {
					success: false,
					error: errorMessage,
					message: `Failed to generate auto captions: ${errorMessage}`,
				};
			}
		},
	);
}
