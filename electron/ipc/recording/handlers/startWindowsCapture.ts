import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import { getMonitorHandles } from "../../monitorResolver";
import { getWindowsCaptureExePath } from "../../paths/binaries";
import {
	setNativeScreenRecordingActive,
	setWindowsCaptureOutputBuffer,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsCaptureTempPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsOrphanedMicAudioPath,
	setWindowsSystemAudioPath,
	windowsCaptureOutputBuffer,
	windowsCaptureProcess,
	windowsCaptureTargetPath,
	windowsMicAudioPath,
	windowsSystemAudioPath,
} from "../../state";
import { type NativeMacRecordingOptions, type SelectedSource } from "../../types";
import { getRecordingsDir, getScreen } from "../../utils";
import { resolveWindowsCaptureTarget } from "../../windowsCaptureSelection";
import { recordNativeCaptureDiagnostics } from "../diagnostics";
import {
	attachWindowsCaptureLifecycle,
	isNativeWindowsCaptureAvailable,
	recoverNativeWindowsCaptureOutput,
	waitForWindowsCaptureStart,
} from "../windows";
import {
	shouldStartWindowsBrowserMicrophoneFallback,
	shouldUseWindowsBrowserMicrophoneFallback,
} from "../windowsFallbacks";

import type { RecordingHandlerContext } from "./handlerContext";

export async function startWindowsCapture(
	context: Pick<
		RecordingHandlerContext,
		| "recordingProcessGuard"
		| "windowsFinalizer"
		| "windowsInterruptedRecovery"
		| "ownerRecovery"
	>,
	source: SelectedSource,
	options?: NativeMacRecordingOptions,
) {
	const { recordingProcessGuard, windowsFinalizer, windowsInterruptedRecovery, ownerRecovery } =
		context;

	const windowsCaptureAvailable = await isNativeWindowsCaptureAvailable();
	if (!windowsCaptureAvailable) {
		return {
			success: false,
			message: "Native Windows capture is not available on this system.",
		};
	}

	if (windowsCaptureProcess) {
		return {
			success: false,
			message: "A native Windows screen recording is already active.",
		};
	}

	windowsInterruptedRecovery.current = null;
	let wcProc: ChildProcessWithoutNullStreams | null = null;
	let tempVideoPath: string | null = null;
	let tempSystemAudioPath: string | null = null;
	let tempMicPath: string | null = null;
	try {
		const exePath = getWindowsCaptureExePath();
		const recordingsDir = await getRecordingsDir();
		const timestamp = Date.now();
		const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`);
		tempVideoPath = path.join(app.getPath("temp"), `recordly-native-${timestamp}.mp4`);

		let captureOutput = "";
		let systemAudioPath: string | null = null;
		let microphonePath: string | null = null;
		let orphanedMicAudioPath: string | null = null;

		const browserMicFallbackRequested = shouldStartWindowsBrowserMicrophoneFallback(options);
		const captureTarget = resolveWindowsCaptureTarget(
			source,
			getScreen().getAllDisplays(),
			getScreen().getPrimaryDisplay(),
		);
		const displayBounds = captureTarget.kind === "display" ? captureTarget.bounds : null;
		setWindowsOrphanedMicAudioPath(null);

		const config: Record<string, unknown> = {
			outputPath: tempVideoPath,
			fps: 60,
		};

		if (captureTarget.kind === "invalid-window") {
			return {
				success: false,
				message: "Selected window is no longer available. Please choose the window again.",
			};
		}

		if (captureTarget.kind === "window") {
			config.windowHandle = captureTarget.windowHandle;
		} else {
			// Windows Graphics Capture (WGC) requires a raw HMONITOR handle.
			// We attempt to resolve the handle by matching the physical coordinates of the target display.
			const monitors = getMonitorHandles();
			const matchedMonitor = monitors.find(
				(monitor) =>
					monitor.x === Math.round(captureTarget.bounds.x) &&
					monitor.y === Math.round(captureTarget.bounds.y),
			);

			if (matchedMonitor) {
				config.displayId = matchedMonitor.handle;
			} else {
				// Fallback to coordinate-based matching if handle resolution fails
				config.displayId = captureTarget.displayId;
			}

			config.displayX = Math.round(captureTarget.bounds.x);
			config.displayY = Math.round(captureTarget.bounds.y);
			config.displayW = Math.round(captureTarget.bounds.width);
			config.displayH = Math.round(captureTarget.bounds.height);
		}

		if (options?.capturesSystemAudio) {
			systemAudioPath = path.join(recordingsDir, `recording-${timestamp}.system.wav`);
			tempSystemAudioPath = path.join(
				app.getPath("temp"),
				`recordly-native-${timestamp}.system.wav`,
			);
			config.captureSystemAudio = true;
			config.audioOutputPath = tempSystemAudioPath;
			setWindowsSystemAudioPath(systemAudioPath);
		} else {
			setWindowsSystemAudioPath(null);
		}

		if (options?.capturesMicrophone && !browserMicFallbackRequested) {
			microphonePath = path.join(recordingsDir, `recording-${timestamp}.mic.wav`);
			tempMicPath = path.join(app.getPath("temp"), `recordly-native-${timestamp}.mic.wav`);
			config.captureMic = true;
			config.micOutputPath = tempMicPath;
			if (options.microphoneDeviceId) {
				config.micDeviceId = options.microphoneDeviceId;
			}
			if (options.microphoneLabel) {
				config.micDeviceName = options.microphoneLabel;
			}
			setWindowsMicAudioPath(microphonePath);
		} else if (browserMicFallbackRequested) {
			config.captureMic = false;
			setWindowsMicAudioPath(null);
		} else {
			setWindowsMicAudioPath(null);
		}

		recordNativeCaptureDiagnostics({
			backend: "windows-wgc",
			phase: "start",
			sourceId: source?.id ?? null,
			sourceType: source?.sourceType ?? "unknown",
			displayId: typeof config.displayId === "number" ? config.displayId : null,
			displayBounds,
			windowHandle: typeof config.windowHandle === "number" ? config.windowHandle : null,
			helperPath: exePath,
			outputPath,
			systemAudioPath,
			microphonePath,
		});

		setWindowsCaptureOutputBuffer("");
		setWindowsCaptureTargetPath(outputPath);
		setWindowsCaptureTempPath(tempVideoPath);
		setWindowsCaptureStopRequested(false);
		setWindowsCapturePaused(false);

		wcProc = recordingProcessGuard.track(
			spawn(exePath, [JSON.stringify(config)], {
				cwd: recordingsDir,
				stdio: ["pipe", "pipe", "pipe"],
				env: process.env,
			}),
		);
		setWindowsCaptureProcess(wcProc);
		attachWindowsCaptureLifecycle(wcProc, () => {
			windowsInterruptedRecovery.current = windowsFinalizer.recover(
				recoverNativeWindowsCaptureOutput,
			);
			void windowsInterruptedRecovery.current.catch((error) =>
				console.error("Windows interrupted recording recovery failed:", error),
			);
		});
		const ownerSession = ownerRecovery.sessionToken;
		wcProc.once("close", () => {
			if (ownerRecovery.sessionToken === ownerSession) ownerRecovery.captureExited();
		});

		wcProc.stdout.on("data", (chunk: Buffer) => {
			const msg = chunk.toString();
			captureOutput += msg;
			setWindowsCaptureOutputBuffer(captureOutput);
		});
		wcProc.stderr.on("data", (chunk: Buffer) => {
			const msg = chunk.toString();
			captureOutput += msg;
			setWindowsCaptureOutputBuffer(captureOutput);
		});

		await waitForWindowsCaptureStart(wcProc);
		const microphoneFallbackRequired =
			browserMicFallbackRequested ||
			shouldUseWindowsBrowserMicrophoneFallback(captureOutput, options);
		if (microphoneFallbackRequired) {
			orphanedMicAudioPath = tempMicPath ?? microphonePath;
			setWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
			microphonePath = null;
			setWindowsMicAudioPath(null);
		}
		setWindowsNativeCaptureActive(true);
		setNativeScreenRecordingActive(true);
		recordNativeCaptureDiagnostics({
			backend: "windows-wgc",
			phase: "start",
			sourceId: source?.id ?? null,
			sourceType: source?.sourceType ?? "unknown",
			displayId: typeof config.displayId === "number" ? config.displayId : null,
			displayBounds,
			windowHandle: typeof config.windowHandle === "number" ? config.windowHandle : null,
			helperPath: exePath,
			outputPath,
			systemAudioPath,
			microphonePath,
			processOutput: captureOutput.trim() || undefined,
		});
		return { success: true, microphoneFallbackRequired };
	} catch (error) {
		recordNativeCaptureDiagnostics({
			backend: "windows-wgc",
			phase: "start",
			sourceId: source?.id ?? null,
			sourceType: source?.sourceType ?? "unknown",
			helperPath: windowsCaptureTargetPath ? getWindowsCaptureExePath() : null,
			outputPath: windowsCaptureTargetPath,
			systemAudioPath: windowsSystemAudioPath,
			microphonePath: windowsMicAudioPath,
			processOutput: windowsCaptureOutputBuffer.trim() || undefined,
			error: String(error),
		});
		console.error("Failed to start native Windows capture:", error);
		try {
			if (wcProc) wcProc.kill();
		} catch {
			/* ignore */
		}
		// Preserve potential partial output and its destinations. A kill request
		// does not close the writer; its lifecycle retains process ownership.
		setWindowsNativeCaptureActive(false);
		setNativeScreenRecordingActive(false);
		setWindowsOrphanedMicAudioPath(null);
		setWindowsCaptureStopRequested(false);
		setWindowsCapturePaused(false);
		return {
			success: false,
			message: "Failed to start native Windows capture",
			error: String(error),
		};
	}
}
