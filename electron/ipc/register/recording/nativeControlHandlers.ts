import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import { promisify } from "node:util"
import { ipcMain } from "electron"
import {
	cachedSystemCursorAssets,
	cachedSystemCursorAssetsSourceMtimeMs,
	lastNativeCaptureDiagnostics,
	nativeCapturePaused,
	nativeCaptureProcess,
	nativeScreenRecordingActive,
	setCachedSystemCursorAssets,
	setCachedSystemCursorAssetsSourceMtimeMs,
	setNativeCapturePaused,
	setWindowsCapturePaused,
	setWindowsMicAudioPath,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsCapturePaused,
	windowsCaptureProcess,
	windowsMicAudioPath,
	windowsNativeCaptureActive,
	windowsPendingVideoPath,
	windowsSystemAudioPath,
} from "../../state"
import type { PauseSegment } from "../../types"
import {
	ensureSwiftHelperBinary,
	getSystemCursorHelperBinaryPath,
	getSystemCursorHelperSourcePath,
} from "../../paths/binaries"
import { getCompanionAudioFallbackPaths, getFileSizeIfPresent, recordNativeCaptureDiagnostics } from "../../recording/diagnostics"
import { finalizeStoredVideo } from "../../recording/mac"
import {
	isNativeWindowsCaptureAvailable,
	muxNativeWindowsVideoWithAudio,
} from "../../recording/windows"
import { rememberApprovedLocalReadPath } from "../../project/manager"

const execFileAsync = promisify(execFile)

async function getSystemCursorAssets() {
	if (process.platform !== "darwin") {
		setCachedSystemCursorAssets({})
		setCachedSystemCursorAssetsSourceMtimeMs(null)
		return cachedSystemCursorAssets ?? {}
	}
	const sourcePath = getSystemCursorHelperSourcePath()
	const sourceStat = await fs.stat(sourcePath)
	if (cachedSystemCursorAssets && cachedSystemCursorAssetsSourceMtimeMs === sourceStat.mtimeMs) {
		return cachedSystemCursorAssets
	}
	const binaryPath = await ensureSwiftHelperBinary(
		sourcePath,
		getSystemCursorHelperBinaryPath(),
		"system cursor helper",
		"recordly-system-cursors",
	)
	const { stdout } = await execFileAsync(binaryPath, [], {
		timeout: 15000,
		maxBuffer: 20 * 1024 * 1024,
	})
	const parsed = JSON.parse(stdout) as Record<string, Partial<import("../../types").SystemCursorAsset>>
	const result = Object.fromEntries(
		Object.entries(parsed).filter(
			([, asset]) =>
				typeof asset?.dataUrl === "string" &&
				typeof asset?.hotspotX === "number" &&
				typeof asset?.hotspotY === "number" &&
				typeof asset?.width === "number" &&
				typeof asset?.height === "number",
		),
	) as Record<string, import("../../types").SystemCursorAsset>
	setCachedSystemCursorAssets(result)
	setCachedSystemCursorAssetsSourceMtimeMs(sourceStat.mtimeMs)
	return result
}

export function registerNativeRecordingControlHandlers() {
	ipcMain.handle("pause-native-screen-recording", async () => {
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: "No native Windows screen recording is active." }
			}

			if (windowsCapturePaused) {
				return { success: true }
			}

			try {
				windowsCaptureProcess.stdin.write("pause\n")
				setWindowsCapturePaused(true)
				return { success: true }
			} catch (error) {
				return {
					success: false,
					message: "Failed to pause native Windows capture",
					error: String(error),
				}
			}
		}

		if (process.platform !== "darwin") {
			return { success: false, message: "Native screen recording is only available on macOS." }
		}

		if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
			return { success: false, message: "No native screen recording is active." }
		}

		if (nativeCapturePaused) {
			return { success: true }
		}

		try {
			nativeCaptureProcess.stdin.write("pause\n")
			setNativeCapturePaused(true)
			return { success: true }
		} catch (error) {
			return {
				success: false,
				message: "Failed to pause native screen recording",
				error: String(error),
			}
		}
	})

	ipcMain.handle("resume-native-screen-recording", async () => {
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: "No native Windows screen recording is active." }
			}

			if (!windowsCapturePaused) {
				return { success: true }
			}

			try {
				windowsCaptureProcess.stdin.write("resume\n")
				setWindowsCapturePaused(false)
				return { success: true }
			} catch (error) {
				return {
					success: false,
					message: "Failed to resume native Windows capture",
					error: String(error),
				}
			}
		}

		if (process.platform !== "darwin") {
			return { success: false, message: "Native screen recording is only available on macOS." }
		}

		if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
			return { success: false, message: "No native screen recording is active." }
		}

		if (!nativeCapturePaused) {
			return { success: true }
		}

		try {
			nativeCaptureProcess.stdin.write("resume\n")
			setNativeCapturePaused(false)
			return { success: true }
		} catch (error) {
			return {
				success: false,
				message: "Failed to resume native screen recording",
				error: String(error),
			}
		}
	})

	ipcMain.handle("get-system-cursor-assets", async () => {
		try {
			return { success: true, cursors: await getSystemCursorAssets() }
		} catch (error) {
			console.error("Failed to load system cursor assets:", error)
			return { success: false, cursors: {}, error: String(error) }
		}
	})

	ipcMain.handle("is-native-windows-capture-available", async () => {
		return { available: await isNativeWindowsCaptureAvailable() }
	})

	ipcMain.handle("get-last-native-capture-diagnostics", async () => {
		return { success: true, diagnostics: lastNativeCaptureDiagnostics }
	})

	ipcMain.handle("get-video-audio-fallback-paths", async (_event, videoPath: string) => {
		if (!videoPath) {
			return { success: true, paths: [] }
		}

		try {
			const paths = await getCompanionAudioFallbackPaths(videoPath)
			await Promise.all([
				rememberApprovedLocalReadPath(videoPath),
				...paths.map((fallbackPath) => rememberApprovedLocalReadPath(fallbackPath)),
			])
			return { success: true, paths }
		} catch (error) {
			console.error("Failed to resolve companion audio fallback paths:", error)
			return { success: false, paths: [], error: String(error) }
		}
	})

	ipcMain.handle("mux-native-windows-recording", async (_event, pauseSegments?: PauseSegment[]) => {
		const videoPath = windowsPendingVideoPath
		setWindowsPendingVideoPath(null)

		if (!videoPath) {
			return { success: false, message: "No native Windows video pending for mux" }
		}

		try {
			if (windowsSystemAudioPath || windowsMicAudioPath) {
				await muxNativeWindowsVideoWithAudio(
					videoPath,
					windowsSystemAudioPath,
					windowsMicAudioPath,
					pauseSegments ?? [],
				)
				setWindowsSystemAudioPath(null)
				setWindowsMicAudioPath(null)
			}

			recordNativeCaptureDiagnostics({
				backend: "windows-wgc",
				phase: "mux",
				outputPath: videoPath,
				fileSizeBytes: await getFileSizeIfPresent(videoPath),
			})
			return await finalizeStoredVideo(videoPath)
		} catch (error) {
			console.error("Failed to mux native Windows recording:", error)
			recordNativeCaptureDiagnostics({
				backend: "windows-wgc",
				phase: "mux",
				outputPath: videoPath,
				systemAudioPath: windowsSystemAudioPath,
				microphonePath: windowsMicAudioPath,
				fileSizeBytes: await getFileSizeIfPresent(videoPath),
				error: String(error),
			})
			setWindowsSystemAudioPath(null)
			setWindowsMicAudioPath(null)
			try {
				return await finalizeStoredVideo(videoPath)
			} catch {
				return {
					success: false,
					message: "Failed to mux native Windows recording",
					error: String(error),
				}
			}
		}
	})
}