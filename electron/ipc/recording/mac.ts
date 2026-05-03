import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { BrowserWindow } from "electron";
import {
	persistPendingCursorTelemetry,
	snapshotCursorTelemetryForPersistence,
} from "../cursor/telemetry";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { appendSyncedAudioFilter, getAudioSyncAdjustment } from "../ffmpeg/filters";
import {
	lastNativeCaptureDiagnostics,
	nativeCaptureMicrophonePath,
	nativeCaptureOutputBuffer,
	nativeCaptureStopRequested,
	nativeCaptureSystemAudioPath,
	nativeCaptureTargetPath,
	nativeScreenRecordingActive,
	selectedSource,
	setCurrentProjectPath,
	setCurrentVideoPath,
	setNativeCaptureMicrophonePath,
	setNativeCaptureProcess,
	setNativeCaptureStopRequested,
	setNativeCaptureSystemAudioPath,
	setNativeCaptureTargetPath,
	setNativeScreenRecordingActive,
} from "../state";
import type { AudioSyncAdjustment } from "../types";
import { isAutoRecordingPath, moveFileWithOverwrite } from "../utils";
import {
	getFileSizeIfPresent,
	getRecordingAudioMuxTimeoutMs,
	getUsableCompanionAudioCandidates,
	probeMediaDurationSeconds,
	recordNativeCaptureDiagnostics,
	validateRecordedVideo,
} from "./diagnostics";
import { emitRecordingInterrupted } from "./events";
import { pruneAutoRecordings } from "./prune";
import { muxNativeWindowsVideoWithAudio } from "./windows";

const execFileAsync = promisify(execFile);

export function waitForNativeCaptureStart(process: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for ScreenCaptureKit recorder to start"));
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
					nativeCaptureOutputBuffer.trim() ||
						`Native capture helper exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const cleanup = () => {
			clearTimeout(timer);
			process.stdout.off("data", onStdout);
			process.off("error", onError);
			process.off("exit", onExit);
		};

		process.stdout.on("data", onStdout);
		process.once("error", onError);
		process.once("exit", onExit);
	});
}

export function waitForNativeCaptureStop(process: ChildProcessWithoutNullStreams) {
	return new Promise<string>((resolve, reject) => {
		const onClose = (code: number | null) => {
			cleanup();
			const match = nativeCaptureOutputBuffer.match(/Recording stopped\. Output path: (.+)/);
			if (match?.[1]) {
				resolve(match[1].trim());
				return;
			}
			if (code === 0 && nativeCaptureTargetPath) {
				resolve(nativeCaptureTargetPath);
				return;
			}
			reject(
				new Error(
					nativeCaptureOutputBuffer.trim() ||
						`Native capture helper exited with code ${code ?? "unknown"}`,
				),
			);
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const cleanup = () => {
			process.off("close", onClose);
			process.off("error", onError);
		};

		process.once("close", onClose);
		process.once("error", onError);
	});
}

export async function muxNativeMacRecordingWithAudio(
	videoPath: string,
	systemAudioPath?: string | null,
	microphonePath?: string | null,
) {
	const ffmpegPath = getFfmpegBinaryPath();
	const mixedOutputPath = `${videoPath}.mixed.mp4`;

	const inputs = ["-i", videoPath];
	const availableAudioInputs: string[] = [];
	const audioFilePaths: string[] = [];

	for (const [label, audioPath] of [
		["system", systemAudioPath],
		["microphone", microphonePath],
	] as const) {
		if (!audioPath) continue;
		try {
			const stat = await fs.stat(audioPath);
			if (stat.size <= 0) {
				console.warn(`[mux] Skipping ${label} audio: file is empty (${audioPath})`);
				await fs.rm(audioPath, { force: true }).catch(() => undefined);
				continue;
			}
			inputs.push("-i", audioPath);
			availableAudioInputs.push(label);
			audioFilePaths.push(audioPath);
		} catch {
			console.warn(`[mux] Skipping ${label} audio: file not accessible (${audioPath})`);
		}
	}

	if (availableAudioInputs.length === 0) {
		console.warn(
			"[mux] No valid audio files to mux — video will have no audio. " +
				`system=${systemAudioPath ?? "none"} mic=${microphonePath ?? "none"}`,
		);
		return;
	}

	const videoDuration = await probeMediaDurationSeconds(videoPath);
	const muxTimeoutMs = getRecordingAudioMuxTimeoutMs(videoDuration);
	const audioAdjustments: Map<string, AudioSyncAdjustment> = new Map();

	if (videoDuration > 0) {
		for (let i = 0; i < audioFilePaths.length; i++) {
			const audioDuration = await probeMediaDurationSeconds(audioFilePaths[i]);
			const adjustment = getAudioSyncAdjustment(videoDuration, audioDuration);
			audioAdjustments.set(availableAudioInputs[i], adjustment);
			if (adjustment.mode === "tempo") {
				console.log(
					`[mux] ${availableAudioInputs[i]} audio differs from video by ${adjustment.durationDeltaMs}ms — applying tempo ratio ${adjustment.tempoRatio.toFixed(6)}`,
				);
			} else if (adjustment.mode === "delay" && adjustment.delayMs > 0) {
				console.log(
					`[mux] ${availableAudioInputs[i]} audio appears to start late by ${adjustment.delayMs}ms — adding leading silence`,
				);
			}
		}
	}

	const systemAdjustment = audioAdjustments.get("system") ?? {
		mode: "none",
		delayMs: 0,
		tempoRatio: 1,
		durationDeltaMs: 0,
	};
	const micAdjustment = audioAdjustments.get("microphone") ?? {
		mode: "none",
		delayMs: 0,
		tempoRatio: 1,
		durationDeltaMs: 0,
	};

	// Always route through the filter graph so that aresample=async=1 is
	// applied to every audio stream.  This corrects progressive clock drift
	// between the video and audio tracks that a simple duration comparison
	// cannot detect (e.g. audio gradually falling behind under CPU load).
	let args: string[];
	if (availableAudioInputs.length === 2) {
		const filterParts: string[] = [];
		appendSyncedAudioFilter(filterParts, "[1:a]", "s", systemAdjustment);
		appendSyncedAudioFilter(filterParts, "[2:a]", "m", micAdjustment);
		filterParts.push("[s][m]amix=inputs=2:duration=longest:normalize=0[aout]");
		args = [
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
		];
	} else {
		const singleAdjustment = audioAdjustments.get(availableAudioInputs[0]) ?? {
			mode: "none",
			delayMs: 0,
			tempoRatio: 1,
			durationDeltaMs: 0,
		};
		const filterParts: string[] = [];
		appendSyncedAudioFilter(filterParts, "[1:a]", "aout", singleAdjustment);
		args = [
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
		];
	}

	console.log("[mux] Running ffmpeg:", ffmpegPath, args.join(" "));

	try {
		await execFileAsync(ffmpegPath, args, {
			timeout: muxTimeoutMs,
			maxBuffer: 20 * 1024 * 1024,
		});
		await validateRecordedVideo(mixedOutputPath);
	} catch (error) {
		const execError = error as NodeJS.ErrnoException & { stderr?: string };
		console.error("[mux] failed:", execError.stderr || execError.message || String(error));
		await fs.rm(mixedOutputPath, { force: true }).catch(() => undefined);
		throw error;
	}

	await moveFileWithOverwrite(mixedOutputPath, videoPath);
	console.log("[mux] Successfully muxed audio into video:", videoPath);

	for (const audioPath of [systemAudioPath, microphonePath]) {
		if (audioPath) {
			await fs.rm(audioPath, { force: true }).catch(() => undefined);
		}
	}
}

export function attachNativeCaptureLifecycle(process: ChildProcessWithoutNullStreams) {
	process.once("close", () => {
		const wasActive = nativeScreenRecordingActive;
		setNativeCaptureProcess(null);

		if (!wasActive || nativeCaptureStopRequested) {
			return;
		}

		setNativeScreenRecordingActive(false);
		setNativeCaptureTargetPath(null);
		setNativeCaptureStopRequested(false);
		setNativeCaptureSystemAudioPath(null);
		setNativeCaptureMicrophonePath(null);

		const sourceName = selectedSource?.name ?? "Screen";
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording: false,
					sourceName,
				});
			}
		});

		const reason = nativeCaptureOutputBuffer.includes("WINDOW_UNAVAILABLE")
			? "window-unavailable"
			: "capture-stopped";
		const message =
			reason === "window-unavailable"
				? "The selected window is no longer capturable. Please reselect a window."
				: "Recording stopped unexpectedly.";

		emitRecordingInterrupted(reason, message);
	});
}

export async function finalizeStoredVideo(videoPath: string) {
	// Safety net: if companion audio files still exist, the mux was skipped — attempt it now
	if (videoPath.endsWith(".mp4")) {
		const companionCandidates = await getUsableCompanionAudioCandidates(videoPath);
		for (const { systemPath, micPath, platform } of companionCandidates) {
			if (platform === "mac" || platform === "win") {
				console.log(
					`[finalize] Detected un-muxed ${platform} audio files alongside video — attempting safety-net mux`,
				);
				try {
					if (platform === "win") {
						await muxNativeWindowsVideoWithAudio(videoPath, systemPath, micPath);
					} else {
						await muxNativeMacRecordingWithAudio(videoPath, systemPath, micPath);
					}
					console.log("[finalize] Safety-net mux completed successfully");
				} catch (error) {
					console.warn("[finalize] Safety-net mux failed:", error);
				}
				break;
			}
		}
	}

	let validation: { fileSizeBytes: number; durationSeconds: number | null };
	try {
		validation = await validateRecordedVideo(videoPath);
	} catch (error) {
		if (
			lastNativeCaptureDiagnostics?.backend === "mac-screencapturekit" ||
			lastNativeCaptureDiagnostics?.backend === "windows-wgc"
		) {
			recordNativeCaptureDiagnostics({
				backend: lastNativeCaptureDiagnostics.backend,
				phase: lastNativeCaptureDiagnostics.phase === "mux" ? "mux" : "stop",
				sourceId: lastNativeCaptureDiagnostics.sourceId ?? null,
				sourceType: lastNativeCaptureDiagnostics.sourceType ?? "unknown",
				displayId: lastNativeCaptureDiagnostics.displayId ?? null,
				displayBounds: lastNativeCaptureDiagnostics.displayBounds ?? null,
				windowHandle: lastNativeCaptureDiagnostics.windowHandle ?? null,
				helperPath: lastNativeCaptureDiagnostics.helperPath ?? null,
				outputPath: videoPath,
				systemAudioPath: lastNativeCaptureDiagnostics.systemAudioPath ?? null,
				microphonePath: lastNativeCaptureDiagnostics.microphonePath ?? null,
				osRelease: lastNativeCaptureDiagnostics.osRelease,
				supported: lastNativeCaptureDiagnostics.supported,
				helperExists: lastNativeCaptureDiagnostics.helperExists,
				processOutput: lastNativeCaptureDiagnostics.processOutput,
				fileSizeBytes: await getFileSizeIfPresent(videoPath),
				error: error instanceof Error ? error.message : String(error),
			});
		}
		throw error;
	}

	snapshotCursorTelemetryForPersistence();
	setCurrentVideoPath(videoPath);
	setCurrentProjectPath(null);
	await persistPendingCursorTelemetry(videoPath);
	if (isAutoRecordingPath(videoPath)) {
		await pruneAutoRecordings([videoPath]);
	}

	if (
		lastNativeCaptureDiagnostics?.backend === "mac-screencapturekit" ||
		lastNativeCaptureDiagnostics?.backend === "windows-wgc"
	) {
		recordNativeCaptureDiagnostics({
			backend: lastNativeCaptureDiagnostics.backend,
			phase: lastNativeCaptureDiagnostics.phase === "mux" ? "mux" : "stop",
			sourceId: lastNativeCaptureDiagnostics.sourceId ?? null,
			sourceType: lastNativeCaptureDiagnostics.sourceType ?? "unknown",
			displayId: lastNativeCaptureDiagnostics.displayId ?? null,
			displayBounds: lastNativeCaptureDiagnostics.displayBounds ?? null,
			windowHandle: lastNativeCaptureDiagnostics.windowHandle ?? null,
			helperPath: lastNativeCaptureDiagnostics.helperPath ?? null,
			outputPath: videoPath,
			systemAudioPath: lastNativeCaptureDiagnostics.systemAudioPath ?? null,
			microphonePath: lastNativeCaptureDiagnostics.microphonePath ?? null,
			osRelease: lastNativeCaptureDiagnostics.osRelease,
			supported: lastNativeCaptureDiagnostics.supported,
			helperExists: lastNativeCaptureDiagnostics.helperExists,
			processOutput: lastNativeCaptureDiagnostics.processOutput,
			fileSizeBytes: validation.fileSizeBytes,
		});
	}

	return {
		success: true,
		path: videoPath,
		message:
			validation.durationSeconds !== null
				? `Video stored successfully (${validation.fileSizeBytes} bytes, ${validation.durationSeconds.toFixed(2)}s)`
				: `Video stored successfully`,
	};
}

export async function recoverNativeMacCaptureOutput() {
	const macDiagnostics =
		lastNativeCaptureDiagnostics?.backend === "mac-screencapturekit"
			? lastNativeCaptureDiagnostics
			: null;
	const diagnosticsPath = macDiagnostics?.outputPath ?? null;
	const candidatePath = nativeCaptureTargetPath ?? diagnosticsPath;
	const systemAudioPath = nativeCaptureSystemAudioPath ?? macDiagnostics?.systemAudioPath ?? null;
	const microphonePath = nativeCaptureMicrophonePath ?? macDiagnostics?.microphonePath ?? null;

	if (!candidatePath) {
		return null;
	}

	try {
		if (systemAudioPath || microphonePath) {
			try {
				await muxNativeMacRecordingWithAudio(
					candidatePath,
					systemAudioPath,
					microphonePath,
				);
			} catch (muxError) {
				console.warn("Failed to mux audio during recovery:", muxError);
			}
		}

		return await finalizeStoredVideo(candidatePath);
	} catch (error) {
		recordNativeCaptureDiagnostics({
			backend: "mac-screencapturekit",
			phase: "stop",
			outputPath: candidatePath,
			systemAudioPath,
			microphonePath,
			processOutput: nativeCaptureOutputBuffer.trim() || undefined,
			fileSizeBytes: await getFileSizeIfPresent(candidatePath),
			error: String(error),
		});
		return null;
	}
}
