import { createWriteStream } from "node:fs";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import type Electron from "electron";
import {
	WHISPER_MODEL_DIR,
	WHISPER_MODEL_DOWNLOAD_URL,
	WHISPER_SMALL_MODEL_PATH,
} from "../constants";

export function sendWhisperModelDownloadProgress(
	webContents: Electron.WebContents | null | undefined,
	payload: {
		status: "idle" | "downloading" | "downloaded" | "error";
		progress: number;
		path?: string | null;
		error?: string;
	},
) {
	if (!webContents || webContents.isDestroyed()) {
		return;
	}

	try {
		webContents.send("whisper-small-model-download-progress", payload);
	} catch {
		// webContents may have been destroyed concurrently
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
	signal?: AbortSignal,
): Promise<void> {
	const request = (currentUrl: string, redirectCount = 0): Promise<void> => {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Download aborted"));
				return;
			}

			let fileStream: ReturnType<typeof createWriteStream> | null = null;
			let settled = false;

			const onAbort = () => {
				if (settled) return;
				settled = true;
				cleanupSignal();
				if (fileStream) {
					fileStream.destroy();
				}
				req.destroy(new Error("Download aborted"));
				reject(new Error("Download aborted"));
			};

			const cleanupSignal = () => {
				if (signal) {
					signal.removeEventListener("abort", onAbort);
				}
			};

			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}

			const req = httpsGet(currentUrl, { timeout: 30_000 }, (response) => {
				const statusCode = response.statusCode ?? 0;
				const location = response.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					response.resume();
					cleanupSignal();
					if (redirectCount >= 5) {
						settled = true;
						reject(new Error("Too many redirects while downloading Whisper model."));
						return;
					}

					const nextUrl = new URL(location, currentUrl).toString();
					void request(nextUrl, redirectCount + 1)
						.then(resolve)
						.catch(reject);
					return;
				}

				if (statusCode < 200 || statusCode >= 300) {
					response.resume();
					cleanupSignal();
					settled = true;
					reject(new Error(`Whisper model download failed with status ${statusCode}.`));
					return;
				}

				const totalBytes = Number.parseInt(
					String(response.headers["content-length"] ?? "0"),
					10,
				);
				let downloadedBytes = 0;
				fileStream = createWriteStream(destinationPath);

				response.on("data", (chunk: Buffer) => {
					downloadedBytes += chunk.length;
					if (Number.isFinite(totalBytes) && totalBytes > 0) {
						onProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
					}
				});

				response.on("error", (error) => {
					cleanupSignal();
					if (!settled) {
						settled = true;
						fileStream?.destroy(error);
						reject(error);
					}
				});

				fileStream.on("error", (error) => {
					cleanupSignal();
					if (!settled) {
						settled = true;
						response.destroy(error);
						reject(error);
					}
				});

				fileStream.on("finish", () => {
					cleanupSignal();
					if (!settled) {
						settled = true;
						onProgress(100);
						resolve();
					}
				});

				response.pipe(fileStream);
			});

			req.on("error", (error) => {
				cleanupSignal();
				if (!settled) {
					settled = true;
					reject(error);
				}
			});

			req.on("timeout", () => {
				cleanupSignal();
				if (!settled) {
					settled = true;
					req.destroy(new Error("Whisper model download timed out."));
					reject(new Error("Whisper model download timed out."));
				}
			});
		});
	};

	return request(url);
}

export async function downloadWhisperSmallModel(
	webContents: Electron.WebContents,
): Promise<string> {
	await fs.mkdir(WHISPER_MODEL_DIR, { recursive: true });
	const tempPath = `${WHISPER_SMALL_MODEL_PATH}.download`;

	if (webContents.isDestroyed()) {
		throw new Error("Window was closed before Whisper model download could start.");
	}

	const abortController = new AbortController();
	const handleDestroyed = () => {
		abortController.abort();
	};

	webContents.once("destroyed", handleDestroyed);

	sendWhisperModelDownloadProgress(webContents, {
		status: "downloading",
		progress: 0,
		path: null,
	});

	try {
		await fs.rm(tempPath, { force: true });
		await downloadFileWithProgress(
			WHISPER_MODEL_DOWNLOAD_URL,
			tempPath,
			(progress) => {
				sendWhisperModelDownloadProgress(webContents, {
					status: "downloading",
					progress,
					path: null,
				});
			},
			abortController.signal,
		);
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
	} finally {
		if (!webContents.isDestroyed()) {
			webContents.removeListener("destroyed", handleDestroyed);
		}
	}
}

export async function deleteWhisperSmallModel(): Promise<void> {
	await fs.rm(WHISPER_SMALL_MODEL_PATH, { force: true });
}
