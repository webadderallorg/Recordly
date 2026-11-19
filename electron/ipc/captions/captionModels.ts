import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app, type WebContents } from "electron";
import {
	type CaptionModelDownloadProgress,
	type CaptionModelId,
	isCaptionModelId,
} from "../../../src/shared/captionModels";
import {
	deleteParakeetModel,
	downloadParakeetModel,
	getParakeetModelStatus,
} from "./parakeetModel";

export const WHISPER_MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";
export const WHISPER_CAPTION_FILES = {
	"whisper-base": {
		name: "ggml-base.bin",
		size: 147951465,
		sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
	},
	"whisper-small": {
		name: "ggml-small.bin",
		size: 487601967,
		sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
	},
} as const;
type WhisperId = keyof typeof WHISPER_CAPTION_FILES;
type VerifiedFile = { size: number; sha256: string };
const activeDownloads = new Map<WhisperId, Promise<string>>();
const deleting = new Set<WhisperId>();
const subscribers = new Map<WhisperId, Set<WebContents>>();
const latestProgress = new Map<WhisperId, CaptionModelDownloadProgress>();

function checkedId(id: unknown): CaptionModelId {
	if (!isCaptionModelId(id)) throw new Error("Unknown caption model.");
	return id;
}
function directory(id: WhisperId) {
	return path.join(app.getPath("userData"), "captions", id);
}
export function sendCaptionModelDownloadProgress(
	sender: WebContents,
	payload: CaptionModelDownloadProgress,
) {
	try {
		if (!sender.isDestroyed()) sender.send("caption-model-download-progress", payload);
	} catch {
		/* A closing window cannot interrupt the installation. */
	}
}
function broadcast(payload: CaptionModelDownloadProgress & { modelId: WhisperId }) {
	latestProgress.set(payload.modelId, payload);
	for (const sender of subscribers.get(payload.modelId) ?? []) {
		if (sender.isDestroyed()) subscribers.get(payload.modelId)?.delete(sender);
		else sendCaptionModelDownloadProgress(sender, payload);
	}
}

/** Downloads are pinned, checked during streaming, and never exposed until verified. */
export async function downloadVerifiedCaptionFile(
	url: string,
	destination: string,
	file: VerifiedFile,
	onBytes: (bytes: number) => void,
	redirects = 0,
): Promise<void> {
	if (new URL(url).protocol !== "https:")
		throw new Error("Caption model downloads require HTTPS.");
	await new Promise<void>((resolve, reject) => {
		const request = httpsGet(url, { timeout: 30_000 }, (response) => {
			const status = response.statusCode ?? 0;
			if (status >= 300 && status < 400 && response.headers.location) {
				response.resume();
				if (redirects >= 8) {
					reject(new Error("Too many redirects downloading caption model."));
					return;
				}
				try {
					void downloadVerifiedCaptionFile(
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
				reject(new Error(`Caption model download failed (HTTP ${status}).`));
				return;
			}
			let received = 0;
			const hash = createHash("sha256");
			const verify = new Transform({
				transform(chunk: Buffer, _encoding, callback) {
					received += chunk.length;
					if (received > file.size) {
						callback(new Error("Caption model file is larger than expected."));
						return;
					}
					hash.update(chunk);
					onBytes(received);
					callback(null, chunk);
				},
			});
			void pipeline(response, verify, createWriteStream(destination, { flags: "wx" }))
				.then(() => {
					if (received !== file.size || hash.digest("hex") !== file.sha256)
						throw new Error(
							"Caption model failed its integrity check. Please try again.",
						);
				})
				.then(resolve, reject);
		});
		request.on("error", reject);
		request.on("timeout", () =>
			request.destroy(new Error("Caption model download timed out.")),
		);
	});
}

async function installedWhisper(id: WhisperId) {
	const file = WHISPER_CAPTION_FILES[id];
	const target = directory(id);
	const marker = JSON.parse(await fs.readFile(path.join(target, "recordly-model.json"), "utf8"));
	if (
		marker.revision !== WHISPER_MODEL_REVISION ||
		marker.sha256 !== file.sha256 ||
		marker.verified !== true
	)
		throw new Error("Caption model is incomplete or outdated. Download it again.");
	const filePath = path.join(target, file.name);
	const stat = await fs.stat(filePath);
	if (!stat.isFile() || stat.size !== file.size)
		throw new Error("Caption model file is incomplete. Download it again.");
	return filePath;
}
export async function getCaptionModelStatus(value: unknown) {
	const id = checkedId(value);
	if (id === "parakeet-v3") return getParakeetModelStatus();
	try {
		return { success: true, exists: true, path: await installedWhisper(id) };
	} catch {
		return { success: true, exists: false, path: null };
	}
}
export async function resolveInstalledCaptionModel(value: unknown) {
	const id = checkedId(value);
	const status = await getCaptionModelStatus(id);
	if (!status.exists || !status.path)
		throw new Error("Download the selected caption model first.");
	return {
		id,
		engine: id === "parakeet-v3" ? ("parakeet" as const) : ("whisper" as const),
		path: status.path,
	};
}
export async function downloadCaptionModel(value: unknown, sender: WebContents): Promise<string> {
	const id = checkedId(value);
	if (id === "parakeet-v3") return downloadParakeetModel(sender);
	if (deleting.has(id)) throw new Error("The caption model is being deleted. Try again shortly.");
	const listeners = subscribers.get(id) ?? new Set<WebContents>();
	listeners.add(sender);
	subscribers.set(id, listeners);
	const existing = activeDownloads.get(id);
	if (existing) {
		const last = latestProgress.get(id);
		if (last) sendCaptionModelDownloadProgress(sender, last);
		return existing;
	}
	const download = (async () => {
		let staging: string | undefined;
		try {
			const status = await getCaptionModelStatus(id);
			if (status.exists && status.path) {
				broadcast({ modelId: id, status: "downloaded", progress: 100, path: status.path });
				return status.path;
			}
			const target = directory(id);
			const file = WHISPER_CAPTION_FILES[id];
			await fs.mkdir(path.dirname(target), { recursive: true });
			staging = await fs.mkdtemp(`${target}.download-`);
			broadcast({ modelId: id, status: "downloading", progress: 0, path: null });
			await downloadVerifiedCaptionFile(
				`https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REVISION}/${file.name}`,
				path.join(staging, file.name),
				file,
				(bytes) => {
					const progress = Math.min(99, Math.floor((bytes / file.size) * 100));
					if (progress !== latestProgress.get(id)?.progress)
						broadcast({ modelId: id, status: "downloading", progress, path: null });
				},
			);
			await fs.writeFile(
				path.join(staging, "recordly-model.json"),
				JSON.stringify({
					revision: WHISPER_MODEL_REVISION,
					sha256: file.sha256,
					verified: true,
				}),
			);
			await fs.rm(target, { recursive: true, force: true });
			await fs.rename(staging, target);
			staging = undefined;
			const installed = await installedWhisper(id);
			broadcast({ modelId: id, status: "downloaded", progress: 100, path: installed });
			return installed;
		} catch (error) {
			broadcast({
				modelId: id,
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
	activeDownloads.set(id, download);
	try {
		return await download;
	} finally {
		activeDownloads.delete(id);
		subscribers.delete(id);
	}
}
export async function deleteCaptionModel(value: unknown) {
	const id = checkedId(value);
	if (id === "parakeet-v3") return deleteParakeetModel();
	if (activeDownloads.has(id))
		throw new Error("Wait for the caption model download to finish before deleting it.");
	if (deleting.has(id)) throw new Error("The caption model is already being deleted.");
	deleting.add(id);
	try {
		await fs.rm(directory(id), { recursive: true, force: true });
	} finally {
		deleting.delete(id);
	}
}
