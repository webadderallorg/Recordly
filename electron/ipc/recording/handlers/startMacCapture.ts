import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { app, desktopCapturer, dialog, shell, systemPreferences } from "electron";
import { getHudCaptureExcludedProcessIds } from "../../../../src/lib/hudCaptureProtection";
import { nativeT } from "../../../nativeI18n";
import { getHudOverlayCaptureProtectionEnabled } from "../../../windows";
import { ALLOW_RECORDLY_WINDOW_CAPTURE } from "../../constants";
import {
	ensureNativeCaptureHelperBinary,
	getNativeCaptureHelperBinaryPath,
} from "../../paths/binaries";
import { getSourceArea } from "../../sourceArea";
import {
	nativeCaptureMicrophonePath,
	nativeCaptureOutputBuffer,
	nativeCaptureProcess,
	nativeCaptureSystemAudioPath,
	nativeCaptureTargetPath,
	setNativeCaptureMicrophonePath,
	setNativeCaptureOutputBuffer,
	setNativeCapturePaused,
	setNativeCaptureProcess,
	setNativeCaptureStopRequested,
	setNativeCaptureSystemAudioPath,
	setNativeCaptureTargetPath,
	setNativeScreenRecordingActive,
} from "../../state";
import { type NativeMacRecordingOptions, type SelectedSource } from "../../types";
import { getMacPrivacySettingsUrl, getRecordingsDir, getScreen, parseWindowId } from "../../utils";
import { getFileSizeIfPresent, recordNativeCaptureDiagnostics } from "../diagnostics";
import { attachNativeCaptureLifecycle, waitForNativeCaptureStart } from "../mac";
import type { RecordingHandlerContext } from "./handlerContext";
import { normalizeDesktopSourceName } from "./nativeCaptureSupport";

export async function startMacCapture(
	context: Pick<RecordingHandlerContext, "recordingProcessGuard" | "ownerRecovery">,
	source: SelectedSource,
	options: NativeMacRecordingOptions | undefined,
	visibleWindowBounds: { x: number; y: number; width: number; height: number } | null,
) {
	const { recordingProcessGuard, ownerRecovery } = context;
	if (process.platform !== "darwin") {
		return {
			success: false,
			message: "Native screen recording is only available on macOS.",
		};
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
				message: "Cannot record Recordly windows. Please select another app window.",
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

		const excludedProcessIds = getHudCaptureExcludedProcessIds(
			process.platform,
			getHudOverlayCaptureProtectionEnabled(),
			process.pid,
		);
		if (excludedProcessIds.length > 0) {
			config.excludedProcessIds = excludedProcessIds;
		}

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
		const area = getSourceArea(source);

		if (area) {
			config.regionX = area.x;
			config.regionY = area.y;
			config.regionWidth = area.width;
			config.regionHeight = area.height;
			if (Number.isFinite(screenId) && screenId > 0) {
				config.displayId = screenId;
			}
		} else if (Number.isFinite(windowId) && windowId && source?.id?.startsWith("window:")) {
			config.windowId = windowId;
			if (visibleWindowBounds) {
				config.windowX = visibleWindowBounds.x;
				config.windowY = visibleWindowBounds.y;
				config.windowWidth = visibleWindowBounds.width;
				config.windowHeight = visibleWindowBounds.height;
			}
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
		captProc = recordingProcessGuard.track(
			spawn(helperPath, [JSON.stringify(config)], {
				cwd: recordingsDir,
				stdio: ["pipe", "pipe", "pipe"],
			}),
		);
		setNativeCaptureProcess(captProc);
		attachNativeCaptureLifecycle(captProc);
		captProc.once("close", () => ownerRecovery.captureExited());

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
		const micUnavailableNatively =
			nativeCaptureOutputBuffer.includes("MICROPHONE_CAPTURE_UNAVAILABLE") ||
			nativeCaptureOutputBuffer.includes("MICROPHONE_DEVICE_UNAVAILABLE");
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
		return {
			success: true,
			microphoneFallbackRequired: micUnavailableNatively,
		};
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
				title: nativeT("screenPermissionTitle"),
				message: nativeT("screenPermissionMessage"),
				detail: nativeT("screenPermissionDetail"),
				buttons: [nativeT("openSettings"), nativeT("cancel")],
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
				title: nativeT("micPermissionTitle"),
				message: nativeT("micPermissionMessage"),
				detail: nativeT("micPermissionDetail"),
				buttons: [nativeT("openSettings"), nativeT("cancel")],
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
}
