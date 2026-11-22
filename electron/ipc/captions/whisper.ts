import { createWriteStream, constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type Electron from "electron";
import {
	WHISPER_MODEL_DIR,
	WHISPER_MODEL_DOWNLOAD_URL,
	WHISPER_SMALL_MODEL_PATH,
} from "../constants";
import { receiveCaptionDownload } from "./modelDownloadTransport";

export function sendWhisperModelDownloadProgress(
	webContents: Electron.WebContents | null | undefined,
	payload: {
		status: "idle" | "downloading" | "downloaded" | "error";
		progress: number;
		path?: string | null;
		error?: string;
	},
) {
	try {
		if (webContents && !webContents.isDestroyed())
			webContents.send("whisper-small-model-download-progress", payload);
	} catch {
		// Closing a window does not interrupt the model installation.
	}
}

export async function getWhisperSmallModelStatus() {
	try {
		await fs.access(WHISPER_SMALL_MODEL_PATH, fsConstants.R_OK);
		return {
			success: true,
			exists: true,
			path: WHISPER_SMALL_MODEL_PATH,
		};
	} catch {
		return {
			success: true,
			exists: false,
			path: null,
		};
	}
}

export function downloadFileWithProgress(
	url: string,
	destinationPath: string,
	onProgress: (progress: number) => void,
): Promise<void> {
	return receiveCaptionDownload(url, 5, async (response) => {
		const { statusCode } = response;
		if (statusCode < 200 || statusCode >= 300) {
			throw new Error(`Whisper model download failed with status ${statusCode}.`);
		}
		const totalBytes = Number.parseInt(String(response.headers["content-length"] ?? "0"), 10);
		let downloadedBytes = 0;
		let latestProgress = 0;
		const progress = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				downloadedBytes += chunk.length;
				if (Number.isFinite(totalBytes) && totalBytes > 0) {
					const next = Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100));
					if (next > latestProgress) {
						latestProgress = next;
						onProgress(next);
					}
				}
				callback(null, chunk);
			},
		});
		await pipeline(response, progress, createWriteStream(destinationPath));
		onProgress(100);
	});
}

export async function downloadWhisperSmallModel(
	webContents: Electron.WebContents | null | undefined,
): Promise<string> {
	await fs.mkdir(WHISPER_MODEL_DIR, { recursive: true });
	const tempPath = `${WHISPER_SMALL_MODEL_PATH}.download`;

	sendWhisperModelDownloadProgress(webContents, {
		status: "downloading",
		progress: 0,
		path: null,
	});

	try {
		await fs.rm(tempPath, { force: true });
		await downloadFileWithProgress(WHISPER_MODEL_DOWNLOAD_URL, tempPath, (progress) => {
			sendWhisperModelDownloadProgress(webContents, {
				status: "downloading",
				progress,
				path: null,
			});
		});
		await fs.rename(tempPath, WHISPER_SMALL_MODEL_PATH);
		sendWhisperModelDownloadProgress(webContents, {
			status: "downloaded",
			progress: 100,
			path: WHISPER_SMALL_MODEL_PATH,
		});
		return WHISPER_SMALL_MODEL_PATH;
	} catch (error) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		sendWhisperModelDownloadProgress(webContents, {
			status: "error",
			progress: 0,
			path: null,
			error: String(error),
		});
		throw error;
	}
}

export async function deleteWhisperSmallModel(): Promise<void> {
	await fs.rm(WHISPER_SMALL_MODEL_PATH, { force: true });
}
