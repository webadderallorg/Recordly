import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app, type WebContents } from "electron";

export const PARAKEET_MODEL_REVISION = "2bda32ec70b097a55adaa07d9a7173915b43cc78";
export const PARAKEET_MODEL_FILES = [
	{
		name: "encoder.int8.onnx",
		size: 652184281,
		sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
	},
	{
		name: "decoder.int8.onnx",
		size: 11845275,
		sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
	},
	{
		name: "joiner.int8.onnx",
		size: 6355277,
		sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
	},
	{
		name: "tokens.txt",
		size: 93939,
		sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
	},
] as const;
const MODEL_URL = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/${PARAKEET_MODEL_REVISION}`;
const READY_FILE = "recordly-model.json";
const totalBytes = PARAKEET_MODEL_FILES.reduce((sum, file) => sum + file.size, 0);

type Progress = {
	status: "idle" | "downloading" | "downloaded" | "error";
	progress: number;
	path?: string | null;
	error?: string;
};

function modelDirectory() {
	return path.join(app.getPath("userData"), "captions", "parakeet-tdt-0.6b-v3-int8");
}

export function sendParakeetModelDownloadProgress(webContents: WebContents, payload: Progress) {
	// A model download can outlive the window that started it.
	try {
		if (!webContents.isDestroyed()) {
			webContents.send("parakeet-model-download-progress", payload);
			webContents.send("caption-model-download-progress", {
				modelId: "parakeet-v3",
				...payload,
			});
		}
	} catch {
		// Closing a renderer between the destruction check and send must not
		// interrupt the shared installation or other windows' progress events.
	}
}

/** Only complete, verified installations are offered to the recognizer. */
export async function assertParakeetModelDirectory(directory: string): Promise<void> {
	const ready = JSON.parse(await fs.readFile(path.join(directory, READY_FILE), "utf8"));
	if (ready.revision !== PARAKEET_MODEL_REVISION || ready.verified !== true) {
		throw new Error(
			"The Parakeet model is incomplete or outdated. Download it again in Caption settings.",
		);
	}
	for (const file of PARAKEET_MODEL_FILES) {
		const stat = await fs.stat(path.join(directory, file.name));
		if (!stat.isFile() || stat.size !== file.size) {
			throw new Error(
				`The Parakeet model file ${file.name} is incomplete. Download the model again.`,
			);
		}
	}
}

export async function getParakeetModelStatus() {
	try {
		const directory = modelDirectory();
		await assertParakeetModelDirectory(directory);
		return { success: true, exists: true, path: directory };
	} catch {
		return { success: true, exists: false, path: null };
	}
}

async function downloadVerifiedFile(
	url: string,
	destination: string,
	file: (typeof PARAKEET_MODEL_FILES)[number],
	onBytes: (bytes: number) => void,
	redirects = 0,
): Promise<void> {
	if (new URL(url).protocol !== "https:")
		throw new Error("Parakeet model downloads require HTTPS.");
	await new Promise<void>((resolve, reject) => {
		const request = httpsGet(url, { timeout: 30_000 }, (response) => {
			const status = response.statusCode ?? 0;
			if (status >= 300 && status < 400 && response.headers.location) {
				response.resume();
				if (redirects >= 8) {
					reject(new Error("Too many redirects downloading the Parakeet model."));
					return;
				}
				try {
					void downloadVerifiedFile(
						new URL(response.headers.location, url).href,
						destination,
						file,
						onBytes,
						redirects + 1,
					).then(resolve, reject);
				} catch (error) {
					reject(error);
				}
				return;
			}
			if (status !== 200) {
				response.resume();
				reject(new Error(`Parakeet model download failed (HTTP ${status}).`));
				return;
			}
			let received = 0;
			const hash = createHash("sha256");
			const verify = new Transform({
				transform(chunk: Buffer, _encoding, callback) {
					received += chunk.length;
					if (received > file.size) {
						callback(
							new Error(`Parakeet model file ${file.name} is larger than expected.`),
						);
						return;
					}
					hash.update(chunk);
					onBytes(received);
					callback(null, chunk);
				},
			});
			void pipeline(response, verify, createWriteStream(destination, { flags: "wx" }))
				.then(() => {
					if (received !== file.size || hash.digest("hex") !== file.sha256) {
						throw new Error(
							`Parakeet model file ${file.name} failed its integrity check. Please try again.`,
						);
					}
				})
				.then(resolve, reject);
		});
		request.on("error", reject);
		request.on("timeout", () =>
			request.destroy(new Error("Parakeet model download timed out.")),
		);
	});
}

let activeDownload: Promise<string> | null = null;
let deleting = false;
const subscribers = new Set<WebContents>();
let lastProgress: Progress = { status: "idle", progress: 0, path: null };

function broadcast(payload: Progress) {
	lastProgress = payload;
	for (const subscriber of subscribers) {
		if (subscriber.isDestroyed()) subscribers.delete(subscriber);
		else sendParakeetModelDownloadProgress(subscriber, payload);
	}
}

export async function downloadParakeetModel(webContents: WebContents): Promise<string> {
	if (deleting)
		throw new Error("The Parakeet model is being deleted. Try downloading again shortly.");
	subscribers.add(webContents);
	if (activeDownload) {
		sendParakeetModelDownloadProgress(webContents, lastProgress);
		return activeDownload;
	}
	// Assign the promise before the first filesystem operation can finish, so callers
	// from multiple editor windows share one installation and receive its progress.
	activeDownload = (async () => {
		const directory = modelDirectory();
		let staging: string | undefined;
		try {
			const existing = await getParakeetModelStatus();
			if (existing.exists && existing.path) {
				broadcast({ status: "downloaded", progress: 100, path: existing.path });
				return existing.path;
			}
			await fs.mkdir(path.dirname(directory), { recursive: true });
			staging = await fs.mkdtemp(`${directory}.download-`);
			broadcast({ status: "downloading", progress: 0, path: null });
			let completedBytes = 0;
			for (const file of PARAKEET_MODEL_FILES) {
				await downloadVerifiedFile(
					`${MODEL_URL}/${file.name}`,
					path.join(staging, file.name),
					file,
					(bytes) => {
						const progress = Math.min(
							99,
							Math.floor(((completedBytes + bytes) / totalBytes) * 100),
						);
						if (progress !== lastProgress.progress)
							broadcast({ status: "downloading", progress, path: null });
					},
				);
				completedBytes += file.size;
			}
			await fs.writeFile(
				path.join(staging, READY_FILE),
				JSON.stringify({ revision: PARAKEET_MODEL_REVISION, verified: true }),
			);
			await assertParakeetModelDirectory(staging);
			// The final directory was invalid (or absent). No partially downloaded model
			// is ever visible at this path, including after an interrupted installation.
			await fs.rm(directory, { recursive: true, force: true });
			await fs.rename(staging, directory);
			staging = undefined;
			broadcast({ status: "downloaded", progress: 100, path: directory });
			return directory;
		} catch (error) {
			broadcast({
				status: "error",
				progress: 0,
				path: null,
				error: String(error),
			});
			throw error;
		} finally {
			if (staging)
				await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
		}
	})();
	try {
		return await activeDownload;
	} finally {
		activeDownload = null;
		subscribers.clear();
	}
}

export async function deleteParakeetModel(): Promise<void> {
	if (activeDownload)
		throw new Error("Wait for the Parakeet model download to finish before deleting it.");
	if (deleting) throw new Error("The Parakeet model is already being deleted.");
	deleting = true;
	try {
		await fs.rm(modelDirectory(), { recursive: true, force: true });
	} finally {
		deleting = false;
	}
}
