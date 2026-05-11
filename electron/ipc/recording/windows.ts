import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
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
import {
	AudioSyncAdjustment,
} from "../types";
import { emitRecordingInterrupted } from "./events";
import { moveFileWithOverwrite } from "../utils";

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

export function waitForWindowsCaptureStop(proc: ChildProcessWithoutNullStreams) {
	return new Promise<string>((resolve, reject) => {
		const onClose = (code: number | null) => {
			cleanup();
			const match = windowsCaptureOutputBuffer.match(/Recording stopped\. Output path: (.+)/);
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
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const cleanup = () => {
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

	console.log(
		`[PERF:MAIN] muxNativeWindowsVideoWithAudio: COMPLETED in ${Date.now() - start}ms`,
	);

	return {
		muxed: false,
		videoDurationSeconds: 0, // No longer needed here
		muxTimeoutMs: 0,
		audioInputs,
		audio,
		keptAudioSidecars: true,
	};
}
