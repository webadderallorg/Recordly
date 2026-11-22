import {
	persistPendingCursorTelemetry,
	snapshotCursorTelemetryForPersistence,
} from "../../cursor/telemetry";
import {
	setNativeScreenRecordingActive,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsCaptureTempPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsOrphanedMicAudioPath,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsCaptureOutputBuffer,
	windowsCaptureProcess,
	windowsCaptureTargetPath,
	windowsCaptureTempPath,
	windowsMicAudioPath,
	windowsOrphanedMicAudioPath,
	windowsSystemAudioPath,
} from "../../state";
import { moveFileWithOverwrite } from "../../utils";
import {
	getFileSizeIfPresent,
	recordNativeCaptureDiagnostics,
	validateRecordedVideo,
} from "../diagnostics";
import { parseNativeCaptureInterruption } from "../interruption";
import { recoverNativeWindowsCaptureOutput, waitForWindowsCaptureStop } from "../windows";
import {
	cleanupWindowsOrphanedMicAudioPath,
	pathExists,
	resolveExistingPath,
	writeWindowsRecordingDiagnostics,
} from "./nativeCaptureSupport";

export async function stopWindowsCapture() {
	let stagedTempVideoPath = windowsCaptureTempPath;
	let stagedTempSystemAudioPath =
		windowsCaptureTempPath?.replace(/\.mp4$/i, ".system.wav") ?? null;
	let stagedTempMicAudioPath = windowsCaptureTempPath?.replace(/\.mp4$/i, ".mic.wav") ?? null;
	try {
		if (!windowsCaptureProcess) {
			throw new Error("Native Windows capture process is not running");
		}

		const proc = windowsCaptureProcess;
		const preferredVideoPath = windowsCaptureTargetPath;
		const preferredOrphanedMicAudioPath = windowsOrphanedMicAudioPath;
		const diagnosticsSystemAudioPath = windowsSystemAudioPath;
		const diagnosticsMicAudioPath = windowsMicAudioPath;
		setWindowsCaptureStopRequested(true);
		proc.stdin.write("stop\n");
		const tempVideoPath = await waitForWindowsCaptureStop(proc);
		stagedTempVideoPath = tempVideoPath;
		const finalVideoPath = preferredVideoPath ?? tempVideoPath;

		// Native Windows capture results are initially written to a safe temporary path
		// (to avoid encoding failures with non-ASCII characters). We move them to the final
		// destination now using Node.js, which handles Unicode paths correctly.
		if (tempVideoPath !== finalVideoPath) {
			await moveFileWithOverwrite(tempVideoPath, finalVideoPath);
		}

		if (windowsSystemAudioPath && tempVideoPath.endsWith(".mp4")) {
			const tempAudioPath = tempVideoPath.replace(".mp4", ".system.wav");
			stagedTempSystemAudioPath = tempAudioPath;
			const finalAudioPath = windowsSystemAudioPath;
			if (await pathExists(tempAudioPath)) {
				await moveFileWithOverwrite(tempAudioPath, finalAudioPath);
				const tempJson = tempAudioPath + ".json";
				if (await pathExists(tempJson)) {
					await moveFileWithOverwrite(tempJson, finalAudioPath + ".json");
				}
			}
		}

		if (windowsMicAudioPath && tempVideoPath.endsWith(".mp4")) {
			const tempMicPath = tempVideoPath.replace(".mp4", ".mic.wav");
			stagedTempMicAudioPath = tempMicPath;
			const finalMicPath = windowsMicAudioPath;
			if (await pathExists(tempMicPath)) {
				await moveFileWithOverwrite(tempMicPath, finalMicPath);
				const tempJson = tempMicPath + ".json";
				if (await pathExists(tempJson)) {
					await moveFileWithOverwrite(tempJson, finalMicPath + ".json");
				}
			}
		}
		const validation = await validateRecordedVideo(finalVideoPath);

		setWindowsCaptureProcess(null);
		setWindowsNativeCaptureActive(false);
		setNativeScreenRecordingActive(false);
		setWindowsCaptureTargetPath(null);
		setWindowsCaptureTempPath(null);
		setWindowsCaptureStopRequested(false);
		setWindowsCapturePaused(false);
		setWindowsOrphanedMicAudioPath(null);
		await cleanupWindowsOrphanedMicAudioPath(preferredOrphanedMicAudioPath);
		setWindowsPendingVideoPath(finalVideoPath);
		recordNativeCaptureDiagnostics({
			backend: "windows-wgc",
			phase: "stop",
			outputPath: finalVideoPath,
			systemAudioPath: diagnosticsSystemAudioPath,
			microphonePath: diagnosticsMicAudioPath,
			processOutput: windowsCaptureOutputBuffer.trim() || undefined,
			fileSizeBytes: validation.fileSizeBytes,
		});
		await writeWindowsRecordingDiagnostics(finalVideoPath, {
			phase: "stop",
			outputPath: finalVideoPath,
			systemAudioPath: diagnosticsSystemAudioPath,
			microphonePath: diagnosticsMicAudioPath,
			processOutput: windowsCaptureOutputBuffer.trim() || undefined,
			details: {
				fileSizeBytes: validation.fileSizeBytes,
				durationSeconds: validation.durationSeconds,
			},
		});

		// Persist cursor telemetry before returning so the editor can find it immediately
		snapshotCursorTelemetryForPersistence();
		try {
			await persistPendingCursorTelemetry(finalVideoPath);
		} catch (error) {
			console.warn("Failed to persist cursor telemetry during native stop:", error);
		}

		const interruption = parseNativeCaptureInterruption(windowsCaptureOutputBuffer);
		return {
			success: true,
			path: finalVideoPath,
			...(interruption
				? {
						error: `Recording interrupted: ${interruption}. A partial recording was saved.`,
					}
				: {}),
		};
	} catch (error) {
		console.error("Failed to stop native Windows capture:", error);
		if (windowsCaptureProcess) {
			// Arm close recovery synchronously: kill() only requests termination.
			// Neither validate nor move an MP4 while its writer may still be open.
			setWindowsCaptureStopRequested(false);
			setNativeScreenRecordingActive(false);
			try {
				if (!windowsCaptureProcess.killed) windowsCaptureProcess.kill();
			} catch {
				// Retain the writer reservation even when termination is refused.
			}
			recordNativeCaptureDiagnostics({
				backend: "windows-wgc",
				phase: "stop",
				outputPath: stagedTempVideoPath ?? windowsCaptureTargetPath,
				systemAudioPath: stagedTempSystemAudioPath ?? windowsSystemAudioPath,
				microphonePath: stagedTempMicAudioPath ?? windowsMicAudioPath,
				processOutput: windowsCaptureOutputBuffer.trim() || undefined,
				error: String(error),
			});
			return {
				success: false,
				message: "Recording is still closing. Its files have been preserved for recovery.",
				error: `${String(error)}${stagedTempVideoPath ? ` Recording files: ${stagedTempVideoPath}` : ""}`,
			};
		}
		setWindowsNativeCaptureActive(false);
		const closedRecovery = await recoverNativeWindowsCaptureOutput();
		const fallbackPath =
			closedRecovery?.path ??
			(await resolveExistingPath(
				windowsCaptureTargetPath,
				windowsCaptureTempPath,
				stagedTempVideoPath,
			));
		const recoveredSystemAudioPath = await resolveExistingPath(
			windowsSystemAudioPath,
			stagedTempSystemAudioPath,
		);
		const recoveredMicAudioPath = await resolveExistingPath(
			windowsMicAudioPath,
			stagedTempMicAudioPath,
		);
		const fallbackOrphanedMicAudioPath = windowsOrphanedMicAudioPath;
		const diagnosticsSystemAudioPath = recoveredSystemAudioPath ?? windowsSystemAudioPath;
		const diagnosticsMicAudioPath = recoveredMicAudioPath ?? windowsMicAudioPath;
		setWindowsNativeCaptureActive(false);
		setNativeScreenRecordingActive(false);
		setWindowsCaptureProcess(null);
		setWindowsCaptureStopRequested(false);
		setWindowsCapturePaused(false);
		setWindowsOrphanedMicAudioPath(null);

		if (fallbackPath) {
			try {
				const validation = await validateRecordedVideo(fallbackPath);
				setWindowsPendingVideoPath(fallbackPath);
				setWindowsCaptureTargetPath(null);
				setWindowsCaptureTempPath(null);
				setWindowsSystemAudioPath(recoveredSystemAudioPath);
				setWindowsMicAudioPath(recoveredMicAudioPath);
				await cleanupWindowsOrphanedMicAudioPath(fallbackOrphanedMicAudioPath);
				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "stop",
					outputPath: fallbackPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					processOutput: windowsCaptureOutputBuffer.trim() || undefined,
					fileSizeBytes: validation.fileSizeBytes,
					error: String(error),
				});
				await writeWindowsRecordingDiagnostics(fallbackPath, {
					phase: "stop",
					outputPath: fallbackPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					processOutput: windowsCaptureOutputBuffer.trim() || undefined,
					error: String(error),
					details: {
						fileSizeBytes: validation.fileSizeBytes,
						durationSeconds: validation.durationSeconds,
						recoveredAfterStopFailure: true,
					},
				});
				return { success: true, path: fallbackPath };
			} catch {
				// File is absent or failed validation.
			}
		}

		setWindowsPendingVideoPath(null);
		await cleanupWindowsOrphanedMicAudioPath(fallbackOrphanedMicAudioPath);

		recordNativeCaptureDiagnostics({
			backend: "windows-wgc",
			phase: "stop",
			outputPath: fallbackPath,
			systemAudioPath: diagnosticsSystemAudioPath,
			microphonePath: diagnosticsMicAudioPath,
			processOutput: windowsCaptureOutputBuffer.trim() || undefined,
			fileSizeBytes: await getFileSizeIfPresent(fallbackPath),
			error: String(error),
		});
		await writeWindowsRecordingDiagnostics(fallbackPath, {
			phase: "stop",
			outputPath: fallbackPath,
			systemAudioPath: diagnosticsSystemAudioPath,
			microphonePath: diagnosticsMicAudioPath,
			processOutput: windowsCaptureOutputBuffer.trim() || undefined,
			error: String(error),
			details: {
				fileSizeBytes: await getFileSizeIfPresent(fallbackPath),
			},
		});

		return {
			success: false,
			message: "Failed to stop native Windows capture",
			error: `${String(error)}${fallbackPath ? ` Recording files: ${fallbackPath}` : ""}`,
		};
	}
}
