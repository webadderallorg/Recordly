import fs from "node:fs/promises";
import path from "node:path";
import { ipcMain } from "electron";
import { isTrustedRenderer } from "../../../trustedRenderer";
import { COMPANION_AUDIO_LAYOUTS } from "../../constants";
import { normalizeVideoSourcePath, resolveApprovedLocalMediaPath } from "../../project/manager";
import {
	approvedLocalReadPaths,
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
import { recoverNativeMacCaptureOutput } from "../mac";
import { sendNativeCaptureCommand } from "../nativeCaptureCommand";
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

	ipcMain.handle("pause-native-screen-recording", async (event) => {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: "No native Windows screen recording is active." };
			}

			if (windowsCapturePaused) {
				return { success: true };
			}

			try {
				await sendNativeCaptureCommand(windowsCaptureProcess, "pause\n");
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
			await sendNativeCaptureCommand(nativeCaptureProcess, "pause\n", "Recording paused");
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

	ipcMain.handle("resume-native-screen-recording", async (event) => {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: "No native Windows screen recording is active." };
			}

			if (!windowsCapturePaused) {
				return { success: true };
			}

			try {
				await sendNativeCaptureCommand(windowsCaptureProcess, "resume\n");
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
			await sendNativeCaptureCommand(nativeCaptureProcess, "resume\n", "Recording resumed");
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

	ipcMain.handle("is-native-windows-capture-available", async (event) => {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
		return { available: await isNativeWindowsCaptureAvailable() };
	});

	ipcMain.handle("get-last-native-capture-diagnostics", async (event) => {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
		return { success: true, diagnostics: lastNativeCaptureDiagnostics };
	});

	ipcMain.handle("get-video-audio-fallback-paths", async (event, videoPath: unknown) => {
		try {
			if (!event?.sender || !isTrustedRenderer(event))
				throw new Error("Untrusted recording caller");
			if (typeof videoPath !== "string") throw new Error("Invalid recording source");
			const sourcePath = normalizeVideoSourcePath(videoPath);
			if (!sourcePath) return { success: true, paths: [], startDelayMsByPath: {} };
			const approvedSource = await resolveApprovedLocalMediaPath(sourcePath);
			if (!approvedSource) throw new Error("Recording source is outside approved locations");

			const fallback = await getCompanionAudioFallbackInfo(approvedSource);
			const basePath = approvedSource.replace(/\.[^.]+$/u, "");
			const companions = new Set(
				COMPANION_AUDIO_LAYOUTS.flatMap(({ systemSuffix, micSuffix }) => [
					`${basePath}${systemSuffix}`,
					`${basePath}${micSuffix}`,
				]),
			);
			const paths: string[] = [];
			for (const fallbackPath of fallback.paths) {
				if (fallbackPath === approvedSource) {
					paths.push(fallbackPath);
					continue;
				}
				if (!companions.has(fallbackPath)) continue;
				if (!(await resolveApprovedLocalMediaPath(fallbackPath))) {
					const canonicalPath = await fs.realpath(fallbackPath).catch(() => null);
					const stat = await fs.lstat(fallbackPath).catch(() => null);
					// A selected recording includes its normal sidecars, never an implicit
					// approval of a symlink target outside the selected recording.
					if (canonicalPath !== path.resolve(fallbackPath) || !stat?.isFile()) continue;
					// Remember only the checked path. Re-resolving it while approving could
					// accidentally approve a replacement symlink's unrelated target.
					approvedLocalReadPaths.add(canonicalPath);
				}
				paths.push(fallbackPath);
			}
			const startDelayMsByPath = Object.fromEntries(
				paths.flatMap((audioPath) => {
					const delay = fallback.startDelayMsByPath[audioPath];
					return typeof delay === "number" ? [[audioPath, delay]] : [];
				}),
			);
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
