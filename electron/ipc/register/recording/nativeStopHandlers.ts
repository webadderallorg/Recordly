import fs from "node:fs/promises"
import { ipcMain } from "electron"
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
	setNativeScreenRecordingActive as setRecordingActive,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsCaptureOutputBuffer,
	windowsCaptureProcess,
	windowsCaptureTargetPath,
	windowsMicAudioPath,
	windowsNativeCaptureActive,
	windowsSystemAudioPath,
} from "../../state"
import { getFileSizeIfPresent, recordNativeCaptureDiagnostics } from "../../recording/diagnostics"
import {
	finalizeStoredVideo,
	muxNativeMacRecordingWithAudio,
	recoverNativeMacCaptureOutput,
	waitForNativeCaptureStop,
} from "../../recording/mac"
import { waitForWindowsCaptureStop } from "../../recording/windows"
import { moveFileWithOverwrite } from "../../utils"

export function registerNativeRecordingStopHandlers() {
	ipcMain.handle("stop-native-screen-recording", async () => {
		if (process.platform === "win32" && windowsNativeCaptureActive) {
			try {
				if (!windowsCaptureProcess) {
					throw new Error("Native Windows capture process is not running")
				}

				const process = windowsCaptureProcess
				const preferredVideoPath = windowsCaptureTargetPath
				setWindowsCaptureStopRequested(true)
				process.stdin.write("stop\n")
				const tempVideoPath = await waitForWindowsCaptureStop(process)
				setWindowsCaptureProcess(null)
				setWindowsNativeCaptureActive(false)
				setRecordingActive(false)
				setWindowsCaptureTargetPath(null)
				setWindowsCaptureStopRequested(false)
				setWindowsCapturePaused(false)

				const finalVideoPath = preferredVideoPath ?? tempVideoPath
				if (tempVideoPath !== finalVideoPath) {
					await moveFileWithOverwrite(tempVideoPath, finalVideoPath)
				}

				setWindowsPendingVideoPath(finalVideoPath)
				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "stop",
					outputPath: finalVideoPath,
					systemAudioPath: windowsSystemAudioPath,
					microphonePath: windowsMicAudioPath,
					processOutput: windowsCaptureOutputBuffer.trim() || undefined,
					fileSizeBytes: await getFileSizeIfPresent(finalVideoPath),
				})
				return { success: true, path: finalVideoPath }
			} catch (error) {
				console.error("Failed to stop native Windows capture:", error)
				const fallbackPath = windowsCaptureTargetPath
				setWindowsNativeCaptureActive(false)
				setRecordingActive(false)
				setWindowsCaptureProcess(null)
				setWindowsCaptureTargetPath(null)
				setWindowsCaptureStopRequested(false)
				setWindowsCapturePaused(false)
				setWindowsSystemAudioPath(null)
				setWindowsMicAudioPath(null)
				setWindowsPendingVideoPath(null)

				if (fallbackPath) {
					try {
						await fs.access(fallbackPath)
						setWindowsPendingVideoPath(fallbackPath)
						recordNativeCaptureDiagnostics({
							backend: "windows-wgc",
							phase: "stop",
							outputPath: fallbackPath,
							systemAudioPath: windowsSystemAudioPath,
							microphonePath: windowsMicAudioPath,
							processOutput: windowsCaptureOutputBuffer.trim() || undefined,
							fileSizeBytes: await getFileSizeIfPresent(fallbackPath),
							error: String(error),
						})
						return { success: true, path: fallbackPath }
					} catch {
						// file doesn't exist
					}
				}

				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "stop",
					outputPath: fallbackPath,
					systemAudioPath: windowsSystemAudioPath,
					microphonePath: windowsMicAudioPath,
					processOutput: windowsCaptureOutputBuffer.trim() || undefined,
					error: String(error),
				})

				return {
					success: false,
					message: "Failed to stop native Windows capture",
					error: String(error),
				}
			}
		}

		if (process.platform !== "darwin") {
			return {
				success: false,
				message: "Native screen recording is only available on macOS.",
			}
		}

		if (!nativeScreenRecordingActive) {
			const recovered = await recoverNativeMacCaptureOutput()
			if (recovered) {
				return recovered
			}

			return { success: false, message: "No native screen recording is active." }
		}

		try {
			if (!nativeCaptureProcess) {
				throw new Error("Native capture helper process is not running")
			}

			const process = nativeCaptureProcess
			const preferredVideoPath = nativeCaptureTargetPath
			const preferredSystemAudioPath = nativeCaptureSystemAudioPath
			const preferredMicrophonePath = nativeCaptureMicrophonePath
			console.log(
				"[stop-native] Audio paths — system:",
				preferredSystemAudioPath,
				"mic:",
				preferredMicrophonePath,
			)
			setNativeCaptureStopRequested(true)
			process.stdin.write("stop\n")
			const tempVideoPath = await waitForNativeCaptureStop(process)
			console.log("[stop-native] Helper stopped, tempVideoPath:", tempVideoPath)
			setNativeCaptureProcess(null)
			setNativeScreenRecordingActive(false)
			setNativeCaptureTargetPath(null)
			setNativeCaptureSystemAudioPath(null)
			setNativeCaptureMicrophonePath(null)
			setNativeCaptureStopRequested(false)
			setNativeCapturePaused(false)

			const finalVideoPath = preferredVideoPath ?? tempVideoPath
			if (tempVideoPath !== finalVideoPath) {
				await moveFileWithOverwrite(tempVideoPath, finalVideoPath)
			}

			if (preferredSystemAudioPath || preferredMicrophonePath) {
				console.log(
					"[stop-native] Attempting audio mux (merging separate tracks) into:",
					finalVideoPath,
				)
				try {
					await muxNativeMacRecordingWithAudio(
						finalVideoPath,
						preferredSystemAudioPath,
						preferredMicrophonePath,
					)
					console.log("[stop-native] Audio mux completed successfully")
				} catch (error) {
					console.warn(
						"[stop-native] Audio mux failed (video still has inline audio):",
						error,
					)
				}
			} else {
				console.log("[stop-native] No separate audio tracks to mux")
			}

			return await finalizeStoredVideo(finalVideoPath)
		} catch (error) {
			console.error("Failed to stop native ScreenCaptureKit recording:", error)
			const fallbackPath = nativeCaptureTargetPath
			const fallbackSystemAudioPath = nativeCaptureSystemAudioPath
			const fallbackMicrophonePath = nativeCaptureMicrophonePath
			const fallbackFileSizeBytes = await getFileSizeIfPresent(fallbackPath)
			setNativeScreenRecordingActive(false)
			setNativeCaptureProcess(null)
			setNativeCaptureTargetPath(null)
			setNativeCaptureSystemAudioPath(null)
			setNativeCaptureMicrophonePath(null)
			setNativeCaptureStopRequested(false)
			setNativeCapturePaused(false)

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
			})

			if (fallbackPath) {
				try {
					await fs.access(fallbackPath)
					console.log(
						"[stop-native-screen-recording] Recovering with fallback path:",
						fallbackPath,
					)
					if (fallbackSystemAudioPath || fallbackMicrophonePath) {
						try {
							await muxNativeMacRecordingWithAudio(
								fallbackPath,
								fallbackSystemAudioPath,
								fallbackMicrophonePath,
							)
						} catch (muxError) {
							console.warn(
								"Failed to mux recovered native macOS audio into capture:",
								muxError,
							)
						}
					}
					return await finalizeStoredVideo(fallbackPath)
				} catch {
					// file doesn't exist or isn't accessible
				}
			}

			const recovered = await recoverNativeMacCaptureOutput()
			if (recovered) {
				return recovered
			}

			return {
				success: false,
				message: "Failed to stop native ScreenCaptureKit recording",
				error: String(error),
			}
		}
	})

	ipcMain.handle("recover-native-screen-recording", async () => {
		if (process.platform !== "darwin") {
			return {
				success: false,
				message: "Native screen recording recovery is only available on macOS.",
			}
		}

		const recovered = await recoverNativeMacCaptureOutput()
		if (recovered) {
			return recovered
		}

		return {
			success: false,
			message: "No recoverable native macOS recording output was found.",
		}
	})
}