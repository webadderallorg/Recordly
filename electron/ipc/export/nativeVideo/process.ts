import { spawn } from "node:child_process";
import os from "node:os";
import { powerSaveBlocker } from "electron";
import { progressiveShareFfmpegArgs } from "../../growingShareUpload";
import { type NativeVideoExportFinishOptions } from "../../nativeVideoExport";
import { createFfmpegMuxProgressHandler } from "./audioProgress";
import { execFileAsync, getNowMs, NATIVE_EXPORT_HIGH_PRIORITY } from "./constants";
import { type NativeStaticLayoutExportSession, type NativeVideoAudioMuxProgress } from "./types";

export function startNativeStaticLayoutExportPowerGuard() {
	try {
		const blockerId = powerSaveBlocker.start("prevent-app-suspension");
		return {
			started: true,
			release: () => {
				if (powerSaveBlocker.isStarted(blockerId)) {
					powerSaveBlocker.stop(blockerId);
				}
			},
		};
	} catch (error) {
		console.warn("[native-static-layout-export] Failed to start power guard", error);
		return {
			started: false,
			release: () => undefined,
		};
	}
}

export function setNativeStaticLayoutExportProcessPriority(pid: number | undefined, label: string) {
	if (!pid) {
		return false;
	}

	try {
		os.setPriority(pid, NATIVE_EXPORT_HIGH_PRIORITY);
		return true;
	} catch (error) {
		console.warn(`[native-static-layout-export] Failed to raise ${label} priority`, error);
		return false;
	}
}

export async function runFfmpegWithMetrics(
	ffmpegPath: string,
	args: string[],
	timeoutMs: number,
	session?: NativeStaticLayoutExportSession,
): Promise<{
	success: boolean;
	elapsedMs: number;
	stderr: string;
	code: number | null;
	signal: NodeJS.Signals | null;
}> {
	const startedAt = getNowMs();
	return await new Promise((resolve) => {
		const child = spawn(ffmpegPath, progressiveShareFfmpegArgs(args), {
			stdio: ["ignore", "ignore", "pipe"],
		});
		if (session) {
			session.currentProcess = child;
			if (session.terminating) {
				child.kill("SIGKILL");
			}
		}
		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			try {
				child.kill("SIGKILL");
			} catch {
				// ignore
			}
		}, timeoutMs);

		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			if (session?.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			resolve({
				success: false,
				elapsedMs: getNowMs() - startedAt,
				stderr: error instanceof Error ? error.message : String(error),
				code: null,
				signal: null,
			});
		});
		child.once("close", (code, signal) => {
			if (settled) return;
			settled = true;
			if (session?.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			resolve({
				success: code === 0,
				elapsedMs: getNowMs() - startedAt,
				stderr,
				code,
				signal,
			});
		});
	});
}

export async function runFfmpegAudioMux(
	ffmpegPath: string,
	args: string[],
	timeoutMs: number,
	options: NativeVideoExportFinishOptions,
	onProgress?: (progress: NativeVideoAudioMuxProgress) => void,
	session?: NativeStaticLayoutExportSession,
) {
	if (!onProgress && !session) {
		await execFileAsync(ffmpegPath, args, {
			timeout: timeoutMs,
			maxBuffer: 20 * 1024 * 1024,
		});
		return;
	}

	const handleProgressChunk = createFfmpegMuxProgressHandler(
		options.outputDurationSec,
		onProgress,
	);
	await new Promise<void>((resolve, reject) => {
		const child = spawn(ffmpegPath, progressiveShareFfmpegArgs(args), {
			stdio: ["ignore", "ignore", "pipe"],
		});
		if (session) {
			session.currentProcess = child;
			if (session.terminating) {
				child.kill("SIGKILL");
			}
		}

		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			child.kill("SIGKILL");
		}, timeoutMs);

		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderr += text;
			handleProgressChunk(text);
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			if (session?.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (code, signal) => {
			if (settled) return;
			settled = true;
			if (session?.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			if (session?.terminating) {
				reject(new Error("Native static layout export was cancelled"));
				return;
			}
			if (code !== 0) {
				const suffix = signal ? ` (signal ${signal})` : "";
				reject(
					new Error(
						`FFmpeg audio mux exited with code ${code ?? "unknown"}${suffix}` +
							(stderr.trim() ? `\nSTDERR:\n${stderr.trim()}` : ""),
					),
				);
				return;
			}
			if (onProgress) {
				const completeProgress: NativeVideoAudioMuxProgress = { ratio: 1 };
				if (
					typeof options.outputDurationSec === "number" &&
					Number.isFinite(options.outputDurationSec)
				) {
					completeProgress.processedSec = options.outputDurationSec;
					completeProgress.totalSec = options.outputDurationSec;
				}
				onProgress(completeProgress);
			}
			resolve();
		});
	});
}
