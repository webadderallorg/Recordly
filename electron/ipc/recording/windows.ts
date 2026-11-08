import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { BrowserWindow } from "electron";
import { getWindowsCaptureExePath } from "../paths/binaries";
import {
	selectedSource,
	setNativeScreenRecordingActive,
	setWindowsCapturePaused,
	setWindowsCaptureTargetPath,
	setWindowsCaptureTempPath,
	windowsCaptureTempPath,
	setWindowsPendingVideoPath,
	windowsSystemAudioPath,
	windowsMicAudioPath,
	windowsCaptureProcess,
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
import { parseNativeCaptureInterruption } from "./interruption";
import { validateRecordedVideo } from "./diagnostics";
import { attachNativeCaptureStdinLifecycle } from "./nativeCaptureCommand";

const WINDOWS_CAPTURE_STOP_TIMEOUT_MS = 45_000;

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
	const stdinState = attachNativeCaptureStdinLifecycle(proc);
	return new Promise<string>((resolve, reject) => {
		if (stdinState.error) {
			reject(stdinState.error);
			return;
		}
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
					/(?:^|\n)Recording (?:stopped|interrupted)\. Output path: ([^\r\n]+)/,
				);
				if (match?.[1]) {
					resolve(match[1].trim());
					return;
				}
				const capturedPath = windowsCaptureTempPath || windowsCaptureTargetPath;
				if (code === 0 && capturedPath) {
					resolve(capturedPath);
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
			proc.stdin.off("error", onError);
			proc.off("error", onError);
		};

		proc.once("close", onClose);
		proc.stdin.once("error", onError);
		proc.once("error", onError);
	});
}

export function attachWindowsCaptureLifecycle(
	proc: ChildProcessWithoutNullStreams,
	onInterrupted?: () => void,
) {
	attachNativeCaptureStdinLifecycle(proc);
	proc.once("close", () => {
		if (windowsCaptureProcess && windowsCaptureProcess !== proc) return;
		const wasActive = windowsNativeCaptureActive;
		setWindowsCaptureProcess(null);

		if (!wasActive || windowsCaptureStopRequested) {
			return;
		}

		setWindowsNativeCaptureActive(false);
		setWindowsCaptureStopRequested(false);
		// Reserve recovery before captureExited releases the recording owner.
		onInterrupted?.();

		const sourceName = selectedSource?.name ?? "Screen";
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording: false,
					sourceName,
				});
			}
		});

		emitRecordingInterrupted(
			"capture-stopped",
			parseNativeCaptureInterruption(windowsCaptureOutputBuffer) ||
				"Recording stopped unexpectedly.",
		);
	});
}

/** Recover only a closed helper's finalized output; never read an active MP4. */
export async function recoverNativeWindowsCaptureOutput() {
	if (windowsNativeCaptureActive || windowsCaptureProcess) return null;
	const match = windowsCaptureOutputBuffer.match(
		/(?:^|\n)Recording (?:stopped|interrupted)\. Output path: ([^\r\n]+)/,
	);
	const capturedPath = match?.[1]?.trim() || windowsCaptureTempPath;
	if (!capturedPath) return null;
	const targetPath = windowsCaptureTargetPath;
	const tempPath = windowsCaptureTempPath;
	const output = windowsCaptureOutputBuffer;
	const systemAudioPath = windowsSystemAudioPath;
	const micAudioPath = windowsMicAudioPath;
	const finalPath = targetPath ?? capturedPath;
	const isCurrent = () =>
		!windowsNativeCaptureActive &&
		!windowsCaptureProcess &&
		windowsCaptureTargetPath === targetPath &&
		windowsCaptureTempPath === tempPath &&
		windowsCaptureOutputBuffer === output &&
		windowsSystemAudioPath === systemAudioPath &&
		windowsMicAudioPath === micAudioPath;
	try {
		// Validate before publishing it into the recording library. Failed encoder
		// finalization remains on disk for manual recovery, never a false success.
		await validateRecordedVideo(capturedPath);
		if (!isCurrent()) return null;
		for (const [kind, destination] of [
			["system", systemAudioPath],
			["mic", micAudioPath],
		] as const) {
			if (!destination) continue;
			const source = capturedPath.replace(/\.mp4$/i, `.${kind}.wav`);
			for (const suffix of ["", ".json"]) {
				if (source === destination) continue;
				try {
					await fs.access(source + suffix);
				} catch {
					continue;
				}
				if (!isCurrent()) return null;
				await moveFileWithOverwrite(source + suffix, destination + suffix);
			}
		}
		if (!isCurrent()) return null;
		if (capturedPath !== finalPath) await moveFileWithOverwrite(capturedPath, finalPath);
		if (!isCurrent()) return null;
		setNativeScreenRecordingActive(false);
		setWindowsCapturePaused(false);
		setWindowsPendingVideoPath(finalPath);
		setWindowsCaptureTargetPath(null);
		setWindowsCaptureTempPath(null);
		const interruption = parseNativeCaptureInterruption(output);
		return {
			success: true,
			path: finalPath,
			...(interruption
				? {
						error: `Recording interrupted: ${interruption}. A partial recording was saved.`,
					}
				: {}),
		};
	} catch (error) {
		console.warn("Failed to recover interrupted native Windows recording:", error);
		return null;
	}
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
