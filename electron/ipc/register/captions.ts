import path from "node:path";
import { dialog, ipcMain } from "electron";
import { generateAutoCaptionsFromVideo } from "../captions/generate";
import {
	deleteModel,
	downloadModel,
	getModelStatus,
	sendModelDownloadProgress,
} from "../captions/whisper";
import { CAPTION_MODELS } from "../captions/models";
import { LEGACY_PROJECT_FILE_EXTENSIONS, PROJECT_FILE_EXTENSION } from "../constants";
import { hasProjectFileExtension, loadProjectFromPath } from "../project/manager";
import { setCurrentProjectPath } from "../state";
import { approveUserPath } from "../utils";

const VIDEO_FILE_EXTENSIONS = ["webm", "mp4", "mov", "avi", "mkv"];
const PROJECT_FILE_EXTENSIONS = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS];

type OpenVideoFilePickerOptions = {
	includeProjects?: boolean;
};

export function registerCaptionHandlers() {
	ipcMain.handle("open-video-file-picker", async (_, options?: OpenVideoFilePickerOptions) => {
		try {
			const filters: Electron.FileFilter[] = [
				{
					name: "Video Files",
					extensions: VIDEO_FILE_EXTENSIONS,
				},
			];

			if (options?.includeProjects) {
				filters.unshift({
					name: "Recordly Projects",
					extensions: PROJECT_FILE_EXTENSIONS,
				});
			}

			const result = await dialog.showOpenDialog({
				title: "Open Video",
				filters,
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			const filePath = result.filePaths[0];
			const extension = path.extname(filePath).slice(1).toLowerCase();

			if (options?.includeProjects && hasProjectFileExtension(filePath)) {
				try {
					const project = await loadProjectFromPath(filePath);
					setCurrentProjectPath(filePath);
					return { success: true, canceled: false, path: filePath, extension, kind: "project", project };
				} catch (error) {
					return { success: false, canceled: false, error: `Failed to load project: ${error}` };
				}
			}

			approveUserPath(filePath);
			setCurrentProjectPath(null);

			return { success: true, canceled: false, path: filePath, extension, kind: "media" };
		} catch (error) {
			console.error("Failed to open video file picker:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-audio-file-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Open Audio File",
				filters: [
					{
						name: "Audio Files",
						extensions: ["mp3", "wav", "aac", "m4a", "flac", "ogg"],
					},
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			const filePath = result.filePaths[0];
			approveUserPath(filePath);

			return { success: true, path: filePath };
		} catch (error) {
			console.error("Failed to open audio file picker:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-whisper-executable-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Select Whisper Executable",
				filters: [
					{
						name: "Executables",
						extensions: process.platform === "win32" ? ["exe"] : ["*"],
					},
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			const filePath = result.filePaths[0];
			approveUserPath(filePath);

			return { success: true, path: filePath };
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
					{ name: "ONNX Models", extensions: ["onnx"] },
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			const filePath = result.filePaths[0];
			approveUserPath(filePath);

			return { success: true, path: filePath };
		} catch (error) {
			console.error("Failed to open Whisper model picker:", error);
			return { success: false, error: String(error) };
		}
	});

	// ── Model registry queries ──────────────────────────────────────────

	ipcMain.handle("get-available-models", () => {
		return CAPTION_MODELS.map((m) => ({
			id: m.id,
			name: m.name,
			engine: m.engine,
			sizeLabel: m.sizeLabel,
			languages: m.languages,
			description: m.description,
		}));
	});

	// ── Per-model status / download / delete ────────────────────────────

	ipcMain.handle("get-model-status", async (_, modelId: string) => {
		try {
			return await getModelStatus(modelId);
		} catch (error) {
			return { success: false, exists: false, path: null, error: String(error) };
		}
	});

	ipcMain.handle("download-model", async (event, modelId: string) => {
		try {
			const existing = await getModelStatus(modelId);
			if (existing.exists) {
				sendModelDownloadProgress(event.sender, {
					modelId,
					status: "downloaded",
					progress: 100,
					path: existing.path,
				});
				return { success: true, path: existing.path };
			}

			const modelPath = await downloadModel(event.sender, modelId);
			return { success: true, path: modelPath };
		} catch (error) {
			console.error(`Failed to download model ${modelId}:`, error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("delete-model", async (event, modelId: string) => {
		try {
			await deleteModel(modelId);
			sendModelDownloadProgress(event.sender, {
				modelId,
				status: "idle",
				progress: 0,
			});
			return { success: true };
		} catch (error) {
			// If the file is actually gone despite the error, report success
			const status = await getModelStatus(modelId);
			if (!status.exists) {
				sendModelDownloadProgress(event.sender, {
					modelId,
					status: "idle",
					progress: 0,
				});
				return { success: true };
			}
			console.error(`Failed to delete model ${modelId}:`, error);
			return { success: false, error: String(error) };
		}
	});

	// ── Caption generation ──────────────────────────────────────────────

	ipcMain.handle(
		"generate-auto-captions",
		async (
			_,
			options: {
				videoPath: string;
				whisperExecutablePath?: string;
				whisperModelPath: string;
				modelId?: string;
				language?: string;
			},
		) => {
			try {
				return await generateAutoCaptionsFromVideo(options);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { success: false, cues: [], error: message };
			}
		},
	);
}
