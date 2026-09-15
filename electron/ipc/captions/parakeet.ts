import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import type Electron from "electron";
import {
	PARAKEET_MODEL_DIR,
	PARAKEET_MODEL_DOWNLOAD_BASE_URL,
	PARAKEET_MODEL_FILE_METADATA,
	PARAKEET_MODEL_FILES,
	SHERPA_ONNX_RUNTIME_ASSETS,
	SHERPA_ONNX_RUNTIME_DIR,
} from "../constants";
import {
	getBundledSherpaOnnxExecutableCandidates,
	getNativeArchTag,
	resolveUnpackedAppPath,
} from "../paths/binaries";
import type {
	ParakeetModelDownloadProgress,
	ParakeetModelStatus,
	ParakeetRuntimeStatus,
} from "../types";
import { isExecutableFile } from "./generateUtils";

const execFileAsync = promisify(execFile);

export interface ResolvedParakeetModelPaths {
	encoderPath: string;
	decoderPath: string;
	joinerPath: string;
	tokensPath: string;
	modelDir: string;
}

export function sendParakeetModelDownloadProgress(
	webContents: Electron.WebContents,
	payload: ParakeetModelDownloadProgress,
) {
	webContents.send("parakeet-model-download-progress", payload);
}

export function sendParakeetRuntimeDownloadProgress(
	webContents: Electron.WebContents,
	payload: {
		status: "idle" | "downloading" | "downloaded" | "error";
		progress: number;
		path?: string | null;
		error?: string;
		currentFile?: string;
	},
) {
	webContents.send("parakeet-runtime-download-progress", payload);
}

let activeSherpaDownloadPromise: Promise<string> | null = null;

function getTarExecutablePath(): string {
	if (process.platform === "win32") {
		const system32Tar = path.join(
			process.env["SystemRoot"] || "C:\\Windows",
			"System32",
			"tar.exe",
		);
		if (existsSync(system32Tar)) {
			return system32Tar;
		}
	}
	return "tar";
}

export async function findExistingSherpaOnnxExecutable(
	preferredPath?: string | null,
): Promise<string | null> {
	const userHome = process.env["HOME"] || process.env["USERPROFILE"] || "";
	const candidatePaths = [
		preferredPath?.trim() || null,
		...getBundledSherpaOnnxExecutableCandidates(),
		process.env["SHERPA_ONNX_PATH"]?.trim() || null,
		process.platform === "darwin" ? "/opt/homebrew/bin/sherpa-onnx-offline" : null,
		process.platform === "darwin" ? "/usr/local/bin/sherpa-onnx-offline" : null,
		process.platform === "linux" ? "/usr/local/bin/sherpa-onnx-offline" : null,
		process.platform === "linux" ? "/usr/bin/sherpa-onnx-offline" : null,
		process.platform === "linux" ? "/opt/sherpa-onnx/bin/sherpa-onnx-offline" : null,
		userHome
			? path.join(
					userHome,
					".local",
					"bin",
					process.platform === "win32"
						? "sherpa-onnx-offline.exe"
						: "sherpa-onnx-offline",
				)
			: null,
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidatePaths) {
		const normalized = path.resolve(candidate);
		if (await isExecutableFile(normalized)) {
			return normalized;
		}
	}

	const pathCommand = process.platform === "win32" ? "where" : "which";
	const binaryNames =
		process.platform === "win32"
			? ["sherpa-onnx-offline.exe", "sherpa-onnx.exe"]
			: ["sherpa-onnx-offline", "sherpa-onnx"];

	for (const binaryName of binaryNames) {
		const result = spawnSync(pathCommand, [binaryName], { encoding: "utf-8" });
		if (result.status === 0) {
			const resolvedPath = result.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);

			if (resolvedPath && (await isExecutableFile(resolvedPath))) {
				return resolvedPath;
			}
		}
	}

	return null;
}

export async function getSherpaOnnxRuntimeStatus(
	preferredPath?: string | null,
): Promise<ParakeetRuntimeStatus> {
	try {
		const resolvedPath = await findExistingSherpaOnnxExecutable(preferredPath);
		if (resolvedPath) {
			return {
				success: true,
				exists: true,
				path: resolvedPath,
			};
		}
		return {
			success: true,
			exists: false,
			path: null,
			error: `No sherpa-onnx runtime found for ${process.platform}/${process.arch}.`,
		};
	} catch (error) {
		return {
			success: true,
			exists: false,
			path: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function ensureSherpaOnnxRuntimeBinary(
	onProgress?: (percent: number, statusText: string) => void,
): Promise<string> {
	const existing = await findExistingSherpaOnnxExecutable();
	if (existing) {
		return existing;
	}

	if (activeSherpaDownloadPromise) {
		return activeSherpaDownloadPromise;
	}

	activeSherpaDownloadPromise = (async () => {
		const archTag = getNativeArchTag();
		const asset = SHERPA_ONNX_RUNTIME_ASSETS[archTag];
		if (!asset) {
			throw new Error(
				`No precompiled sherpa-onnx runtime asset is configured for platform/arch "${archTag}". Please install sherpa-onnx manually or specify its path.`,
			);
		}

		onProgress?.(5, `Downloading sherpa-onnx runtime for ${archTag}...`);

		const tempDir = path.join(
			app.getPath("temp"),
			`recordly-sherpa-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		await fs.mkdir(tempDir, { recursive: true });

		const archivePath = path.join(tempDir, asset.archiveName);

		try {
			await downloadSingleFile(
				asset.url,
				archivePath,
				(bytesReceived) => {
					const estimatedTotal = asset.expectedSize || 26 * 1024 * 1024;
					const p = Math.min(60, Math.round((bytesReceived / estimatedTotal) * 60));
					onProgress?.(
						p,
						`Downloading sherpa-onnx runtime (${(bytesReceived / 1024 / 1024).toFixed(1)} MB)...`,
					);
				},
				{
					expectedSize: asset.expectedSize,
					expectedSha256: asset.expectedSha256,
				},
			);

			onProgress?.(65, "Extracting sherpa-onnx runtime archive...");

			const tarBin = getTarExecutablePath();
			await execFileAsync(tarBin, ["-xf", archivePath, "-C", tempDir], {
				timeout: 180_000,
			});

			onProgress?.(80, "Staging runtime libraries and binaries...");

			const entries = await fs.readdir(tempDir, { withFileTypes: true });
			const extractedDirEntry = entries.find(
				(e) => e.isDirectory() && e.name.startsWith("sherpa-onnx"),
			);
			const extractedRootDir = extractedDirEntry
				? path.join(tempDir, extractedDirEntry.name)
				: tempDir;

			// Target directories
			const userDataDir = app.getPath("userData");
			const userDataRuntimeDir = path.join(userDataDir, "runtime");
			const targetBinDir = path.join(SHERPA_ONNX_RUNTIME_DIR, "bin");
			const targetLibDir = path.join(SHERPA_ONNX_RUNTIME_DIR, "lib");
			const directRuntimeBinDir = path.join(userDataRuntimeDir, "bin");

			await fs.mkdir(SHERPA_ONNX_RUNTIME_DIR, { recursive: true });
			await fs.mkdir(targetBinDir, { recursive: true });
			await fs.mkdir(targetLibDir, { recursive: true });
			await fs.mkdir(userDataRuntimeDir, { recursive: true });
			await fs.mkdir(directRuntimeBinDir, { recursive: true });

			const extractedBinDir = path.join(extractedRootDir, "bin");
			const extractedLibDir = path.join(extractedRootDir, "lib");

			const hasBin = await fs
				.stat(extractedBinDir)
				.then(() => true)
				.catch(() => false);
			const hasLib = await fs
				.stat(extractedLibDir)
				.then(() => true)
				.catch(() => false);

			if (hasBin) {
				await fs.cp(extractedBinDir, targetBinDir, { recursive: true });
			}
			if (hasLib) {
				await fs.cp(extractedLibDir, targetLibDir, { recursive: true });
			}

			// For Windows, collect all DLLs and ensure they are placed next to the binary in all targets
			const dllFiles: Array<{ name: string; srcPath: string }> = [];
			if (process.platform === "win32") {
				if (hasLib) {
					const libEntries = await fs
						.readdir(extractedLibDir)
						.catch(() => [] as string[]);
					for (const file of libEntries) {
						if (file.toLowerCase().endsWith(".dll")) {
							dllFiles.push({
								name: file,
								srcPath: path.join(extractedLibDir, file),
							});
						}
					}
				}
				if (hasBin) {
					const binEntries = await fs
						.readdir(extractedBinDir)
						.catch(() => [] as string[]);
					for (const file of binEntries) {
						if (file.toLowerCase().endsWith(".dll")) {
							if (
								!dllFiles.some((d) => d.name.toLowerCase() === file.toLowerCase())
							) {
								dllFiles.push({
									name: file,
									srcPath: path.join(extractedBinDir, file),
								});
							}
						}
					}
				}

				// Copy DLLs to targetBinDir
				for (const dll of dllFiles) {
					await fs.copyFile(dll.srcPath, path.join(targetBinDir, dll.name));
				}
			}

			// Copy binary and DLLs directly into %APPDATA%/Recordly-dev/runtime/
			const primaryExeSrc = path.join(targetBinDir, asset.binaryName);
			await fs.copyFile(primaryExeSrc, path.join(userDataRuntimeDir, asset.binaryName));
			await fs.copyFile(primaryExeSrc, path.join(directRuntimeBinDir, asset.binaryName));

			if (process.platform === "win32") {
				for (const dll of dllFiles) {
					await fs.copyFile(dll.srcPath, path.join(userDataRuntimeDir, dll.name));
					await fs.copyFile(dll.srcPath, path.join(directRuntimeBinDir, dll.name));
				}
			}

			// In development checkout, stage directly into electron/native/bin targets
			const platformShort = process.platform === "win32" ? "win32" : process.platform;
			if (!app.isPackaged) {
				try {
					const devArchDir = resolveUnpackedAppPath("electron", "native", "bin", archTag);
					await fs.mkdir(devArchDir, { recursive: true });
					await fs.cp(targetBinDir, devArchDir, { recursive: true });

					const devPlatformDir = resolveUnpackedAppPath(
						"electron",
						"native",
						"bin",
						platformShort,
					);
					await fs.mkdir(devPlatformDir, { recursive: true });
					await fs.cp(targetBinDir, devPlatformDir, { recursive: true });

					const devPlatformArchDir = resolveUnpackedAppPath(
						"electron",
						"native",
						"bin",
						`${platformShort}-${process.arch}`,
					);
					await fs.mkdir(devPlatformArchDir, { recursive: true });
					await fs.cp(targetBinDir, devPlatformArchDir, { recursive: true });
				} catch (devCopyErr) {
					console.warn(
						"[sherpa-onnx] Could not stage runtime to development bin directory:",
						devCopyErr,
					);
				}
			}

			const finalExecutablePath = path.join(targetBinDir, asset.binaryName);

			// Permissions & security hygiene for POSIX
			if (process.platform !== "win32") {
				const stagedPathsToChmod = [
					finalExecutablePath,
					path.join(userDataRuntimeDir, asset.binaryName),
					path.join(directRuntimeBinDir, asset.binaryName),
				];
				for (const exePath of stagedPathsToChmod) {
					await fs.chmod(exePath, 0o755).catch(() => undefined);
				}

				if (hasLib) {
					const libEntries = await fs.readdir(targetLibDir).catch(() => [] as string[]);
					for (const file of libEntries) {
						await fs.chmod(path.join(targetLibDir, file), 0o755).catch(() => undefined);
					}
				}

				if (process.platform === "darwin") {
					await execFileAsync("xattr", ["-cr", SHERPA_ONNX_RUNTIME_DIR]).catch(
						() => undefined,
					);
					await execFileAsync("xattr", ["-cr", userDataRuntimeDir]).catch(
						() => undefined,
					);
				}
			}

			// Validate executable
			const isValid = await isExecutableFile(finalExecutablePath);
			if (!isValid) {
				throw new Error(
					`Downloaded sherpa-onnx binary at "${finalExecutablePath}" is not executable.`,
				);
			}

			// Sanity check execution on Windows
			if (process.platform === "win32") {
				const probe = spawnSync(finalExecutablePath, ["--version"], {
					encoding: "utf-8",
					timeout: 5000,
				});
				if (probe.error) {
					console.warn(
						"[sherpa-onnx] Sanity check test run notice:",
						probe.error.message,
					);
				}
			}

			onProgress?.(100, "sherpa-onnx runtime installed successfully.");
			return finalExecutablePath;
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
		}
	})().finally(() => {
		activeSherpaDownloadPromise = null;
	});

	return activeSherpaDownloadPromise;
}

/**
 * Given a directory or any model file path within a directory, resolve the 4
 * required Parakeet TDT ONNX model components: encoder, decoder, joiner, tokens.
 */
export async function resolveParakeetModelFiles(
	modelDirOrFilePath?: string | null,
): Promise<ResolvedParakeetModelPaths> {
	const targetPath = (modelDirOrFilePath?.trim() || PARAKEET_MODEL_DIR).trim();
	const stats = await fs.stat(targetPath).catch(() => null);
	if (!stats) {
		throw new Error(
			`Parakeet model path does not exist: "${targetPath}". Please download the model or select a valid folder.`,
		);
	}

	const modelDir = stats.isDirectory() ? targetPath : path.dirname(targetPath);
	const dirEntries = await fs.readdir(modelDir);

	const findMatch = (pattern: RegExp) => {
		const match = dirEntries.find((name) => pattern.test(name));
		return match ? path.join(modelDir, match) : null;
	};

	const encoderPath = findMatch(/^encoder.*\.onnx$/i) ?? findMatch(/encoder.*\.onnx$/i);
	const decoderPath = findMatch(/^decoder.*\.onnx$/i) ?? findMatch(/decoder.*\.onnx$/i);
	const joinerPath = findMatch(/^joiner.*\.onnx$/i) ?? findMatch(/joiner.*\.onnx$/i);
	const tokensPath = findMatch(/^tokens.*\.txt$/i) ?? findMatch(/tokens.*\.txt$/i);

	const missing: string[] = [];
	if (!encoderPath) missing.push("encoder.onnx / encoder.int8.onnx");
	if (!decoderPath) missing.push("decoder.onnx / decoder.int8.onnx");
	if (!joinerPath) missing.push("joiner.onnx / joiner.int8.onnx");
	if (!tokensPath) missing.push("tokens.txt");

	if (missing.length > 0) {
		throw new Error(
			`Incomplete Parakeet model in "${modelDir}". Missing: ${missing.join(", ")}.`,
		);
	}

	return {
		encoderPath: encoderPath!,
		decoderPath: decoderPath!,
		joinerPath: joinerPath!,
		tokensPath: tokensPath!,
		modelDir,
	};
}

export async function getParakeetModelStatus(): Promise<ParakeetModelStatus> {
	try {
		await resolveParakeetModelFiles(PARAKEET_MODEL_DIR);
		return {
			success: true,
			exists: true,
			path: PARAKEET_MODEL_DIR,
		};
	} catch (error) {
		return {
			success: true,
			exists: false,
			path: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

interface DownloadVerificationOptions {
	expectedSize?: number;
	expectedSha256?: string;
}

function downloadSingleFile(
	url: string,
	destinationPath: string,
	onByteChunk: (bytesReceived: number) => void,
	verification?: DownloadVerificationOptions,
): Promise<void> {
	const request = (currentUrl: string, redirectCount = 0): Promise<void> => {
		return new Promise((resolve, reject) => {
			const req = httpsGet(currentUrl, { timeout: 30_000 }, (response) => {
				const statusCode = response.statusCode ?? 0;
				const location = response.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					response.resume();
					if (redirectCount >= 5) {
						reject(
							new Error("Too many redirects while downloading Parakeet model file."),
						);
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
					reject(
						new Error(
							`Download failed with status ${statusCode} for ${path.basename(destinationPath)}`,
						),
					);
					return;
				}

				const contentLengthHeader = response.headers["content-length"];
				if (contentLengthHeader && verification?.expectedSize !== undefined) {
					const contentLength = Number.parseInt(contentLengthHeader, 10);
					if (
						Number.isFinite(contentLength) &&
						contentLength !== verification.expectedSize
					) {
						const mismatchError = new Error(
							`Content length header mismatch for ${path.basename(destinationPath)}: expected ${verification.expectedSize} bytes, got ${contentLength} bytes`,
						);
						response.destroy(mismatchError);
						void fs.rm(destinationPath, { force: true }).catch(() => undefined);
						reject(mismatchError);
						return;
					}
				}

				const hash = createHash("sha256");
				let downloadedBytes = 0;
				const fileStream = createWriteStream(destinationPath);

				const cleanupAndReject = async (err: Error) => {
					response.destroy(err);
					fileStream.destroy(err);
					await fs.rm(destinationPath, { force: true }).catch(() => undefined);
					reject(err);
				};

				response.on("data", (chunk: Buffer) => {
					downloadedBytes += chunk.length;
					hash.update(chunk);
					onByteChunk(downloadedBytes);
				});

				response.on("error", (error) => {
					void cleanupAndReject(error);
				});

				fileStream.on("error", (error) => {
					void cleanupAndReject(error);
				});

				fileStream.on("finish", () => {
					if (
						verification?.expectedSize !== undefined &&
						downloadedBytes !== verification.expectedSize
					) {
						void cleanupAndReject(
							new Error(
								`Downloaded size mismatch for ${path.basename(destinationPath)}: expected ${verification.expectedSize} bytes, received ${downloadedBytes} bytes`,
							),
						);
						return;
					}

					if (verification?.expectedSha256) {
						const actualDigest = hash.digest("hex").toLowerCase();
						const expectedDigest = verification.expectedSha256.toLowerCase();
						if (actualDigest !== expectedDigest) {
							void cleanupAndReject(
								new Error(
									`SHA-256 integrity check failed for ${path.basename(destinationPath)}: expected ${expectedDigest}, got ${actualDigest}`,
								),
							);
							return;
						}
					}

					resolve();
				});

				response.pipe(fileStream);
			});

			req.on("error", (err) => {
				void fs.rm(destinationPath, { force: true }).catch(() => undefined);
				reject(err);
			});
			req.on("timeout", () => {
				const timeoutErr = new Error(
					`Download timed out for ${path.basename(destinationPath)}`,
				);
				void fs.rm(destinationPath, { force: true }).catch(() => undefined);
				req.destroy(timeoutErr);
			});
		});
	};

	return request(url);
}

// Approximate expected file sizes for progress estimation before headers arrive:
// encoder: ~652MB, decoder: ~11.8MB, joiner: ~6.3MB, tokens: ~0.1MB (~670.2 MB total)
const ESTIMATED_TOTAL_BYTES = 670 * 1024 * 1024;

export async function downloadParakeetModel(webContents: Electron.WebContents): Promise<string> {
	const tempDownloadDir = path.join(PARAKEET_MODEL_DIR, ".download");
	await fs.mkdir(tempDownloadDir, { recursive: true });

	sendParakeetModelDownloadProgress(webContents, {
		status: "downloading",
		progress: 0,
		path: null,
	});

	let totalBytesDownloaded = 0;

	try {
		for (const fileName of PARAKEET_MODEL_FILES) {
			const fileUrl = `${PARAKEET_MODEL_DOWNLOAD_BASE_URL}/${fileName}`;
			const destPath = path.join(tempDownloadDir, fileName);
			const metadata = PARAKEET_MODEL_FILE_METADATA[fileName];
			const baseBytes = totalBytesDownloaded;
			let currentFileBytes = 0;

			sendParakeetModelDownloadProgress(webContents, {
				status: "downloading",
				progress: Math.min(
					99,
					Math.round((totalBytesDownloaded / ESTIMATED_TOTAL_BYTES) * 100),
				),
				currentFile: fileName,
				path: null,
			});

			await downloadSingleFile(
				fileUrl,
				destPath,
				(fileBytesDownloaded) => {
					currentFileBytes = fileBytesDownloaded;
					const currentTotal = baseBytes + fileBytesDownloaded;
					const percent = Math.min(
						99,
						Math.round((currentTotal / ESTIMATED_TOTAL_BYTES) * 100),
					);
					sendParakeetModelDownloadProgress(webContents, {
						status: "downloading",
						progress: percent,
						currentFile: fileName,
						path: null,
					});
				},
				metadata,
			);
			totalBytesDownloaded = baseBytes + currentFileBytes;
		}

		// Move downloaded files to final directory
		for (const fileName of PARAKEET_MODEL_FILES) {
			const tempFile = path.join(tempDownloadDir, fileName);
			const finalFile = path.join(PARAKEET_MODEL_DIR, fileName);
			await fs.rename(tempFile, finalFile);
		}

		// Ensure sherpa-onnx engine runtime binary is present
		const runtimeStatus = await getSherpaOnnxRuntimeStatus();
		if (!runtimeStatus.exists) {
			sendParakeetModelDownloadProgress(webContents, {
				status: "downloading",
				progress: 99,
				currentFile: "sherpa-onnx runtime engine",
				path: null,
			});
			await ensureSherpaOnnxRuntimeBinary();
		}

		await fs.rm(tempDownloadDir, { recursive: true, force: true }).catch(() => undefined);

		sendParakeetModelDownloadProgress(webContents, {
			status: "downloaded",
			progress: 100,
			path: PARAKEET_MODEL_DIR,
		});

		return PARAKEET_MODEL_DIR;
	} catch (error) {
		await fs.rm(tempDownloadDir, { recursive: true, force: true }).catch(() => undefined);
		sendParakeetModelDownloadProgress(webContents, {
			status: "error",
			progress: 0,
			path: null,
			error: String(error),
		});
		throw error;
	}
}

export async function deleteParakeetModel(): Promise<void> {
	await fs.rm(PARAKEET_MODEL_DIR, { recursive: true, force: true });
}
