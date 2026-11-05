import fs from "node:fs/promises";
import {
	lastNativeCaptureDiagnostics,
	nativeCaptureMicrophonePath,
	nativeCaptureOutputBuffer,
	nativeCaptureProcess,
	nativeCaptureSystemAudioPath,
	nativeCaptureTargetPath,
	nativeScreenRecordingActive,
	setNativeCaptureMicrophonePath,
	setNativeCapturePaused,
	setNativeCaptureProcess,
	setNativeCaptureStopRequested,
	setNativeCaptureSystemAudioPath,
	setNativeCaptureTargetPath,
	setNativeScreenRecordingActive,
} from "../../state";
import { moveFileWithOverwrite } from "../../utils";
import { getFileSizeIfPresent, recordNativeCaptureDiagnostics } from "../diagnostics";
import { parseNativeCaptureInterruption } from "../interruption";
import {
	finalizeStoredVideo,
	muxNativeMacRecordingWithAudio,
	NativeCaptureStopTimeoutError,
	recoverNativeMacCaptureOutput,
	waitForNativeCaptureStop,
} from "../mac";

export async function stopMacCapture() {
	if (process.platform !== "darwin") {
		return {
			success: false,
			message: "Native screen recording is only available on macOS.",
		};
	}

	if (!nativeScreenRecordingActive) {
		const recovered = await recoverNativeMacCaptureOutput();
		if (recovered) {
			return {
				...recovered,
				...(parseNativeCaptureInterruption(nativeCaptureOutputBuffer)
					? {
							error: `Recording interrupted: ${parseNativeCaptureInterruption(nativeCaptureOutputBuffer)}. A partial recording was saved.`,
						}
					: {}),
			};
		}

		return { success: false, message: "No native screen recording is active." };
	}

	try {
		if (!nativeCaptureProcess) {
			throw new Error("Native capture helper process is not running");
		}

		const process = nativeCaptureProcess;
		const preferredVideoPath = nativeCaptureTargetPath;
		const preferredSystemAudioPath = nativeCaptureSystemAudioPath;
		const preferredMicrophonePath = nativeCaptureMicrophonePath;
		console.log(
			"[stop-native] Audio paths — system:",
			preferredSystemAudioPath,
			"mic:",
			preferredMicrophonePath,
		);
		setNativeCaptureStopRequested(true);
		process.stdin.write("stop\n");
		const tempVideoPath = await waitForNativeCaptureStop(process);
		console.log("[stop-native] Helper stopped, tempVideoPath:", tempVideoPath);
		setNativeCaptureProcess(null);
		setNativeScreenRecordingActive(false);
		setNativeCaptureTargetPath(null);
		setNativeCaptureSystemAudioPath(null);
		setNativeCaptureMicrophonePath(null);
		setNativeCaptureStopRequested(false);
		setNativeCapturePaused(false);

		const finalVideoPath = preferredVideoPath ?? tempVideoPath;
		if (tempVideoPath !== finalVideoPath) {
			await moveFileWithOverwrite(tempVideoPath, finalVideoPath);
		}

		if (preferredSystemAudioPath || preferredMicrophonePath) {
			console.log(
				"[stop-native] Attempting audio mux (merging separate tracks) into:",
				finalVideoPath,
			);
			try {
				await muxNativeMacRecordingWithAudio(
					finalVideoPath,
					preferredSystemAudioPath,
					preferredMicrophonePath,
				);
				console.log("[stop-native] Audio mux completed successfully");
			} catch (error) {
				console.warn(
					"[stop-native] Audio mux failed (video still has inline audio):",
					error,
				);
			}
		} else {
			console.log("[stop-native] No separate audio tracks to mux");
		}

		return await finalizeStoredVideo(finalVideoPath);
	} catch (error) {
		console.error("Failed to stop native ScreenCaptureKit recording:", error);
		if (error instanceof NativeCaptureStopTimeoutError && error.captureStillRunning) {
			// kill() is only a request. Keep the process/path reservation until
			// its actual close; recovery must not inspect a live writer's MP4.
			// Let the normal interruption lifecycle handle an eventual late close.
			setNativeCaptureStopRequested(false);
			return {
				success: false,
				message: "The capture helper has not exited.",
				error: String(error),
			};
		}
		const fallbackPath = nativeCaptureTargetPath;
		const fallbackSystemAudioPath = nativeCaptureSystemAudioPath;
		const fallbackMicrophonePath = nativeCaptureMicrophonePath;
		const fallbackFileSizeBytes = await getFileSizeIfPresent(fallbackPath);
		setNativeScreenRecordingActive(false);
		setNativeCaptureProcess(null);
		setNativeCaptureTargetPath(null);
		setNativeCaptureSystemAudioPath(null);
		setNativeCaptureMicrophonePath(null);
		setNativeCaptureStopRequested(false);
		setNativeCapturePaused(false);

		recordNativeCaptureDiagnostics({
			backend: "mac-screencapturekit",
			phase: "stop",
			sourceId: lastNativeCaptureDiagnostics?.sourceId ?? null,
			sourceType: lastNativeCaptureDiagnostics?.sourceType ?? "unknown",
			displayId: lastNativeCaptureDiagnostics?.displayId ?? null,
			displayBounds: lastNativeCaptureDiagnostics?.displayBounds ?? null,
			windowHandle: lastNativeCaptureDiagnostics?.windowHandle ?? null,
			helperPath: lastNativeCaptureDiagnostics?.helperPath ?? null,
			outputPath: fallbackPath,
			systemAudioPath: fallbackSystemAudioPath,
			microphonePath: fallbackMicrophonePath,
			osRelease: lastNativeCaptureDiagnostics?.osRelease,
			supported: lastNativeCaptureDiagnostics?.supported,
			helperExists: lastNativeCaptureDiagnostics?.helperExists,
			processOutput: nativeCaptureOutputBuffer.trim() || undefined,
			fileSizeBytes: fallbackFileSizeBytes,
			error: String(error),
		});

		// Try to recover: if the target file exists on disk, finalize with it
		if (fallbackPath) {
			try {
				await fs.access(fallbackPath);
				console.log(
					"[stop-native-screen-recording] Recovering with fallback path:",
					fallbackPath,
				);
				if (fallbackSystemAudioPath || fallbackMicrophonePath) {
					try {
						await muxNativeMacRecordingWithAudio(
							fallbackPath,
							fallbackSystemAudioPath,
							fallbackMicrophonePath,
						);
					} catch (muxError) {
						console.warn(
							"Failed to mux recovered native macOS audio into capture:",
							muxError,
						);
					}
				}
				const recovered = await finalizeStoredVideo(fallbackPath);
				const interruption = parseNativeCaptureInterruption(nativeCaptureOutputBuffer);
				return {
					...recovered,
					...(interruption
						? {
								error: `Recording interrupted: ${interruption}. A partial recording was saved.`,
							}
						: {}),
				};
			} catch {
				// File doesn't exist or isn't accessible
			}
		}

		const recovered = await recoverNativeMacCaptureOutput();
		if (recovered) {
			return {
				...recovered,
				...(parseNativeCaptureInterruption(nativeCaptureOutputBuffer)
					? {
							error: `Recording interrupted: ${parseNativeCaptureInterruption(nativeCaptureOutputBuffer)}. A partial recording was saved.`,
						}
					: {}),
			};
		}

		return {
			success: false,
			message: "Failed to stop native ScreenCaptureKit recording",
			error: String(error),
		};
	}
}
