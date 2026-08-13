import path from "node:path";
import { dialog, ipcMain } from "electron";
import { generateAutoCaptionsFromVideo } from "../captions/generate";
import {
	deleteWhisperSmallModel,
	downloadWhisperSmallModel,
	getWhisperSmallModelStatus,
	sendWhisperModelDownloadProgress,
} from "../captions/whisper";
import { LEGACY_PROJECT_FILE_EXTENSIONS, PROJECT_FILE_EXTENSION } from "../constants";
import { hasProjectFileExtension, loadProjectFromPath } from "../project/manager";
import { setCurrentProjectPath } from "../state";
import { approveUserPath, getRecordingsDir } from "../utils";

const VIDEO_FILE_EXTENSIONS = ["webm", "mp4", "mov", "avi", "mkv"];
const PROJECT_FILE_EXTENSIONS = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS];

type OpenVideoFilePickerOptions = {
	includeProjects?: boolean;
};

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

	ipcMain.handle("open-whisper-executable-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Select Whisper Executable",
				filters: [
					{
						name: "Executables",
						extensions: process.platform === "win32" ? ["exe", "cmd", "bat"] : ["*"],
					},
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
			console.error("Failed to open Whisper executable picker:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-whisper-model-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Select Whisper Model",
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
			_,
			options: {
				videoPath: string;
				whisperExecutablePath: string;
				whisperModelPath: string;
				language?: string;
			},
		) => {
			try {
				const result = await generateAutoCaptionsFromVideo(options);
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
				return {
					success: false,
					error: String(error),
					message: "Failed to generate auto captions",
				};
			}
		},
	);
}
