import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn } from "node:child_process"
import path from "node:path"
import { app, desktopCapturer, dialog, ipcMain, shell, systemPreferences } from "electron"
import { ALLOW_RECORDLY_WINDOW_CAPTURE } from "../../constants"
import {
	nativeCaptureMicrophonePath,
	nativeCaptureOutputBuffer,
	nativeCaptureProcess,
	nativeCaptureSystemAudioPath,
	nativeCaptureTargetPath,
	nativeScreenRecordingActive,
	setNativeCaptureMicrophonePath,
	setNativeCaptureOutputBuffer,
	setNativeCapturePaused,
	setNativeCaptureProcess,
	setNativeCaptureStopRequested,
	setNativeCaptureSystemAudioPath,
	setNativeCaptureTargetPath,
	setNativeScreenRecordingActive,
	setWindowsCaptureOutputBuffer,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsSystemAudioPath,
	windowsCaptureOutputBuffer,
	windowsCaptureProcess,
	windowsMicAudioPath,
	windowsNativeCaptureActive,
	windowsSystemAudioPath,
	windowsCaptureTargetPath,
	setNativeScreenRecordingActive as setRecordingActive,
} from "../../state"
import type {
	NativeMacRecordingOptions,
	SelectedSource,
} from "../../types"
import {
	getMacPrivacySettingsUrl,
	getRecordingsDir,
	getScreen,
	parseWindowId,
} from "../../utils"
import {
	ensureNativeCaptureHelperBinary,
	getWindowsCaptureExePath,
} from "../../paths/binaries"
import { recordNativeCaptureDiagnostics } from "../../recording/diagnostics"
import {
	attachNativeCaptureLifecycle,
	waitForNativeCaptureStart,
} from "../../recording/mac"
import {
	attachWindowsCaptureLifecycle,
	isNativeWindowsCaptureAvailable,
	waitForWindowsCaptureStart,
} from "../../recording/windows"
import { getDisplayBoundsForSource } from "../../recording/ffmpeg"
import { resolveWindowsCaptureDisplay } from "../../windowsCaptureSelection"

function normalizeDesktopSourceName(value: string) {
	return value.trim().replace(/\s+/g, " ").toLowerCase()
}

export function registerNativeRecordingStartHandlers() {
	ipcMain.handle(
		"start-native-screen-recording",
		async (_, source: SelectedSource, options?: NativeMacRecordingOptions) => {
			if (process.platform === "win32") {
				const windowsCaptureAvailable = await isNativeWindowsCaptureAvailable()
				if (!windowsCaptureAvailable) {
					return {
						success: false,
						message: "Native Windows capture is not available on this system.",
					}
				}

				if (windowsCaptureProcess && !windowsNativeCaptureActive) {
					try {
						windowsCaptureProcess.kill()
					} catch {
						// ignore stale helper cleanup failures
					}
					setWindowsCaptureProcess(null)
					setWindowsCaptureTargetPath(null)
					setWindowsCaptureStopRequested(false)
				}

				if (windowsCaptureProcess) {
					return {
						success: false,
						message: "A native Windows screen recording is already active.",
					}
				}

				let windowsProcess: ChildProcessWithoutNullStreams | null = null
				try {
					const exePath = getWindowsCaptureExePath()
					const recordingsDir = await getRecordingsDir()
					const timestamp = Date.now()
					const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`)
					const displayBounds =
						source?.id?.startsWith("window:") ? null : getDisplayBoundsForSource(source)

					const config: Record<string, unknown> = {
						outputPath,
						fps: 60,
					}

					if (options?.capturesSystemAudio) {
						const audioPath = path.join(recordingsDir, `recording-${timestamp}.system.wav`)
						config.captureSystemAudio = true
						config.audioOutputPath = audioPath
						setWindowsSystemAudioPath(audioPath)
					}

					if (options?.capturesMicrophone) {
						const microphonePath = path.join(recordingsDir, `recording-${timestamp}.mic.wav`)
						config.captureMic = true
						config.micOutputPath = microphonePath
						if (options.microphoneLabel) {
							config.micDeviceName = options.microphoneLabel
						}
						setWindowsMicAudioPath(microphonePath)
					}

					const windowId = parseWindowId(source?.id)
					if (windowId && source?.id?.startsWith("window:")) {
						config.windowHandle = windowId
					} else {
						const resolvedDisplay = resolveWindowsCaptureDisplay(
							source,
							getScreen().getAllDisplays(),
							getScreen().getPrimaryDisplay(),
						)
						config.displayId = resolvedDisplay.displayId
						config.displayX = Math.round(resolvedDisplay.bounds.x)
						config.displayY = Math.round(resolvedDisplay.bounds.y)
						config.displayW = Math.round(resolvedDisplay.bounds.width)
						config.displayH = Math.round(resolvedDisplay.bounds.height)
					}

					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						displayId: typeof config.displayId === "number" ? config.displayId : null,
						displayBounds,
						windowHandle:
							typeof config.windowHandle === "number" ? config.windowHandle : null,
						helperPath: exePath,
						outputPath,
						systemAudioPath: windowsSystemAudioPath,
						microphonePath: windowsMicAudioPath,
					})

					setWindowsCaptureOutputBuffer("")
					setWindowsCaptureTargetPath(outputPath)
					setWindowsCaptureStopRequested(false)
					setWindowsCapturePaused(false)
					windowsProcess = spawn(exePath, [JSON.stringify(config)], {
						cwd: recordingsDir,
						stdio: ["pipe", "pipe", "pipe"],
					})
					setWindowsCaptureProcess(windowsProcess)
					attachWindowsCaptureLifecycle(windowsProcess)

					windowsProcess.stdout.on("data", (chunk: Buffer) => {
						setWindowsCaptureOutputBuffer(windowsCaptureOutputBuffer + chunk.toString())
					})
					windowsProcess.stderr.on("data", (chunk: Buffer) => {
						setWindowsCaptureOutputBuffer(windowsCaptureOutputBuffer + chunk.toString())
					})

					await waitForWindowsCaptureStart(windowsProcess)
					setWindowsNativeCaptureActive(true)
					setRecordingActive(true)
					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						displayId: typeof config.displayId === "number" ? config.displayId : null,
						displayBounds,
						windowHandle:
							typeof config.windowHandle === "number" ? config.windowHandle : null,
						helperPath: exePath,
						outputPath,
						systemAudioPath: windowsSystemAudioPath,
						microphonePath: windowsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
					})
					return { success: true }
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
					})
					console.error("Failed to start native Windows capture:", error)
					try {
						windowsProcess?.kill()
					} catch {
						// ignore cleanup failures
					}
					setWindowsNativeCaptureActive(false)
					setRecordingActive(false)
					setWindowsCaptureProcess(null)
					setWindowsCaptureTargetPath(null)
					setWindowsCaptureStopRequested(false)
					setWindowsCapturePaused(false)
					return {
						success: false,
						message: "Failed to start native Windows capture",
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

			if (nativeCaptureProcess && !nativeScreenRecordingActive) {
				try {
					nativeCaptureProcess.kill()
				} catch {
					// ignore stale helper cleanup failures
				}
				setNativeCaptureProcess(null)
				setNativeCaptureTargetPath(null)
				setNativeCaptureStopRequested(false)
			}

			if (nativeCaptureProcess) {
				return {
					success: false,
					message: "A native screen recording is already active.",
				}
			}

			let nativeProcess: ChildProcessWithoutNullStreams | null = null
			try {
				const recordingsDir = await getRecordingsDir()

				try {
					await desktopCapturer.getSources({
						types: ["screen"],
						thumbnailSize: { width: 1, height: 1 },
					})
				} catch {
					// non-fatal – the helper will report its own permission status
				}

				if (options?.capturesMicrophone) {
					const microphoneStatus = systemPreferences.getMediaAccessStatus("microphone")
					if (microphoneStatus !== "granted") {
						await systemPreferences.askForMediaAccess("microphone")
					}
				}

				const appName = normalizeDesktopSourceName(String(source?.appName ?? ""))
				const ownAppName = normalizeDesktopSourceName(app.getName())
				if (
					!ALLOW_RECORDLY_WINDOW_CAPTURE &&
					source?.id?.startsWith("window:") &&
					appName &&
					(appName === ownAppName || appName === "recordly")
				) {
					return {
						success: false,
						message:
							"Cannot record Recordly windows. Please select another app window.",
					}
				}

				const helperPath = await ensureNativeCaptureHelperBinary()
				const timestamp = Date.now()
				const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`)
				const capturesSystemAudio = Boolean(options?.capturesSystemAudio)
				const capturesMicrophone = Boolean(options?.capturesMicrophone)
				const systemAudioOutputPath = capturesSystemAudio
					? path.join(recordingsDir, `recording-${timestamp}.system.m4a`)
					: null
				const microphoneOutputPath = capturesMicrophone
					? path.join(recordingsDir, `recording-${timestamp}.mic.m4a`)
					: null
				const config: Record<string, unknown> = {
					fps: 60,
					outputPath,
					capturesSystemAudio,
					capturesMicrophone,
				}

				if (options?.microphoneDeviceId) {
					config.microphoneDeviceId = options.microphoneDeviceId
				}

				if (options?.microphoneLabel) {
					config.microphoneLabel = options.microphoneLabel
				}

				if (systemAudioOutputPath) {
					config.systemAudioOutputPath = systemAudioOutputPath
				}

				if (microphoneOutputPath) {
					config.microphoneOutputPath = microphoneOutputPath
				}

				const windowId = parseWindowId(source?.id)
				const screenId = Number(source?.display_id)

				if (Number.isFinite(windowId) && windowId && source?.id?.startsWith("window:")) {
					config.windowId = windowId
				} else if (Number.isFinite(screenId) && screenId > 0) {
					config.displayId = screenId
				} else {
					config.displayId = Number(getScreen().getPrimaryDisplay().id)
				}

				setNativeCaptureOutputBuffer("")
				setNativeCaptureTargetPath(outputPath)
				setNativeCaptureSystemAudioPath(systemAudioOutputPath)
				setNativeCaptureMicrophonePath(microphoneOutputPath)
				setNativeCaptureStopRequested(false)
				setNativeCapturePaused(false)
				nativeProcess = spawn(helperPath, [JSON.stringify(config)], {
					cwd: recordingsDir,
					stdio: ["pipe", "pipe", "pipe"],
				})
				setNativeCaptureProcess(nativeProcess)
				attachNativeCaptureLifecycle(nativeProcess)

				nativeProcess.stdout.on("data", (chunk: Buffer) => {
					setNativeCaptureOutputBuffer(nativeCaptureOutputBuffer + chunk.toString())
				})
				nativeProcess.stderr.on("data", (chunk: Buffer) => {
					setNativeCaptureOutputBuffer(nativeCaptureOutputBuffer + chunk.toString())
				})

				await waitForNativeCaptureStart(nativeProcess)
				setNativeScreenRecordingActive(true)

				const microphoneUnavailableNatively = nativeCaptureOutputBuffer.includes(
					"MICROPHONE_CAPTURE_UNAVAILABLE",
				)
				if (microphoneUnavailableNatively) {
					setNativeCaptureMicrophonePath(null)
				}

				recordNativeCaptureDiagnostics({
					backend: "mac-screencapturekit",
					phase: "start",
					sourceId: source?.id ?? null,
					sourceType: source?.sourceType ?? "unknown",
					displayId: typeof config.displayId === "number" ? config.displayId : null,
					helperPath,
					outputPath,
					systemAudioPath: systemAudioOutputPath,
					microphonePath: nativeCaptureMicrophonePath,
					processOutput: nativeCaptureOutputBuffer.trim() || undefined,
				})
				return {
					success: true,
					microphoneFallbackRequired: microphoneUnavailableNatively,
				}
			} catch (error) {
				console.error("Failed to start native ScreenCaptureKit recording:", error)
				const errorString = String(error)

				if (
					errorString.includes("declined TCC") ||
					errorString.includes("declined TCCs") ||
					errorString.includes("SCREEN_RECORDING_PERMISSION_DENIED")
				) {
					const { response } = await dialog.showMessageBox({
						type: "warning",
						title: "Screen Recording Permission Required",
						message: "Recordly needs screen recording permission to capture your screen.",
						detail:
							"Please open System Settings > Privacy & Security > Screen Recording, make sure Recordly is toggled ON, then try recording again.",
						buttons: ["Open System Settings", "Cancel"],
						defaultId: 0,
						cancelId: 1,
					})
					if (response === 0) {
						await shell.openExternal(getMacPrivacySettingsUrl("screen"))
					}
					try {
						nativeProcess?.kill()
					} catch {
						// ignore cleanup failures
					}
					setNativeScreenRecordingActive(false)
					setNativeCaptureProcess(null)
					setNativeCaptureTargetPath(null)
					setNativeCaptureSystemAudioPath(null)
					setNativeCaptureMicrophonePath(null)
					setNativeCaptureStopRequested(false)
					setNativeCapturePaused(false)
					return {
						success: false,
						message:
							"Screen recording permission not granted. Please allow access in System Settings and restart the app.",
						userNotified: true,
					}
				}

				if (errorString.includes("MICROPHONE_PERMISSION_DENIED")) {
					const { response } = await dialog.showMessageBox({
						type: "warning",
						title: "Microphone Permission Required",
						message: "Recordly needs microphone permission to record audio.",
						detail:
							"Please open System Settings > Privacy & Security > Microphone, make sure Recordly is toggled ON, then try recording again.",
						buttons: ["Open System Settings", "Cancel"],
						defaultId: 0,
						cancelId: 1,
					})
					if (response === 0) {
						await shell.openExternal(getMacPrivacySettingsUrl("microphone"))
					}
					try {
						nativeProcess?.kill()
					} catch {
						// ignore cleanup failures
					}
					setNativeScreenRecordingActive(false)
					setNativeCaptureProcess(null)
					setNativeCaptureTargetPath(null)
					setNativeCaptureSystemAudioPath(null)
					setNativeCaptureMicrophonePath(null)
					setNativeCaptureStopRequested(false)
					setNativeCapturePaused(false)
					return {
						success: false,
						message:
							"Microphone permission not granted. Please allow access in System Settings.",
						userNotified: true,
					}
				}

				recordNativeCaptureDiagnostics({
					backend: "mac-screencapturekit",
					phase: "start",
					sourceId: source?.id ?? null,
					sourceType: source?.sourceType ?? "unknown",
					helperPath: await Promise.resolve().then(() => ensureNativeCaptureHelperBinary()).catch(() => null),
					outputPath: nativeCaptureTargetPath,
					systemAudioPath: nativeCaptureSystemAudioPath,
					microphonePath: nativeCaptureMicrophonePath,
					processOutput: nativeCaptureOutputBuffer.trim() || undefined,
					error: String(error),
				})
				try {
					nativeProcess?.kill()
				} catch {
					// ignore cleanup failures
				}
				setNativeScreenRecordingActive(false)
				setNativeCaptureProcess(null)
				setNativeCaptureTargetPath(null)
				setNativeCaptureSystemAudioPath(null)
				setNativeCaptureMicrophonePath(null)
				setNativeCaptureStopRequested(false)
				setNativeCapturePaused(false)
				return {
					success: false,
					message: "Failed to start native ScreenCaptureKit recording",
					error: String(error),
				}
			}
		},
	)
}