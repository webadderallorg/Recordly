import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow } from "electron";
import { getWindowsCaptureExePath } from "../paths/binaries";
import {
	selectedSource,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsNativeCaptureActive,
	windowsCaptureOutputBuffer,
	windowsCaptureStopRequested,
	windowsCaptureTargetPath,
	windowsNativeCaptureActive,
} from "../state";
import { AudioSyncAdjustment } from "../types";
import { moveFileWithOverwrite } from "../utils";
import { emitRecordingInterrupted } from "./events";

const WINDOWS_CAPTURE_STOP_TIMEOUT_MS = 45_000;
export const MIN_WINDOWS_CAPTURE_TEMP_FREE_BYTES = 512 * 1024 * 1024;

export type WindowsCaptureTempStatus = {
	directory: string;
	freeBytes: number | null;
};

function formatStorageSize(bytes: number) {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return "an unknown amount of space";
	}

	if (bytes >= 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}

	return `${Math.max(0, Math.round(bytes / (1024 * 1024)))} MB`;
}

export async function prepareWindowsCaptureTempDirectory(
	tempDirectory: string,
	minimumFreeBytes = MIN_WINDOWS_CAPTURE_TEMP_FREE_BYTES,
): Promise<WindowsCaptureTempStatus> {
	const directory = path.resolve(tempDirectory);
	let probePath: string | null = null;

	try {
		await fs.mkdir(directory, { recursive: true });
		probePath = path.join(directory, `.recordly-write-test-${process.pid}-${randomUUID()}.tmp`);
		await fs.writeFile(probePath, "Recordly temporary storage probe", { flag: "wx" });
	} catch (error) {
		throw new Error(
			`Recordly cannot write to its temporary folder (${directory}). Choose another storage location or check the folder permissions. ${String(error)}`,
		);
	} finally {
		if (probePath) {
			await fs.rm(probePath, { force: true }).catch(() => undefined);
		}
	}

	let freeBytes: number | null = null;
	try {
		const stats = await fs.statfs(directory);
		const reportedFreeBytes = Number(stats.bavail) * Number(stats.bsize);
		freeBytes = Number.isFinite(reportedFreeBytes) ? reportedFreeBytes : null;
	} catch {
		// Older Windows filesystems may not report capacity through statfs. The
		// successful write probe is still enough to safely attempt capture.
	}

	if (freeBytes !== null && freeBytes < minimumFreeBytes) {
		throw new Error(
			`Recordly needs at least ${formatStorageSize(minimumFreeBytes)} free in its temporary folder (${directory}), but only ${formatStorageSize(freeBytes)} is available. Free disk space or choose another storage location.`,
		);
	}

	return { directory, freeBytes };
}

export function describeWindowsCaptureStartFailure(
	error: unknown,
	processOutput: string,
	tempDirectory: string,
) {
	const outputLines = processOutput
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
	const helperError = [...outputLines]
		.reverse()
		.find((line) => line.startsWith("ERROR:") || line.startsWith("WARNING:"));
	const errorMessage = error instanceof Error ? error.message : String(error);
	const detail = helperError ?? errorMessage;

	if (/temporary folder|free disk space|folder permissions/iu.test(detail)) {
		return detail;
	}

	return `${detail} Temporary folder: ${path.resolve(tempDirectory)}. If this folder is on a full or restricted drive, choose another Recordly storage location.`;
}

export type NativeWindowsVideoPaddingResult = {
	padded: boolean;
	durationSeconds: number;
	containerDurationSeconds: number;
	targetDurationSeconds: number;
	padDurationSeconds: number;
};

export type NativeWindowsAudioMuxResult = {
	muxed: boolean;
	videoDurationSeconds: number;
	muxTimeoutMs: number;
	audioInputs: string[];
	audio: Record<
		string,
		{
			path: string;
			sizeBytes: number;
			durationSeconds: number;
			startDelayMs: number | null;
			adjustment: AudioSyncAdjustment;
		}
	>;
	outputPath?: string;
	keptAudioSidecars?: boolean;
};

export async function isNativeWindowsCaptureAvailable(): Promise<boolean> {
	if (process.platform !== "win32") return false;

	const os = await import("node:os");
	const [major, , build] = os.release().split(".").map(Number);
	const supported = major >= 10 && build >= 19041;
	if (!supported) return false;

	try {
		await fs.access(getWindowsCaptureExePath(), fsConstants.X_OK);
	} catch {
		return false;
	}

	return true;
}

export function waitForWindowsCaptureStart(proc: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for native Windows capture to start"));
		}, 12000);

		let stdoutBuffer = "";
		const onStdout = (chunk: Buffer) => {
			stdoutBuffer += chunk.toString();
			if (stdoutBuffer.includes("Recording started")) {
				cleanup();
				resolve();
			}
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					windowsCaptureOutputBuffer.trim() ||
						`Native Windows capture exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const cleanup = () => {
			clearTimeout(timer);
			proc.stdout.off("data", onStdout);
			proc.off("error", onError);
			proc.off("exit", onExit);
		};

		proc.stdout.on("data", onStdout);
		proc.once("error", onError);
		proc.once("exit", onExit);
	});
}

export function waitForWindowsCaptureStop(
	proc: ChildProcessWithoutNullStreams,
	timeoutMs = WINDOWS_CAPTURE_STOP_TIMEOUT_MS,
) {
	return new Promise<string>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};

		const timer = setTimeout(() => {
			finish(() => {
				try {
					if (!proc.killed) proc.kill();
				} catch {
					// The process may already be gone; the caller only needs the timeout error.
				}
				reject(new Error("Timed out waiting for native Windows capture to stop"));
			});
		}, timeoutMs);

		const onClose = (code: number | null) => {
			finish(() => {
				const match = windowsCaptureOutputBuffer.match(
					/Recording stopped\. Output path: (.+)/,
				);
				if (match?.[1]) {
					resolve(match[1].trim());
					return;
				}
				if (code === 0 && windowsCaptureTargetPath) {
					resolve(windowsCaptureTargetPath);
					return;
				}
				reject(
					new Error(
						windowsCaptureOutputBuffer.trim() ||
							`Native Windows capture exited with code ${code ?? "unknown"}`,
					),
				);
			});
		};

		const onError = (error: Error) => {
			finish(() => {
				reject(error);
			});
		};

		const cleanup = () => {
			clearTimeout(timer);
			proc.off("close", onClose);
			proc.off("error", onError);
		};

		proc.once("close", onClose);
		proc.once("error", onError);
	});
}

export function attachWindowsCaptureLifecycle(proc: ChildProcessWithoutNullStreams) {
	proc.once("close", () => {
		const wasActive = windowsNativeCaptureActive;
		setWindowsCaptureProcess(null);

		if (!wasActive || windowsCaptureStopRequested) {
			return;
		}

		setWindowsNativeCaptureActive(false);
		setWindowsCaptureStopRequested(false);

		const sourceName = selectedSource?.name ?? "Screen";
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording: false,
					sourceName,
				});
			}
		});

		emitRecordingInterrupted("capture-stopped", "Recording stopped unexpectedly.");
	});
}

export async function muxNativeWindowsVideoWithAudio(
	videoPath: string,
	systemAudioPath: string | null,
	micAudioPath: string | null,
): Promise<NativeWindowsAudioMuxResult> {
	const start = Date.now();
	console.log("[PERF:MAIN] muxNativeWindowsVideoWithAudio: STARTED");
	const audio: NativeWindowsAudioMuxResult["audio"] = {};
	const audioInputs: string[] = [];

	const videoPathWithoutExt = videoPath.replace(/\.[^.]+$/u, "");

	// Optimization: instead of heavy FFmpeg muxing, we just move the audio sidecars
	// to their final companion paths so the editor can find them as separate tracks.
	if (systemAudioPath) {
		const finalSystemPath = `${videoPathWithoutExt}.system.wav`;
		try {
			const stat = await fs.stat(systemAudioPath);
			if (stat.size > 0) {
				if (systemAudioPath !== finalSystemPath) {
					await moveFileWithOverwrite(systemAudioPath, finalSystemPath);
				}
				audioInputs.push("system");
				audio.system = {
					path: finalSystemPath,
					sizeBytes: stat.size,
					durationSeconds: 0,
					startDelayMs: null,
					adjustment: { mode: "none", delayMs: 0, tempoRatio: 1, durationDeltaMs: 0 },
				};
			}
		} catch (err) {
			console.error(`[mux-win] Failed to handle system audio:`, err);
		}
	}

	if (micAudioPath) {
		const finalMicPath = `${videoPathWithoutExt}.mic.wav`;
		try {
			const stat = await fs.stat(micAudioPath);
			if (stat.size > 0) {
				if (micAudioPath !== finalMicPath) {
					await moveFileWithOverwrite(micAudioPath, finalMicPath);
				}
				audioInputs.push("mic");
				audio.mic = {
					path: finalMicPath,
					sizeBytes: stat.size,
					durationSeconds: 0,
					startDelayMs: null,
					adjustment: { mode: "none", delayMs: 0, tempoRatio: 1, durationDeltaMs: 0 },
				};
			}
		} catch (err) {
			console.error(`[mux-win] Failed to handle mic audio:`, err);
		}
	}

	console.log(`[PERF:MAIN] muxNativeWindowsVideoWithAudio: COMPLETED in ${Date.now() - start}ms`);

	return {
		muxed: false,
		videoDurationSeconds: 0, // No longer needed here
		muxTimeoutMs: 0,
		audioInputs,
		audio,
		keptAudioSidecars: true,
	};
}
