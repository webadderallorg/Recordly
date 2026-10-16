import { createWriteStream } from "node:fs";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type Electron from "electron";
import { net, session } from "electron";
import {
	WHISPER_MODEL_DIR,
	WHISPER_MODEL_DOWNLOAD_URL,
	WHISPER_SMALL_MODEL_PATH,
} from "../constants";

export function sendWhisperModelDownloadProgress(
	webContents: Electron.WebContents,
	payload: {
		status: "idle" | "downloading" | "downloaded" | "error";
		progress: number;
		path?: string | null;
		error?: string;
	},
) {
	webContents.send("whisper-small-model-download-progress", payload);
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

const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const PROXY_ENV_KEYS = [
	"HTTPS_PROXY",
	"https_proxy",
	"HTTP_PROXY",
	"http_proxy",
	"ALL_PROXY",
	"all_proxy",
];

type ProxyCredentials = { username: string; password: string };

function firstNonEmpty(values: Array<string | undefined>) {
	return values.map((value) => value?.trim()).find(Boolean);
}

/**
 * Reads the proxy the user configured through the usual environment variables.
 * Chromium proxy rules cannot carry a username and password, so credentials in
 * the proxy URL are split off and used to answer the proxy's login challenge.
 */
export function getProxyFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): { config: Electron.ProxyConfig; credentials: ProxyCredentials | null } | null {
	const proxy = firstNonEmpty(PROXY_ENV_KEYS.map((key) => env[key]));
	if (!proxy) {
		return null;
	}

	let proxyRules = proxy;
	let credentials: ProxyCredentials | null = null;
	if (proxy.includes("@")) {
		try {
			const proxyUrl = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
			if (proxyUrl.username) {
				credentials = {
					username: decodeURIComponent(proxyUrl.username),
					password: decodeURIComponent(proxyUrl.password),
				};
				proxyRules = `${proxyUrl.protocol}//${proxyUrl.host}`;
			}
		} catch {
			// Not a URL; pass it through unchanged and let Chromium reject it.
		}
	}

	const proxyBypassRules = firstNonEmpty([env.NO_PROXY, env.no_proxy]);
	return {
		config: proxyBypassRules ? { proxyRules, proxyBypassRules } : { proxyRules },
		credentials,
	};
}

// Electron's network stack follows the system proxy settings (unlike node:https).
// A proxy set through environment variables wins, as it does for curl and wget.
async function getDownloadSession(
	envProxy: ReturnType<typeof getProxyFromEnv>,
): Promise<Electron.Session> {
	if (!envProxy) {
		return session.defaultSession;
	}

	const downloadSession = session.fromPartition("recordly-downloads");
	await downloadSession.setProxy(envProxy.config);
	return downloadSession;
}

export async function downloadFileWithProgress(
	url: string,
	destinationPath: string,
	onProgress: (progress: number) => void,
): Promise<void> {
	const envProxy = getProxyFromEnv();
	const downloadSession = await getDownloadSession(envProxy);
	const proxyCredentials = envProxy?.credentials ?? null;

	await new Promise<void>((resolve, reject) => {
		// net.request (unlike session.fetch) emits "login" for proxy auth challenges.
		const request = net.request({ url, session: downloadSession });
		let response: Readable | null = null;
		let idleTimer: NodeJS.Timeout | undefined;
		let settled = false;

		const finish = (error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(idleTimer);
			if (error) {
				request.abort();
				response?.destroy();
				reject(error);
			} else {
				resolve();
			}
		};
		const resetIdleTimer = () => {
			clearTimeout(idleTimer);
			idleTimer = setTimeout(
				() => finish(new Error("Whisper model download timed out.")),
				DOWNLOAD_IDLE_TIMEOUT_MS,
			);
		};

		let sentProxyCredentials = false;
		request.on("login", (authInfo, callback) => {
			// Answer once: a repeated challenge means the credentials were rejected.
			if (authInfo.isProxy && proxyCredentials && !sentProxyCredentials) {
				sentProxyCredentials = true;
				callback(proxyCredentials.username, proxyCredentials.password);
			} else {
				callback();
			}
		});
		request.on("error", (error) => finish(error));
		request.on("response", (incoming) => {
			if (incoming.statusCode < 200 || incoming.statusCode >= 300) {
				finish(
					new Error(`Whisper model download failed with status ${incoming.statusCode}.`),
				);
				return;
			}

			// IncomingMessage is a Readable at runtime but is typed as an EventEmitter.
			response = incoming as unknown as Readable;
			const totalBytes = Number.parseInt(
				String(incoming.headers["content-length"] ?? "0"),
				10,
			);
			let downloadedBytes = 0;
			let lastProgress = -1;

			pipeline(
				response,
				async function* (chunks: AsyncIterable<Buffer>) {
					for await (const chunk of chunks) {
						resetIdleTimer();
						downloadedBytes += chunk.length;
						if (Number.isFinite(totalBytes) && totalBytes > 0) {
							const progress = Math.min(
								100,
								Math.round((downloadedBytes / totalBytes) * 100),
							);
							if (progress !== lastProgress) {
								lastProgress = progress;
								onProgress(progress);
							}
						}
						yield chunk;
					}
				},
				createWriteStream(destinationPath),
			).then(
				() => {
					if (lastProgress !== 100) {
						onProgress(100);
					}
					finish();
				},
				(error: Error) => finish(error),
			);
		});

		resetIdleTimer();
		request.end();
	});
}

export async function downloadWhisperSmallModel(
	webContents: Electron.WebContents,
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
