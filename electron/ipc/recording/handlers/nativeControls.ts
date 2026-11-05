import { ipcMain } from "electron";
import { isTrustedRenderer } from "../../../trustedRenderer";
import { rememberApprovedLocalReadPath } from "../../project/manager";
import {
	lastNativeCaptureDiagnostics,
	nativeCapturePaused,
	nativeCaptureProcess,
	nativeScreenRecordingActive,
	setNativeCapturePaused,
	setWindowsCapturePaused,
	windowsCapturePaused,
	windowsCaptureProcess,
	windowsNativeCaptureActive,
} from "../../state";
import { getCompanionAudioFallbackInfo } from "../diagnostics";
import { recoverNativeMacCaptureOutput, waitForNativeCaptureCommand } from "../mac";
import { isNativeWindowsCaptureAvailable, recoverNativeWindowsCaptureOutput } from "../windows";

import type { RecordingHandlerContext } from "./handlerContext";

export function registerNativeControls(
	context: Pick<
		RecordingHandlerContext,
		"windowsFinalizer" | "windowsInterruptedRecovery" | "ownerRecovery"
	>,
) {
	const { windowsFinalizer, windowsInterruptedRecovery, ownerRecovery } = context;
	ipcMain.handle("stop-native-screen-recording", (event) => {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
		return ownerRecovery.stop();
	});

	ipcMain.handle("recover-recording-owner", (event) => {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
		return ownerRecovery.recoverOwner(event.sender.id);
	});

	ipcMain.handle("recover-native-screen-recording", async (event) => {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
		if (process.platform === "win32") {
			windowsInterruptedRecovery.current ??= windowsFinalizer.recover(
				recoverNativeWindowsCaptureOutput,
			);
			const operation = windowsInterruptedRecovery.current;
			try {
				const result = await operation;
				if (!result.success && windowsInterruptedRecovery.current === operation)
					windowsInterruptedRecovery.current = null;
				return result;
			} catch (error) {
				if (windowsInterruptedRecovery.current === operation)
					windowsInterruptedRecovery.current = null;
				throw error;
			}
		}

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
			const commandApplied = waitForNativeCaptureCommand(
				nativeCaptureProcess,
				"Recording paused",
			);
			nativeCaptureProcess.stdin.write("pause\n");
			await commandApplied;
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
			const commandApplied = waitForNativeCaptureCommand(
				nativeCaptureProcess,
				"Recording resumed",
			);
			nativeCaptureProcess.stdin.write("resume\n");
			await commandApplied;
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

	ipcMain.handle("mux-native-windows-recording", async (event, expectedDurationMs?: number) => {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
		const sessionToken = ownerRecovery.sessionToken;
		try {
			return await windowsFinalizer.run(expectedDurationMs);
		} finally {
			ownerRecovery.complete(sessionToken);
		}
	});
}
