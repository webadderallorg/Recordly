import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	shell,
	systemPreferences,
} from "electron";
import { showCursor } from "../../cursorHider";
import { ALLOW_RECORDLY_WINDOW_CAPTURE } from "../constants";
import { startWindowBoundsCapture, stopWindowBoundsCapture } from "../cursor/bounds";
import { startInteractionCapture, stopInteractionCapture } from "../cursor/interaction";
import { startNativeCursorMonitor, stopNativeCursorMonitor } from "../cursor/monitor";
import {
	clamp,
	pauseCursorCapture,
	resumeCursorCapture,
	resetCursorCaptureClock,
	sampleCursorPoint,
	snapshotCursorTelemetryForPersistence,
	startCursorSampling,
	stopCursorCapture,
} from "../cursor/telemetry";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import {
	ensureNativeCaptureHelperBinary,
	ensureSwiftHelperBinary,
	getNativeCaptureHelperBinaryPath,
	getSystemCursorHelperBinaryPath,
	getSystemCursorHelperSourcePath,
	getWindowsCaptureExePath,
} from "../paths/binaries";
import { rememberApprovedLocalReadPath } from "../project/manager";
import {
	getCompanionAudioFallbackInfo,
	getFileSizeIfPresent,
	recordNativeCaptureDiagnostics,
	validateRecordedVideo,
} from "../recording/diagnostics";
import {
	buildFfmpegCaptureArgs,
	waitForFfmpegCaptureStart,
	waitForFfmpegCaptureStop,
} from "../recording/ffmpeg";
import {
	attachNativeCaptureLifecycle,
	finalizeStoredVideo,
	muxNativeMacRecordingWithAudio,
	recoverNativeMacCaptureOutput,
	waitForNativeCaptureStart,
	waitForNativeCaptureStop,
} from "../recording/mac";
import {
	attachWindowsCaptureLifecycle,
	isNativeWindowsCaptureAvailable,
	muxNativeWindowsVideoWithAudio,
	waitForWindowsCaptureStart,
	waitForWindowsCaptureStop,
} from "../recording/windows";
import { shouldUseWindowsBrowserMicrophoneFallback } from "../recording/windowsFallbacks";
import {
	cachedSystemCursorAssets,
	cachedSystemCursorAssetsSourceMtimeMs,
	currentVideoPath,
	ffmpegCaptureOutputBuffer,
	ffmpegCaptureProcess,
	ffmpegCaptureTargetPath,
	ffmpegScreenRecordingActive,
	lastNativeCaptureDiagnostics,
	nativeCaptureMicrophonePath,
	nativeCaptureOutputBuffer,
	nativeCapturePaused,
	nativeCaptureProcess,
	nativeCaptureSystemAudioPath,
	nativeCaptureTargetPath,
	nativeScreenRecordingActive,
	selectedSource,
	setActiveCursorSamples,
	setCachedSystemCursorAssets,
	setCachedSystemCursorAssetsSourceMtimeMs,
	setCursorCaptureStartTimeMs,
	setFfmpegCaptureOutputBuffer,
	setFfmpegCaptureProcess,
	setFfmpegCaptureTargetPath,
	setFfmpegScreenRecordingActive,
	setIsCursorCaptureActive,
	setLastLeftClick,
	setLinuxCursorScreenPoint,
	setNativeCaptureMicrophonePath,
	setNativeCaptureOutputBuffer,
	setNativeCapturePaused,
	setNativeCaptureProcess,
	setNativeCaptureStopRequested,
	setNativeCaptureSystemAudioPath,
	setNativeCaptureTargetPath,
	setNativeScreenRecordingActive,
	setPendingCursorSamples,
	setWindowsCaptureOutputBuffer,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsOrphanedMicAudioPath,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsCaptureOutputBuffer,
	windowsCapturePaused,
	windowsCaptureProcess,
	windowsCaptureTargetPath,
	windowsMicAudioPath,
	windowsNativeCaptureActive,
	windowsOrphanedMicAudioPath,
	windowsPendingVideoPath,
	windowsSystemAudioPath,
} from "../state";
import type {
	CursorTelemetryPoint,
	NativeMacRecordingOptions,
	PauseSegment,
	SelectedSource,
} from "../types";
import {
	getMacPrivacySettingsUrl,
	getRecordingsDir,
	getScreen,
	getTelemetryPathForVideo,
	moveFileWithOverwrite,
	normalizeVideoSourcePath,
	parseWindowId,
} from "../utils";
import { resolveWindowsCaptureDisplay } from "../windowsCaptureSelection";

const execFileAsync = promisify(execFile);

async function getSystemCursorAssets() {
	if (process.platform !== "darwin") {
		setCachedSystemCursorAssets({});
		setCachedSystemCursorAssetsSourceMtimeMs(null);
		return cachedSystemCursorAssets ?? {};
	}
	const sourcePath = getSystemCursorHelperSourcePath();
	const sourceStat = await fs.stat(sourcePath);
	if (cachedSystemCursorAssets && cachedSystemCursorAssetsSourceMtimeMs === sourceStat.mtimeMs) {
		return cachedSystemCursorAssets;
	}
	const binaryPath = await ensureSwiftHelperBinary(
		sourcePath,
		getSystemCursorHelperBinaryPath(),
		"system cursor helper",
		"recordly-system-cursors",
	);
	const { stdout } = await execFileAsync(binaryPath, [], {
		timeout: 15000,
		maxBuffer: 20 * 1024 * 1024,
	});
	const parsed = JSON.parse(stdout) as Record<
		string,
		Partial<import("../types").SystemCursorAsset>
	>;
	const result = Object.fromEntries(
		Object.entries(parsed).filter(
			([, asset]) =>
				typeof asset?.dataUrl === "string" &&
				typeof asset?.hotspotX === "number" &&
				typeof asset?.hotspotY === "number" &&
				typeof asset?.width === "number" &&
				typeof asset?.height === "number",
		),
	) as Record<string, import("../types").SystemCursorAsset>;
	setCachedSystemCursorAssets(result);
	setCachedSystemCursorAssetsSourceMtimeMs(sourceStat.mtimeMs);
	return result;
}

function normalizeDesktopSourceName(value: string) {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function cleanupWindowsOrphanedMicAudioPath(filePath: string | null) {
	if (!filePath) {
		return;
	}

	await fs.rm(filePath, { force: true }).catch(() => undefined);
}

export function registerRecordingHandlers(
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
	ipcMain.handle(
		"start-native-screen-recording",
		async (_, source: SelectedSource, options?: NativeMacRecordingOptions) => {
			// Windows native capture path
			if (process.platform === "win32") {
				const windowsCaptureAvailable = await isNativeWindowsCaptureAvailable();
				if (!windowsCaptureAvailable) {
					return {
						success: false,
						message: "Native Windows capture is not available on this system.",
					};
				}

				if (windowsCaptureProcess && !windowsNativeCaptureActive) {
					try {
						windowsCaptureProcess.kill();
					} catch {
						/* ignore */
					}
					setWindowsCaptureProcess(null);
					setWindowsCaptureTargetPath(null);
					setWindowsCaptureStopRequested(false);
				}

				if (windowsCaptureProcess) {
					return {
						success: false,
						message: "A native Windows screen recording is already active.",
					};
				}

				let wcProc: ChildProcessWithoutNullStreams | null = null;
				try {
					const exePath = getWindowsCaptureExePath();
					const recordingsDir = await getRecordingsDir();
					const timestamp = Date.now();
					const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`);
					let captureOutput = "";
					let systemAudioPath: string | null = null;
					let microphonePath: string | null = null;
					let orphanedMicAudioPath: string | null = null;
					const resolvedDisplay = resolveWindowsCaptureDisplay(
						source,
						getScreen().getAllDisplays(),
						getScreen().getPrimaryDisplay(),
					);
					const displayBounds = resolvedDisplay.bounds;
					setWindowsOrphanedMicAudioPath(null);

					const config: Record<string, unknown> = {
						outputPath,
						fps: 60,
						displayId: resolvedDisplay.displayId,
						displayX: Math.round(resolvedDisplay.bounds.x),
						displayY: Math.round(resolvedDisplay.bounds.y),
						displayW: Math.round(resolvedDisplay.bounds.width),
						displayH: Math.round(resolvedDisplay.bounds.height),
					};

					if (options?.capturesSystemAudio) {
						systemAudioPath = path.join(
							recordingsDir,
							`recording-${timestamp}.system.wav`,
						);
						config.captureSystemAudio = true;
						config.audioOutputPath = systemAudioPath;
						setWindowsSystemAudioPath(systemAudioPath);
					}

					if (options?.capturesMicrophone) {
						microphonePath = path.join(recordingsDir, `recording-${timestamp}.mic.wav`);
						config.captureMic = true;
						config.micOutputPath = microphonePath;
						if (options.microphoneLabel) {
							config.micDeviceName = options.microphoneLabel;
						}
						setWindowsMicAudioPath(microphonePath);
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
						systemAudioPath,
						microphonePath,
					});

					setWindowsCaptureOutputBuffer("");
					setWindowsCaptureTargetPath(outputPath);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);
					wcProc = spawn(exePath, [JSON.stringify(config)], {
						cwd: recordingsDir,
						stdio: ["pipe", "pipe", "pipe"],
					});
					setWindowsCaptureProcess(wcProc);
					attachWindowsCaptureLifecycle(wcProc);

					wcProc.stdout.on("data", (chunk: Buffer) => {
						captureOutput += chunk.toString();
						setWindowsCaptureOutputBuffer(captureOutput);
					});
					wcProc.stderr.on("data", (chunk: Buffer) => {
						captureOutput += chunk.toString();
						setWindowsCaptureOutputBuffer(captureOutput);
					});

					await waitForWindowsCaptureStart(wcProc);
					const microphoneFallbackRequired = shouldUseWindowsBrowserMicrophoneFallback(
						captureOutput,
						options,
					);
					if (microphoneFallbackRequired) {
						orphanedMicAudioPath = microphonePath;
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
						windowHandle:
							typeof config.windowHandle === "number" ? config.windowHandle : null,
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
					setWindowsNativeCaptureActive(false);
					setNativeScreenRecordingActive(false);
					setWindowsCaptureProcess(null);
					setWindowsCaptureTargetPath(null);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);
					return {
						success: false,
						message: "Failed to start native Windows capture",
						error: String(error),
					};
				}
			}

			if (process.platform !== "darwin") {
				return {
					success: false,
					message: "Native screen recording is only available on macOS.",
				};
			}

			if (nativeCaptureProcess && !nativeScreenRecordingActive) {
				try {
					nativeCaptureProcess.kill();
				} catch {
					// ignore stale helper cleanup failures
				}
				setNativeCaptureProcess(null);
				setNativeCaptureTargetPath(null);
				setNativeCaptureStopRequested(false);
			}

			if (nativeCaptureProcess) {
				return { success: false, message: "A native screen recording is already active." };
			}

			let captProc: ChildProcessWithoutNullStreams | null = null;
			try {
				const recordingsDir = await getRecordingsDir();

				// Warm up TCC: trigger an Electron-level screen capture API call so macOS
				// activates the screen-recording grant for this process tree before the
				// native helper binary spawns and calls SCStream.startCapture().
				try {
					await desktopCapturer.getSources({
						types: ["screen"],
						thumbnailSize: { width: 1, height: 1 },
					});
				} catch {
					// non-fatal – the helper will report its own TCC status
				}

				// Ensure microphone TCC is granted for this process tree when mic capture
				// is requested, so the child helper inherits the grant.
				if (options?.capturesMicrophone) {
					const micStatus = systemPreferences.getMediaAccessStatus("microphone");
					if (micStatus !== "granted") {
						await systemPreferences.askForMediaAccess("microphone");
					}
				}

				const appName = normalizeDesktopSourceName(String(source?.appName ?? ""));
				const ownAppName = normalizeDesktopSourceName(app.getName());
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
					};
				}

				const helperPath = await ensureNativeCaptureHelperBinary();
				const timestamp = Date.now();
				const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`);
				const capturesSystemAudio = Boolean(options?.capturesSystemAudio);
				const capturesMicrophone = Boolean(options?.capturesMicrophone);
				const systemAudioOutputPath = capturesSystemAudio
					? path.join(recordingsDir, `recording-${timestamp}.system.m4a`)
					: null;
				const microphoneOutputPath = capturesMicrophone
					? path.join(recordingsDir, `recording-${timestamp}.mic.m4a`)
					: null;
				const config: Record<string, unknown> = {
					fps: 60,
					outputPath,
					capturesSystemAudio,
					capturesMicrophone,
				};

				if (options?.microphoneDeviceId) {
					config.microphoneDeviceId = options.microphoneDeviceId;
				}

				if (options?.microphoneLabel) {
					config.microphoneLabel = options.microphoneLabel;
				}

				if (systemAudioOutputPath) {
					config.systemAudioOutputPath = systemAudioOutputPath;
				}

				if (microphoneOutputPath) {
					config.microphoneOutputPath = microphoneOutputPath;
				}

				const windowId = parseWindowId(source?.id);
				const screenId = Number(source?.display_id);

				if (Number.isFinite(windowId) && windowId && source?.id?.startsWith("window:")) {
					config.windowId = windowId;
				} else if (Number.isFinite(screenId) && screenId > 0) {
					config.displayId = screenId;
				} else {
					config.displayId = Number(getScreen().getPrimaryDisplay().id);
				}

				setNativeCaptureOutputBuffer("");
				setNativeCaptureTargetPath(outputPath);
				setNativeCaptureSystemAudioPath(systemAudioOutputPath);
				setNativeCaptureMicrophonePath(microphoneOutputPath);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);
				captProc = spawn(helperPath, [JSON.stringify(config)], {
					cwd: recordingsDir,
					stdio: ["pipe", "pipe", "pipe"],
				});
				setNativeCaptureProcess(captProc);
				attachNativeCaptureLifecycle(captProc);

				captProc.stdout.on("data", (chunk: Buffer) => {
					setNativeCaptureOutputBuffer(nativeCaptureOutputBuffer + chunk.toString());
				});
				captProc.stderr.on("data", (chunk: Buffer) => {
					setNativeCaptureOutputBuffer(nativeCaptureOutputBuffer + chunk.toString());
				});

				await waitForNativeCaptureStart(captProc);
				setNativeScreenRecordingActive(true);

				// If the native helper reported MICROPHONE_CAPTURE_UNAVAILABLE, it started
				// capture without microphone.  Clear the mic path so the renderer can fall
				// back to a browser-side sidecar recording for the microphone track.
				const micUnavailableNatively = nativeCaptureOutputBuffer.includes(
					"MICROPHONE_CAPTURE_UNAVAILABLE",
				);
				if (micUnavailableNatively) {
					setNativeCaptureMicrophonePath(null);
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
				});
				return { success: true, microphoneFallbackRequired: micUnavailableNatively };
			} catch (error) {
				console.error("Failed to start native ScreenCaptureKit recording:", error);
				const errorStr = String(error);

				// Detect TCC (screen recording permission) errors and show a helpful dialog
				if (
					errorStr.includes("declined TCC") ||
					errorStr.includes("declined TCCs") ||
					errorStr.includes("SCREEN_RECORDING_PERMISSION_DENIED")
				) {
					const { response } = await dialog.showMessageBox({
						type: "warning",
						title: "Screen Recording Permission Required",
						message:
							"Recordly needs screen recording permission to capture your screen.",
						detail: "Please open System Settings > Privacy & Security > Screen Recording, make sure Recordly is toggled ON, then try recording again.",
						buttons: ["Open System Settings", "Cancel"],
						defaultId: 0,
						cancelId: 1,
					});
					if (response === 0) {
						await shell.openExternal(getMacPrivacySettingsUrl("screen"));
					}
					try {
						if (captProc) captProc.kill();
					} catch {
						/* ignore */
					}
					setNativeScreenRecordingActive(false);
					setNativeCaptureProcess(null);
					setNativeCaptureTargetPath(null);
					setNativeCaptureSystemAudioPath(null);
					setNativeCaptureMicrophonePath(null);
					setNativeCaptureStopRequested(false);
					setNativeCapturePaused(false);
					return {
						success: false,
						message:
							"Screen recording permission not granted. Please allow access in System Settings and restart the app.",
						userNotified: true,
					};
				}

				if (errorStr.includes("MICROPHONE_PERMISSION_DENIED")) {
					const { response } = await dialog.showMessageBox({
						type: "warning",
						title: "Microphone Permission Required",
						message: "Recordly needs microphone permission to record audio.",
						detail: "Please open System Settings > Privacy & Security > Microphone, make sure Recordly is toggled ON, then try recording again.",
						buttons: ["Open System Settings", "Cancel"],
						defaultId: 0,
						cancelId: 1,
					});
					if (response === 0) {
						await shell.openExternal(getMacPrivacySettingsUrl("microphone"));
					}
					try {
						if (captProc) captProc.kill();
					} catch {
						/* ignore */
					}
					setNativeScreenRecordingActive(false);
					setNativeCaptureProcess(null);
					setNativeCaptureTargetPath(null);
					setNativeCaptureSystemAudioPath(null);
					setNativeCaptureMicrophonePath(null);
					setNativeCaptureStopRequested(false);
					setNativeCapturePaused(false);
					return {
						success: false,
						message:
							"Microphone permission not granted. Please allow access in System Settings.",
						userNotified: true,
					};
				}

				recordNativeCaptureDiagnostics({
					backend: "mac-screencapturekit",
					phase: "start",
					sourceId: source?.id ?? null,
					sourceType: source?.sourceType ?? "unknown",
					helperPath: getNativeCaptureHelperBinaryPath(),
					outputPath: nativeCaptureTargetPath,
					systemAudioPath: nativeCaptureSystemAudioPath,
					microphonePath: nativeCaptureMicrophonePath,
					processOutput: nativeCaptureOutputBuffer.trim() || undefined,
					fileSizeBytes: await getFileSizeIfPresent(nativeCaptureTargetPath),
					error: String(error),
				});
				try {
					if (captProc) captProc.kill();
				} catch {
					// ignore cleanup failures
				}
				setNativeScreenRecordingActive(false);
				setNativeCaptureProcess(null);
				setNativeCaptureTargetPath(null);
				setNativeCaptureSystemAudioPath(null);
				setNativeCaptureMicrophonePath(null);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);
				return {
					success: false,
					message: "Failed to start native ScreenCaptureKit recording",
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle("stop-native-screen-recording", async () => {
		// Windows native capture stop path
		if (process.platform === "win32" && windowsNativeCaptureActive) {
			try {
				if (!windowsCaptureProcess) {
					throw new Error("Native Windows capture process is not running");
				}

				const proc = windowsCaptureProcess;
				const preferredVideoPath = windowsCaptureTargetPath;
				const preferredOrphanedMicAudioPath = windowsOrphanedMicAudioPath;
				setWindowsCaptureStopRequested(true);
				proc.stdin.write("stop\n");
				const tempVideoPath = await waitForWindowsCaptureStop(proc);

				const finalVideoPath = preferredVideoPath ?? tempVideoPath;
				if (tempVideoPath !== finalVideoPath) {
					await moveFileWithOverwrite(tempVideoPath, finalVideoPath);
				}
				const validation = await validateRecordedVideo(finalVideoPath);

				setWindowsCaptureProcess(null);
				setWindowsNativeCaptureActive(false);
				setNativeScreenRecordingActive(false);
				setWindowsCaptureTargetPath(null);
				setWindowsCaptureStopRequested(false);
				setWindowsCapturePaused(false);
				setWindowsOrphanedMicAudioPath(null);
				await cleanupWindowsOrphanedMicAudioPath(preferredOrphanedMicAudioPath);
				setWindowsPendingVideoPath(finalVideoPath);
				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "stop",
					outputPath: finalVideoPath,
					systemAudioPath: windowsSystemAudioPath,
					microphonePath: windowsMicAudioPath,
					processOutput: windowsCaptureOutputBuffer.trim() || undefined,
					fileSizeBytes: validation.fileSizeBytes,
				});
				return { success: true, path: finalVideoPath };
			} catch (error) {
				console.error("Failed to stop native Windows capture:", error);
				const fallbackPath = windowsCaptureTargetPath;
				const fallbackOrphanedMicAudioPath = windowsOrphanedMicAudioPath;
				setWindowsNativeCaptureActive(false);
				setNativeScreenRecordingActive(false);
				setWindowsCaptureProcess(null);
				setWindowsCaptureTargetPath(null);
				setWindowsCaptureStopRequested(false);
				setWindowsCapturePaused(false);
				setWindowsSystemAudioPath(null);
				setWindowsMicAudioPath(null);
				setWindowsOrphanedMicAudioPath(null);
				setWindowsPendingVideoPath(null);
				await cleanupWindowsOrphanedMicAudioPath(fallbackOrphanedMicAudioPath);

				if (fallbackPath) {
					try {
						await fs.access(fallbackPath);
						const validation = await validateRecordedVideo(fallbackPath);
						setWindowsPendingVideoPath(fallbackPath);
						recordNativeCaptureDiagnostics({
							backend: "windows-wgc",
							phase: "stop",
							outputPath: fallbackPath,
							systemAudioPath: windowsSystemAudioPath,
							microphonePath: windowsMicAudioPath,
							processOutput: windowsCaptureOutputBuffer.trim() || undefined,
							fileSizeBytes: validation.fileSizeBytes,
							error: String(error),
						});
						return { success: true, path: fallbackPath };
					} catch {
						// File is absent or failed validation.
					}
				}

				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "stop",
					outputPath: fallbackPath,
					systemAudioPath: windowsSystemAudioPath,
					microphonePath: windowsMicAudioPath,
					processOutput: windowsCaptureOutputBuffer.trim() || undefined,
					fileSizeBytes: await getFileSizeIfPresent(fallbackPath),
					error: String(error),
				});

				return {
					success: false,
					message: "Failed to stop native Windows capture",
					error: String(error),
				};
			}
		}

		if (process.platform !== "darwin") {
			return {
				success: false,
				message: "Native screen recording is only available on macOS.",
			};
		}

		if (!nativeScreenRecordingActive) {
			const recovered = await recoverNativeMacCaptureOutput();
			if (recovered) {
				return recovered;
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
					return await finalizeStoredVideo(fallbackPath);
				} catch {
					// File doesn't exist or isn't accessible
				}
			}

			const recovered = await recoverNativeMacCaptureOutput();
			if (recovered) {
				return recovered;
			}

			return {
				success: false,
				message: "Failed to stop native ScreenCaptureKit recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("recover-native-screen-recording", async () => {
		if (process.platform !== "darwin") {
			return {
				success: false,
				message: "Native screen recording recovery is only available on macOS.",
			};
		}

		const recovered = await recoverNativeMacCaptureOutput();
		if (recovered) {
			return recovered;
		}

		return {
			success: false,
			message: "No recoverable native macOS recording output was found.",
		};
	});

	ipcMain.handle("pause-native-screen-recording", async () => {
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: "No native Windows screen recording is active." };
			}

			if (windowsCapturePaused) {
				return { success: true };
			}

			try {
				windowsCaptureProcess.stdin.write("pause\n");
				setWindowsCapturePaused(true);
				return { success: true };
			} catch (error) {
				return {
					success: false,
					message: "Failed to pause native Windows capture",
					error: String(error),
				};
			}
		}

		if (process.platform !== "darwin") {
			return {
				success: false,
				message: "Native screen recording is only available on macOS.",
			};
		}

		if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
			return { success: false, message: "No native screen recording is active." };
		}

		if (nativeCapturePaused) {
			return { success: true };
		}

		try {
			nativeCaptureProcess.stdin.write("pause\n");
			setNativeCapturePaused(true);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				message: "Failed to pause native screen recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("resume-native-screen-recording", async () => {
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: "No native Windows screen recording is active." };
			}

			if (!windowsCapturePaused) {
				return { success: true };
			}

			try {
				windowsCaptureProcess.stdin.write("resume\n");
				setWindowsCapturePaused(false);
				return { success: true };
			} catch (error) {
				return {
					success: false,
					message: "Failed to resume native Windows capture",
					error: String(error),
				};
			}
		}

		if (process.platform !== "darwin") {
			return {
				success: false,
				message: "Native screen recording is only available on macOS.",
			};
		}

		if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
			return { success: false, message: "No native screen recording is active." };
		}

		if (!nativeCapturePaused) {
			return { success: true };
		}

		try {
			nativeCaptureProcess.stdin.write("resume\n");
			setNativeCapturePaused(false);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				message: "Failed to resume native screen recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-system-cursor-assets", async () => {
		try {
			return { success: true, cursors: await getSystemCursorAssets() };
		} catch (error) {
			console.error("Failed to load system cursor assets:", error);
			return { success: false, cursors: {}, error: String(error) };
		}
	});

	ipcMain.handle("is-native-windows-capture-available", async () => {
		return { available: await isNativeWindowsCaptureAvailable() };
	});

	ipcMain.handle("get-last-native-capture-diagnostics", async () => {
		return { success: true, diagnostics: lastNativeCaptureDiagnostics };
	});

	ipcMain.handle("get-video-audio-fallback-paths", async (_event, videoPath: string) => {
		if (!videoPath) {
			return { success: true, paths: [], startDelayMsByPath: {} };
		}

		try {
			const { paths, startDelayMsByPath } = await getCompanionAudioFallbackInfo(videoPath);
			await Promise.all([
				rememberApprovedLocalReadPath(videoPath),
				...paths.map((fallbackPath) => rememberApprovedLocalReadPath(fallbackPath)),
			]);
			return { success: true, paths, startDelayMsByPath };
		} catch (error) {
			console.error("Failed to resolve companion audio fallback paths:", error);
			return { success: false, paths: [], startDelayMsByPath: {}, error: String(error) };
		}
	});

	ipcMain.handle(
		"mux-native-windows-recording",
		async (_event, pauseSegments?: PauseSegment[]) => {
			const videoPath = windowsPendingVideoPath;
			const orphanedMicAudioPath = windowsOrphanedMicAudioPath;
			setWindowsPendingVideoPath(null);
			setWindowsOrphanedMicAudioPath(null);

			if (!videoPath) {
				return { success: false, message: "No native Windows video pending for mux" };
			}

			try {
				if (windowsSystemAudioPath || windowsMicAudioPath) {
					await muxNativeWindowsVideoWithAudio(
						videoPath,
						windowsSystemAudioPath,
						windowsMicAudioPath,
						pauseSegments ?? [],
					);
					setWindowsSystemAudioPath(null);
					setWindowsMicAudioPath(null);
				}

				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "mux",
					outputPath: videoPath,
					fileSizeBytes: await getFileSizeIfPresent(videoPath),
				});
				await cleanupWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
				return await finalizeStoredVideo(videoPath);
			} catch (error) {
				console.error("Failed to mux native Windows recording:", error);
				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "mux",
					outputPath: videoPath,
					systemAudioPath: windowsSystemAudioPath,
					microphonePath: windowsMicAudioPath,
					fileSizeBytes: await getFileSizeIfPresent(videoPath),
					error: String(error),
				});
				setWindowsSystemAudioPath(null);
				setWindowsMicAudioPath(null);
				await cleanupWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
				try {
					return await finalizeStoredVideo(videoPath);
				} catch {
					return {
						success: false,
						message: "Failed to mux native Windows recording",
						error: String(error),
					};
				}
			}
		},
	);

	ipcMain.handle("start-ffmpeg-recording", async (_, source: SelectedSource) => {
		if (ffmpegCaptureProcess) {
			return { success: false, message: "An FFmpeg recording is already active." };
		}

		try {
			const recordingsDir = await getRecordingsDir();
			const ffmpegPath = getFfmpegBinaryPath();
			const outputPath = path.join(recordingsDir, `recording-${Date.now()}.mp4`);
			const args = await buildFfmpegCaptureArgs(source, outputPath);

			setFfmpegCaptureOutputBuffer("");
			setFfmpegCaptureTargetPath(outputPath);
			const ffProc = spawn(ffmpegPath, args, {
				cwd: recordingsDir,
				stdio: ["pipe", "pipe", "pipe"],
			});
			setFfmpegCaptureProcess(ffProc);

			ffProc.stdout.on("data", (chunk: Buffer) => {
				setFfmpegCaptureOutputBuffer(ffmpegCaptureOutputBuffer + chunk.toString());
			});
			ffProc.stderr.on("data", (chunk: Buffer) => {
				setFfmpegCaptureOutputBuffer(ffmpegCaptureOutputBuffer + chunk.toString());
			});

			await waitForFfmpegCaptureStart(ffProc);
			setFfmpegScreenRecordingActive(true);
			return { success: true };
		} catch (error) {
			console.error("Failed to start FFmpeg recording:", error);
			setFfmpegScreenRecordingActive(false);
			setFfmpegCaptureProcess(null);
			setFfmpegCaptureTargetPath(null);
			return {
				success: false,
				message: "Failed to start FFmpeg recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("stop-ffmpeg-recording", async () => {
		if (!ffmpegScreenRecordingActive) {
			return { success: false, message: "No FFmpeg recording is active." };
		}

		try {
			if (!ffmpegCaptureProcess || !ffmpegCaptureTargetPath) {
				throw new Error("FFmpeg process is not running");
			}

			const process = ffmpegCaptureProcess;
			const outputPath = ffmpegCaptureTargetPath;
			process.stdin.write("q\n");
			const finalVideoPath = await waitForFfmpegCaptureStop(process, outputPath);

			setFfmpegCaptureProcess(null);
			setFfmpegCaptureTargetPath(null);
			setFfmpegScreenRecordingActive(false);

			return await finalizeStoredVideo(finalVideoPath);
		} catch (error) {
			console.error("Failed to stop FFmpeg recording:", error);
			try {
				ffmpegCaptureProcess?.kill();
			} catch {
				// ignore cleanup failures
			}
			setFfmpegCaptureProcess(null);
			setFfmpegCaptureTargetPath(null);
			setFfmpegScreenRecordingActive(false);
			return {
				success: false,
				message: "Failed to stop FFmpeg recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle(
		"store-microphone-sidecar",
		async (
			_,
			audioData: ArrayBuffer,
			videoPath: string,
			options?: { startDelayMs?: number },
		) => {
			try {
				const baseName = videoPath.replace(/\.[^.]+$/, "");
				const sidecarPath = `${baseName}.mic.webm`;
				await fs.writeFile(sidecarPath, Buffer.from(audioData));
				const startDelayMs = options?.startDelayMs;
				if (Number.isFinite(startDelayMs) && (startDelayMs ?? 0) >= 0) {
					try {
						await fs.writeFile(
							`${sidecarPath}.json`,
							JSON.stringify({ startDelayMs: Math.round(startDelayMs ?? 0) }),
						);
					} catch (metadataError) {
						console.warn(
							"Failed to store microphone sidecar timing metadata:",
							metadataError,
						);
					}
				}
				return { success: true, path: sidecarPath };
			} catch (error) {
				console.error("Failed to store microphone sidecar:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle("store-recorded-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			const recordingsDir = await getRecordingsDir();
			const videoPath = path.join(recordingsDir, fileName);
			await fs.writeFile(videoPath, Buffer.from(videoData));
			return await finalizeStoredVideo(videoPath);
		} catch (error) {
			console.error("Failed to store video:", error);
			return {
				success: false,
				message: "Failed to store video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-recorded-video-path", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
			const candidates = await Promise.all(
				entries
					.filter(
						(entry) =>
							entry.isFile() && /^recording-\d+\.(webm|mov|mp4)$/i.test(entry.name),
					)
					.map(async (entry) => {
						const fullPath = path.join(recordingsDir, entry.name);
						const stat = await fs.stat(fullPath).catch(() => null);
						return stat ? { path: fullPath, mtimeMs: stat.mtimeMs } : null;
					}),
			);
			const sortedCandidates = candidates
				.filter(
					(candidate): candidate is { path: string; mtimeMs: number } =>
						candidate !== null,
				)
				.sort((left, right) => right.mtimeMs - left.mtimeMs);

			for (const candidate of sortedCandidates) {
				try {
					await validateRecordedVideo(candidate.path);
					return { success: true, path: candidate.path };
				} catch (error) {
					console.warn(
						"Skipping unusable recovered recording candidate:",
						candidate.path,
						error,
					);
				}
			}

			if (sortedCandidates.length === 0) {
				return { success: false, message: "No recorded video found" };
			}

			return { success: false, message: "No usable recorded video found" };
		} catch (error) {
			console.error("Failed to get video path:", error);
			return { success: false, message: "Failed to get video path", error: String(error) };
		}
	});

	ipcMain.handle("set-recording-state", (_, recording: boolean) => {
		if (recording) {
			stopCursorCapture();
			stopInteractionCapture();
			startWindowBoundsCapture();
			void startNativeCursorMonitor();
			setIsCursorCaptureActive(true);
			setActiveCursorSamples([]);
			setPendingCursorSamples([]);
			setCursorCaptureStartTimeMs(Date.now());
			resetCursorCaptureClock();
			setLinuxCursorScreenPoint(null);
			setLastLeftClick(null);
			sampleCursorPoint();
			startCursorSampling();
			void startInteractionCapture();
		} else {
			setIsCursorCaptureActive(false);
			stopCursorCapture();
			stopInteractionCapture();
			stopWindowBoundsCapture();
			stopNativeCursorMonitor();
			showCursor();
			setLinuxCursorScreenPoint(null);
			resetCursorCaptureClock();
			snapshotCursorTelemetryForPersistence();
			setActiveCursorSamples([]);
		}

		const source = selectedSource || { name: "Screen" };
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording,
					sourceName: source.name,
				});
			}
		});

		if (onRecordingStateChange) {
			onRecordingStateChange(recording, source.name);
		}
	});

	ipcMain.handle("pause-cursor-capture", (_event, boundaryMs?: number) => {
		const timestamp =
			typeof boundaryMs === "number" && Number.isFinite(boundaryMs)
				? boundaryMs
				: Date.now();
		sampleCursorPoint(timestamp);
		pauseCursorCapture(timestamp);
		return { success: true };
	});

	ipcMain.handle("resume-cursor-capture", (_event, boundaryMs?: number) => {
		const timestamp =
			typeof boundaryMs === "number" && Number.isFinite(boundaryMs)
				? boundaryMs
				: Date.now();
		resumeCursorCapture(timestamp);
		sampleCursorPoint(timestamp);
		return { success: true };
	});

	ipcMain.handle("get-cursor-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
		if (!targetVideoPath) {
			return { success: true, samples: [] };
		}

		const telemetryPath = getTelemetryPathForVideo(targetVideoPath);
		try {
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = JSON.parse(content);
			const rawSamples = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.samples)
					? parsed.samples
					: [];

			const samples: CursorTelemetryPoint[] = rawSamples
				.filter((sample: unknown) => Boolean(sample && typeof sample === "object"))
				.map((sample: unknown) => {
					const point = sample as Partial<CursorTelemetryPoint>;
					return {
						timeMs:
							typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
								? Math.max(0, point.timeMs)
								: 0,
						cx:
							typeof point.cx === "number" && Number.isFinite(point.cx)
								? clamp(point.cx, 0, 1)
								: 0.5,
						cy:
							typeof point.cy === "number" && Number.isFinite(point.cy)
								? clamp(point.cy, 0, 1)
								: 0.5,
						interactionType:
							point.interactionType === "click" ||
							point.interactionType === "double-click" ||
							point.interactionType === "right-click" ||
							point.interactionType === "middle-click" ||
							point.interactionType === "move" ||
							point.interactionType === "mouseup"
								? point.interactionType
								: undefined,
						cursorType:
							point.cursorType === "arrow" ||
							point.cursorType === "text" ||
							point.cursorType === "pointer" ||
							point.cursorType === "crosshair" ||
							point.cursorType === "open-hand" ||
							point.cursorType === "closed-hand" ||
							point.cursorType === "resize-ew" ||
							point.cursorType === "resize-ns" ||
							point.cursorType === "not-allowed"
								? point.cursorType
								: undefined,
					};
				})
				.sort((a: CursorTelemetryPoint, b: CursorTelemetryPoint) => a.timeMs - b.timeMs);

			return { success: true, samples };
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				return { success: true, samples: [] };
			}
			console.error("Failed to load cursor telemetry:", error);
			return {
				success: false,
				message: "Failed to load cursor telemetry",
				error: String(error),
				samples: [],
			};
		}
	});
}
