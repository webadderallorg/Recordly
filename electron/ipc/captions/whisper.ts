import { createWriteStream } from "node:fs";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { app, type WebContents } from "electron";
import { getModelById, getModelFilePath, getModelStorageDir } from "./models";

// ─── IPC Event Helpers ──────────────────────────────────────────────────

export type ModelDownloadStatus = "idle" | "downloading" | "downloaded" | "error";

export interface ModelDownloadProgressPayload {
	modelId: string;
	status: ModelDownloadStatus;
	progress: number;
	path?: string | null;
	error?: string;
}

/**
 * Send model download progress to the renderer.
 * Event name is per-model so the UI can track multiple models independently.
 */
export function sendModelDownloadProgress(
	webContents: WebContents,
	payload: ModelDownloadProgressPayload,
) {
	webContents.send("model-download-progress", payload);
}

// ─── Model Status ───────────────────────────────────────────────────────

export async function getModelStatus(modelId: string): Promise<{
	success: boolean;
	exists: boolean;
	path?: string | null;
}> {
	const model = getModelById(modelId);
	if (!model) return { success: false, exists: false };

	// getModelFilePath checks bundled path first, then user-data download
	const filePath = getModelFilePath(model, app.getPath("userData"));
	try {
		await fs.access(filePath, fsConstants.R_OK);
		return { success: true, exists: true, path: filePath };
	} catch {
		return { success: true, exists: false, path: null };
	}
}



// ─── File Download ──────────────────────────────────────────────────────

export function downloadFileWithProgress(
	url: string,
	destinationPath: string,
	onProgress: (progress: number) => void,
): Promise<void> {
	const request = (currentUrl: string, redirectCount = 0): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			if (redirectCount >= 5) {
				reject(new Error("Too many redirects while downloading model."));
				return;
			}

			const req = httpsGet(currentUrl, (response) => {
				const statusCode = response.statusCode ?? 0;

				if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
					response.resume();
					return request(response.headers.location, redirectCount + 1).then(resolve, reject);
				}

				if (statusCode !== 200) {
					response.resume();
					reject(new Error(`Model download failed with status ${statusCode}.`));
					return;
				}

				const totalBytes = Number.parseInt(response.headers["content-length"] ?? "0", 10);
				let downloadedBytes = 0;

				const fileStream = createWriteStream(destinationPath);

				response.on("data", (chunk: Buffer) => {
					downloadedBytes += chunk.length;
					if (totalBytes > 0) {
						onProgress((downloadedBytes / totalBytes) * 100);
					}
				});

				response.pipe(fileStream);

				fileStream.on("finish", () => {
					fileStream.close();
					onProgress(100);
					resolve();
				});

				fileStream.on("error", (error) => {
					fileStream.close();
					reject(error);
				});

				response.on("error", (error) => {
					fileStream.close();
					reject(error);
				});
			});

			req.on("error", reject);
			req.on("timeout", () => {
				req.destroy(new Error("Model download timed out."));
			});
			req.setTimeout(30_000);
		});

	return request(url);
}

// ─── Model Download ─────────────────────────────────────────────────────

/**
 * Download a model (and its auxiliary files) by model ID.
 * Reports progress via IPC to the renderer.
 */
export async function downloadModel(
	webContents: WebContents,
	modelId: string,
): Promise<string> {
	const model = getModelById(modelId);
	if (!model) throw new Error(`Unknown model: ${modelId}`);

	const storageDir = getModelStorageDir(model, app.getPath("userData"));
	await fs.mkdir(storageDir, { recursive: true });

	const primaryPath = getModelFilePath(model, app.getPath("userData"));
	const tempPath = `${primaryPath}.download`;

	sendModelDownloadProgress(webContents, {
		modelId,
		status: "downloading",
		progress: 0,
		path: null,
	});

	try {
		// Clean up any stale temp file
		await fs.rm(tempPath, { force: true });

		// Download primary model file
		await downloadFileWithProgress(model.downloadUrl, tempPath, (progress) => {
			sendModelDownloadProgress(webContents, {
				modelId,
				status: "downloading",
				progress: progress * 0.9, // Reserve 10% for auxiliary files
				path: null,
			});
		});
		await fs.rename(tempPath, primaryPath);

		// Download auxiliary files (tokenizer.json, etc.)
		if (model.auxiliaryFiles) {
			for (const aux of model.auxiliaryFiles) {
				const auxPath = path.join(storageDir, aux.fileName);
				try {
					await fs.access(auxPath, fsConstants.R_OK);
					continue; // Already exists
				} catch {
					await downloadFileWithProgress(aux.url, auxPath, () => undefined);
				}
				await downloadFileWithProgress(aux.url, auxPath, () => {});
			}
		}

		sendModelDownloadProgress(webContents, {
			modelId,
			status: "downloaded",
			progress: 100,
			path: primaryPath,
		});
		return primaryPath;
	} catch (error) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		sendModelDownloadProgress(webContents, {
			modelId,
			status: "error",
			progress: 0,
			path: null,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

// ─── Model Deletion ─────────────────────────────────────────────────────

/**
 * Delete a downloaded model and its auxiliary files.
 */
export async function deleteModel(modelId: string): Promise<void> {
	const model = getModelById(modelId);
	if (!model) throw new Error(`Unknown model: ${modelId}`);

	const storageDir = getModelStorageDir(model, app.getPath("userData"));
	await fs.rm(storageDir, { recursive: true, force: true });
}


