import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getLinuxPortalCaptureBinaryPath } from "../paths/binaries";
import { rememberApprovedLocalReadPath } from "../project/manager";
import { isLikelyLinuxWaylandSession } from "../register/sourceMapping";
import { setCurrentProjectPath, setCurrentVideoPath } from "../state";
import { getRecordingsDir } from "../utils";
import {
	getFileSizeIfPresent,
	recordNativeCaptureDiagnostics,
	validateRecordedVideo,
} from "./diagnostics";
import { discardRecordingFiles } from "./discardFiles";
import { attachNativeCaptureStdinLifecycle } from "./nativeCaptureCommand";

export type LinuxPortalProbeResult = {
	available: boolean;
	cursorModes?: number;
	message?: string;
};

const START_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 30_000;
const MAX_BUFFERED_OUTPUT_CHARS = 16_384;

let captureProcess: ChildProcessWithoutNullStreams | null = null;
let captureVideoPath: string | null = null;
let captureBinaryPath: string | null = null;
let captureSystemAudioPath: string | null = null;
let captureOutput = "";
let captureError = "";
let capturePaused = false;
let captureStopRequested = false;
let captureVideoStarted = false;

function appendBounded(current: string, chunk: string): string {
	const combined = current + chunk;
	return combined.length <= MAX_BUFFERED_OUTPUT_CHARS
		? combined
		: combined.slice(-MAX_BUFFERED_OUTPUT_CHARS);
}

function resetCaptureState(): void {
	captureProcess = null;
	captureVideoPath = null;
	captureBinaryPath = null;
	captureSystemAudioPath = null;
	capturePaused = false;
	captureStopRequested = false;
	captureVideoStarted = false;
}

export function isLinuxPortalCaptureEnabled(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): boolean {
	return (
		platform === "linux" &&
		isLikelyLinuxWaylandSession(env) &&
		env.RECORDLY_LINUX_PORTAL_CURSOR !== "0"
	);
}

export function isLinuxPortalCaptureActive(): boolean {
	return captureProcess !== null;
}

export function parsePortalProbeOutput(
	stdout: string,
	code: number | null,
	stderr?: string,
): LinuxPortalProbeResult {
	const match = stdout.match(/CAPABILITY:cursor-modes=(\d+)\s+metadata=(\d)/);
	const cursorModes = match ? Number(match[1]) : undefined;
	return {
		available: code === 0 && match?.[2] === "1",
		cursorModes,
		message: stderr?.trim() || undefined,
	};
}

export function killLinuxPortalCaptureProcess(): void {
	const child = captureProcess;
	captureStopRequested = true;
	resetCaptureState();
	if (child) {
		try {
			child.kill("SIGINT");
		} catch {
			// ignore
		}
	}
}

function sendPortalCommand(
	child: ChildProcessWithoutNullStreams,
	command: "pause\n" | "resume\n",
	expectedMarker: "PAUSED" | "RESUMED",
): Promise<void> {
	const stdinState = attachNativeCaptureStdinLifecycle(child);
	return new Promise<void>((resolve, reject) => {
		if (
			stdinState.error ||
			child.exitCode !== null ||
			child.signalCode !== null ||
			child.stdin.destroyed ||
			child.stdin.writableEnded ||
			child.stdin.writable === false
		) {
			reject(
				stdinState.error ?? new Error("Linux portal capture helper command pipe is closed"),
			);
			return;
		}

		let settled = false;
		let written = false;
		let acknowledged = false;
		let stdoutBuffer = "";
		const markerPattern = new RegExp(`^${expectedMarker}\\r?$`, "m");

		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.stdout.off("data", onStdout);
			child.stdin.off("error", onError);
			child.off("error", onError);
			child.off("close", onClose);
			if (error) reject(error);
			else resolve();
		};

		const maybeComplete = () => {
			if (written && acknowledged) {
				finish();
			}
		};

		const onStdout = (chunk: Buffer) => {
			stdoutBuffer = appendBounded(stdoutBuffer, chunk.toString());
			if (markerPattern.test(stdoutBuffer)) {
				acknowledged = true;
				maybeComplete();
			}
		};

		const onError = (error: Error) => finish(error);
		const onClose = (code: number | null) =>
			finish(
				new Error(
					`Linux portal capture helper exited before ${expectedMarker} (code ${code ?? "unknown"})`,
				),
			);

		const timer = setTimeout(() => {
			finish(
				new Error(`Timed out waiting for Linux portal capture helper: ${expectedMarker}`),
			);
		}, COMMAND_TIMEOUT_MS);
		timer.unref?.();

		child.stdout.on("data", onStdout);
		child.stdin.once("error", onError);
		child.once("error", onError);
		child.once("close", onClose);

		try {
			child.stdin.write(command, (error?: Error | null) => {
				if (error) {
					stdinState.error ??= error;
					onError(error);
					return;
				}
				written = true;
				maybeComplete();
			});
		} catch (error) {
			onError(error instanceof Error ? error : new Error(String(error)));
		}
	});
}

export async function pauseLinuxPortalCapture(): Promise<{
	success: boolean;
	message?: string;
	error?: string;
}> {
	if (!captureProcess) {
		return { success: false, message: "No Linux portal capture is active." };
	}
	if (capturePaused) {
		return { success: true };
	}
	try {
		await sendPortalCommand(captureProcess, "pause\n", "PAUSED");
		capturePaused = true;
		return { success: true };
	} catch (error) {
		return {
			success: false,
			message: "Failed to pause Linux portal capture",
			error: String(error),
		};
	}
}

export async function resumeLinuxPortalCapture(): Promise<{
	success: boolean;
	message?: string;
	error?: string;
}> {
	if (!captureProcess) {
		return { success: false, message: "No Linux portal capture is active." };
	}
	if (!capturePaused) {
		return { success: true };
	}
	try {
		await sendPortalCommand(captureProcess, "resume\n", "RESUMED");
		capturePaused = false;
		return { success: true };
	} catch (error) {
		return {
			success: false,
			message: "Failed to resume Linux portal capture",
			error: String(error),
		};
	}
}

export async function probeLinuxPortalCapture(): Promise<LinuxPortalProbeResult> {
	if (!isLinuxPortalCaptureEnabled()) {
		return { available: false };
	}
	const binary = getLinuxPortalCaptureBinaryPath();
	try {
		await fs.access(binary, fsConstants.X_OK);
	} catch {
		return { available: false, message: "Portal cursor helper binary is missing." };
	}

	return await new Promise<LinuxPortalProbeResult>((resolve) => {
		const child = spawn(binary, ["--probe"], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (result: LinuxPortalProbeResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};

		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// ignore
			}
			finish({ available: false, message: "Timed out probing the portal cursor helper." });
		}, PROBE_TIMEOUT_MS);
		timer.unref?.();

		child.stdout.on("data", (chunk: Buffer) => {
			stdout = appendBounded(stdout, chunk.toString());
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = appendBounded(stderr, chunk.toString());
		});
		child.once("error", (error) => {
			finish({ available: false, message: String(error) });
		});
		child.once("close", (code) => {
			finish(parsePortalProbeOutput(stdout, code, stderr));
		});
	});
}

export async function startLinuxPortalCapture(options: {
	systemAudio: boolean;
	onUnexpectedExit?: () => void;
	trackProcess?: (child: ChildProcessWithoutNullStreams) => void;
}): Promise<string> {
	if (!isLinuxPortalCaptureEnabled()) {
		throw new Error("Linux portal capture is not enabled.");
	}
	if (captureProcess) {
		throw new Error("A Linux portal capture is already active.");
	}
	const binary = getLinuxPortalCaptureBinaryPath();
	await fs.access(binary, fsConstants.X_OK);

	const recordingsDir = await getRecordingsDir();
	await fs.mkdir(recordingsDir, { recursive: true });
	const timestamp = Date.now();
	const outputPath = path.join(recordingsDir, `recording-${timestamp}.webm`);
	const systemAudioPath = options.systemAudio
		? path.join(recordingsDir, `recording-${timestamp}.system.wav`)
		: null;

	const child = spawn(
		binary,
		[
			"--record-video",
			outputPath,
			"--output",
			`${outputPath}.cursor.json`,
			"--start-epoch-ms",
			String(timestamp),
			...(options.systemAudio ? ["--system-audio"] : []),
			...(process.env.RECORDLY_LINUX_PORTAL_CURSOR_PERSIST === "1" ? [] : ["--no-persist"]),
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);

	options.trackProcess?.(child);
	attachNativeCaptureStdinLifecycle(child);
	captureProcess = child;
	captureVideoPath = outputPath;
	captureBinaryPath = binary;
	captureSystemAudioPath = systemAudioPath;
	captureOutput = "";
	captureError = "";
	capturePaused = false;
	captureStopRequested = false;
	captureVideoStarted = false;

	let started = false;
	child.stdout.on("data", (chunk: Buffer) => {
		captureOutput = appendBounded(captureOutput, chunk.toString());
		if (/^VIDEO_START:/m.test(captureOutput)) {
			captureVideoStarted = true;
		}
	});
	child.stderr.on("data", (chunk: Buffer) => {
		captureError = appendBounded(captureError, chunk.toString());
	});
	child.once("close", () => {
		const wasUnexpected = started && !captureStopRequested && captureProcess === child;
		if (captureProcess === child) {
			resetCaptureState();
		}
		if (wasUnexpected) {
			options.onUnexpectedExit?.();
		}
	});

	try {
		await waitForStart(child);
		started = true;
	} catch (error) {
		captureStopRequested = true;
		try {
			child.kill("SIGINT");
		} catch {
			// ignore
		}
		if (captureProcess === child) {
			resetCaptureState();
		}
		recordNativeCaptureDiagnostics({
			backend: "linux-portal",
			phase: "start",
			helperPath: binary,
			outputPath,
			systemAudioPath,
			processOutput:
				[captureOutput.trim(), captureError.trim()].filter(Boolean).join("\n") || undefined,
			error: String(error),
		});
		throw error;
	}

	recordNativeCaptureDiagnostics({
		backend: "linux-portal",
		phase: "start",
		helperPath: binary,
		outputPath,
		systemAudioPath,
		processOutput: captureOutput.trim() || undefined,
	});

	return outputPath;
}

export async function stopLinuxPortalCapture(): Promise<{
	success: boolean;
	path?: string;
	message?: string;
	error?: string;
}> {
	const child = captureProcess;
	const outputPath = captureVideoPath;
	const binary = captureBinaryPath;
	const systemAudioPath = captureSystemAudioPath;
	if (!child || !outputPath) {
		throw new Error("No Linux portal capture is active.");
	}

	const wasPausedBeforeFirstFrame = capturePaused && !captureVideoStarted;
	captureStopRequested = true;
	captureProcess = null;
	captureVideoPath = null;
	captureBinaryPath = null;
	captureSystemAudioPath = null;
	capturePaused = false;
	captureVideoStarted = false;

	const exited =
		child.exitCode !== null || child.signalCode !== null
			? Promise.resolve()
			: new Promise<void>((resolve) => {
					child.once("close", () => resolve());
				});

	if (child.exitCode === null && child.signalCode === null) {
		const stdinState = attachNativeCaptureStdinLifecycle(child);
		let sentStdin = false;
		if (
			!stdinState.error &&
			!child.stdin.destroyed &&
			!child.stdin.writableEnded &&
			child.stdin.writable
		) {
			try {
				sentStdin = child.stdin.write("stop\n", (error?: Error | null) => {
					if (error) {
						try {
							child.kill("SIGINT");
						} catch {
							// ignore
						}
					}
				});
			} catch {
				sentStdin = false;
			}
		}
		if (!sentStdin) {
			try {
				child.kill("SIGINT");
			} catch {
				// ignore
			}
		}
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// ignore
			}
			reject(new Error("Timed out stopping the Linux portal capture."));
		}, STOP_TIMEOUT_MS);
		timer.unref?.();
	});

	try {
		await Promise.race([exited, timeout]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
		captureStopRequested = false;
	}

	if (wasPausedBeforeFirstFrame) {
		const size = await getFileSizeIfPresent(outputPath);
		if ((size ?? 0) < 1024) {
			await discardRecordingFiles(outputPath).catch(() => undefined);
			return {
				success: true,
				message: "Linux portal capture cancelled before recording started",
			};
		}
	}

	let validation: { fileSizeBytes: number; durationSeconds: number };
	try {
		validation = await validateRecordedVideo(outputPath);
	} catch (error) {
		const size = await getFileSizeIfPresent(outputPath);
		if ((size ?? 0) < 1024 && captureError.trim()) {
			throw new Error(captureError.trim());
		}
		throw error;
	}

	await rememberApprovedLocalReadPath(outputPath);
	const resolvedSystemAudioPath =
		systemAudioPath && (await getFileSizeIfPresent(systemAudioPath)) ? systemAudioPath : null;
	if (resolvedSystemAudioPath) {
		await rememberApprovedLocalReadPath(resolvedSystemAudioPath);
	}
	setCurrentVideoPath(outputPath);
	setCurrentProjectPath(null);

	recordNativeCaptureDiagnostics({
		backend: "linux-portal",
		phase: "stop",
		helperPath: binary,
		outputPath,
		systemAudioPath: resolvedSystemAudioPath,
		fileSizeBytes: validation.fileSizeBytes,
		processOutput: captureOutput.trim() || undefined,
	});

	return {
		success: true,
		path: outputPath,
		message: "Linux portal capture complete",
	};
}

function waitForStart(child: ChildProcessWithoutNullStreams): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			child.stdout.removeListener("data", onData);
			child.removeListener("close", onClose);
			child.removeListener("error", onError);
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		};

		const onData = () => {
			if (/^STREAM:/m.test(captureOutput)) {
				finish();
			}
		};
		const onClose = (code: number | null) => {
			finish(
				new Error(
					captureError.trim() || `The portal capture helper exited with code ${code}.`,
				),
			);
		};
		const onError = (error: Error) => {
			finish(new Error(`Failed to spawn the portal capture helper: ${error.message}`));
		};
		const timer = setTimeout(() => {
			finish(new Error("Timed out waiting for the screen share dialog."));
		}, START_TIMEOUT_MS);
		timer.unref?.();

		child.stdout.on("data", onData);
		child.once("close", onClose);
		child.once("error", onError);
	});
}
