import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { BrowserWindow } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import {
	appendSyncedAudioFilter,
	applyRecordedAudioStartDelay,
	getAudioSyncAdjustment,
} from "../ffmpeg/filters";
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
import type { AudioSyncAdjustment } from "../types";
import { moveFileWithOverwrite } from "../utils";
import {
	getCompanionAudioStartDelayMs,
	getRecordingAudioMuxTimeoutMs,
	probeMediaDurationSeconds,
	validateRecordedVideo,
} from "./diagnostics";
import { emitRecordingInterrupted } from "./events";

const execFileAsync = promisify(execFile);
// Repair rare clipped mic peaks before loudness normalization so headset/driver
// overloads do not get amplified into audible pops during mux/export.
const WINDOWS_NATIVE_MIC_PRE_FILTERS = ["adeclip=threshold=1", "loudnorm=I=-16:TP=-1.5:LRA=11"];
const MIN_NATIVE_WINDOWS_VIDEO_PAD_MS = 500;

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

export async function extendNativeWindowsVideoToDuration(
	videoPath: string,
	targetDurationMs: number | null | undefined,
) {
	if (!Number.isFinite(targetDurationMs) || (targetDurationMs ?? 0) <= 0) {
		return { padded: false, durationSeconds: 0 };
	}

	const currentDurationSeconds = await probeMediaDurationSeconds(videoPath);
	if (currentDurationSeconds <= 0) {
		return { padded: false, durationSeconds: currentDurationSeconds };
	}

	const targetDurationSeconds = (targetDurationMs ?? 0) / 1000;
	const padDurationSeconds = targetDurationSeconds - currentDurationSeconds;
	if (padDurationSeconds * 1000 < MIN_NATIVE_WINDOWS_VIDEO_PAD_MS) {
		return { padded: false, durationSeconds: currentDurationSeconds };
	}

	const ffmpegPath = getFfmpegBinaryPath();
	const paddedOutputPath = `${videoPath}.duration-padded.mp4`;

	try {
		await execFileAsync(
			ffmpegPath,
			[
				"-y",
				"-hide_banner",
				"-nostdin",
				"-nostats",
				"-i",
				videoPath,
				"-vf",
				`tpad=stop_mode=clone:stop_duration=${padDurationSeconds.toFixed(3)}`,
				"-an",
				"-c:v",
				"libx264",
				"-preset",
				"veryfast",
				"-crf",
				"18",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"+faststart",
				paddedOutputPath,
			],
			{ timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
		);
		await validateRecordedVideo(paddedOutputPath);
		await moveFileWithOverwrite(paddedOutputPath, videoPath);
		return { padded: true, durationSeconds: targetDurationSeconds };
	} catch (error) {
		await fs.rm(paddedOutputPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

export async function muxNativeWindowsVideoWithAudio(
	videoPath: string,
	systemAudioPath: string | null,
	micAudioPath: string | null,
) {
	const ffmpegPath = getFfmpegBinaryPath();
	const inputs: string[] = ["-i", videoPath];
	const audioInputs: string[] = [];
	const audioFilePaths: string[] = [];

	for (const [label, audioPath] of [
		["system", systemAudioPath],
		["mic", micAudioPath],
	] as const) {
		if (!audioPath) continue;
		try {
			const stat = await fs.stat(audioPath);
			if (stat.size <= 0) {
				console.warn(`[mux-win] Skipping ${label} audio: file is empty (${audioPath})`);
				await fs.rm(audioPath, { force: true }).catch(() => undefined);
				continue;
			}
			inputs.push("-i", audioPath);
			audioInputs.push(label);
			audioFilePaths.push(audioPath);
		} catch {
			console.warn(`[mux-win] Skipping ${label} audio: file not accessible (${audioPath})`);
		}
	}

	if (audioInputs.length === 0) return;

	const videoDuration = await probeMediaDurationSeconds(videoPath);
	const muxTimeoutMs = getRecordingAudioMuxTimeoutMs(videoDuration);
	const audioAdjustments: Map<string, AudioSyncAdjustment> = new Map();

	if (videoDuration > 0) {
		for (let i = 0; i < audioFilePaths.length; i++) {
			const audioDuration = await probeMediaDurationSeconds(audioFilePaths[i]);
			const recordedStartDelayMs = await getCompanionAudioStartDelayMs(audioFilePaths[i]);
			const adjustment = applyRecordedAudioStartDelay(
				getAudioSyncAdjustment(videoDuration, audioDuration),
				recordedStartDelayMs,
			);
			audioAdjustments.set(audioInputs[i], adjustment);
			if (Number.isFinite(recordedStartDelayMs) && adjustment.mode === "delay") {
				console.log(
					`[mux-win] ${audioInputs[i]} audio recorded a start delay of ${adjustment.delayMs}ms`,
				);
			} else if (Number.isFinite(recordedStartDelayMs) && adjustment.mode === "pad") {
				console.log(
					`[mux-win] ${audioInputs[i]} audio started on time but ends ${adjustment.durationDeltaMs}ms early — padding trailing silence`,
				);
			} else if (adjustment.mode === "tempo") {
				console.log(
					`[mux-win] ${audioInputs[i]} audio differs from video by ${adjustment.durationDeltaMs}ms — applying tempo ratio ${adjustment.tempoRatio.toFixed(6)}`,
				);
			} else if (adjustment.mode === "delay" && adjustment.delayMs > 0) {
				console.log(
					`[mux-win] ${audioInputs[i]} audio appears to start late by ${adjustment.delayMs}ms — adding leading silence`,
				);
			} else if (adjustment.mode === "pad" && adjustment.durationDeltaMs > 0) {
				console.log(
					`[mux-win] ${audioInputs[i]} audio is much shorter than video by ${adjustment.durationDeltaMs}ms — padding trailing silence`,
				);
			}
		}
	}

	const mixedOutputPath = `${videoPath}.muxed.mp4`;
	const systemAdjustment = audioAdjustments.get("system") ?? {
		mode: "none",
		delayMs: 0,
		tempoRatio: 1,
		durationDeltaMs: 0,
	};
	const micAdjustment = audioAdjustments.get("mic") ?? {
		mode: "none",
		delayMs: 0,
		tempoRatio: 1,
		durationDeltaMs: 0,
	};

	try {
		if (audioInputs.length === 2) {
			const filterParts: string[] = [];
			appendSyncedAudioFilter(filterParts, "[1:a]", "s", systemAdjustment);
			appendSyncedAudioFilter(filterParts, "[2:a]", "m", micAdjustment, {
				preFilters: WINDOWS_NATIVE_MIC_PRE_FILTERS,
			});
			filterParts.push("[s][m]amix=inputs=2:duration=longest:normalize=0[aout]");

			await execFileAsync(
				ffmpegPath,
				[
					"-y",
					"-hide_banner",
					"-nostdin",
					"-nostats",
					...inputs,
					"-filter_complex",
					filterParts.join(";"),
					"-map",
					"0:v:0",
					"-map",
					"[aout]",
					"-c:v",
					"copy",
					"-c:a",
					"aac",
					"-b:a",
					"192k",
					"-shortest",
					mixedOutputPath,
				],
				{ timeout: muxTimeoutMs, maxBuffer: 20 * 1024 * 1024 },
			);
		} else {
			const singleAdjustment = audioAdjustments.get(audioInputs[0]) ?? {
				mode: "none",
				delayMs: 0,
				tempoRatio: 1,
				durationDeltaMs: 0,
			};

			const filterParts: string[] = [];
			// Always route through the filter graph so that aresample=async=1 is
			// applied.  This corrects progressive clock drift between video and
			// audio tracks that a simple duration comparison cannot detect.
			appendSyncedAudioFilter(
				filterParts,
				"[1:a]",
				"aout",
				singleAdjustment,
				audioInputs[0] === "mic" ? { preFilters: WINDOWS_NATIVE_MIC_PRE_FILTERS } : 1,
			);

			await execFileAsync(
				ffmpegPath,
				[
					"-y",
					"-hide_banner",
					"-nostdin",
					"-nostats",
					...inputs,
					"-filter_complex",
					filterParts.join(";"),
					"-map",
					"0:v:0",
					"-map",
					"[aout]",
					"-c:v",
					"copy",
					"-c:a",
					"aac",
					"-b:a",
					"192k",
					"-shortest",
					mixedOutputPath,
				],
				{ timeout: muxTimeoutMs, maxBuffer: 20 * 1024 * 1024 },
			);
		}

		await validateRecordedVideo(mixedOutputPath);
		await moveFileWithOverwrite(mixedOutputPath, videoPath);
	} catch (error) {
		await fs.rm(mixedOutputPath, { force: true }).catch(() => undefined);
		throw error;
	}

	for (const audioPath of [systemAudioPath, micAudioPath]) {
		if (audioPath) {
			await Promise.all([
				fs.rm(audioPath, { force: true }).catch(() => undefined),
				fs.rm(`${audioPath}.json`, { force: true }).catch(() => undefined),
			]);
		}
	}
}
