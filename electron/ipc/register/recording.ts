import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { dialog, ipcMain, shell } from "electron";
import { isTrustedRenderer } from "../../trustedRenderer";
import { registerCursorHandlers } from "../recording/handlers/cursorHandlers";
import { registerFfmpegHandlers } from "../recording/handlers/ffmpegHandlers";
import { registerMicrophoneSidecar } from "../recording/handlers/microphoneSidecar";
import { registerNativeControls } from "../recording/handlers/nativeControls";
import { registerNativeStart } from "../recording/handlers/nativeStart";
import { registerRecordingFiles } from "../recording/handlers/recordingFiles";
import { applyRecordingState } from "../recording/handlers/recordingState";
import { stopNativeCapture } from "../recording/handlers/stopNativeCapture";
import { performWindowsMux } from "../recording/handlers/windowsMux";
import { RecordingOwnerRecovery } from "../recording/ownerRecovery";
import { RecordingProcessGuard } from "../recording/processGuard";
import { RecordingSessionLock } from "../recording/sessionLock";
import { WindowsRecordingFinalizer } from "../recording/windowsFinalizer";
import { setWindowsPendingVideoPath, windowsPendingVideoPath } from "../state";
import { getTelemetryPathForVideo } from "../utils";

export function registerRecordingHandlers(
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
	const sessionLock = new RecordingSessionLock(() => setRecordingState(false));

	const recordingProcessGuard = new RecordingProcessGuard((args) =>
		sessionLock.acquire((args[0] as Electron.IpcMainInvokeEvent).sender.id),
	);

	ipcMain.handle("reserve-recording-session", (event) => {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
		const token = randomUUID();
		return {
			success: sessionLock.reserve(event.sender, token),
			token,
			message: "Another recording session is already starting or active.",
		};
	});

	ipcMain.on("recording-startup-finished", (event, token: unknown) => {
		if (isTrustedRenderer(event) && typeof token === "string") {
			sessionLock.finishStartup(event.sender.id, token);
		}
	});

	const windowsFinalizer = new WindowsRecordingFinalizer(
		() => Boolean(windowsPendingVideoPath),
		performWindowsMux,
	);

	const windowsInterruptedRecovery = {
		current: null as ReturnType<WindowsRecordingFinalizer["recover"]> | null,
	};

	const ownerRecovery = new RecordingOwnerRecovery({
		stop: stopNativeCapture,
		needsFinish: () => process.platform === "win32" && windowsFinalizer.needsFinish,
		finish: async (result) =>
			process.platform === "win32" && windowsFinalizer.needsFinish
				? await windowsFinalizer.run()
				: result,
		discard: async (videoPath) => {
			setWindowsPendingVideoPath(null);
			const base = videoPath.replace(/\.mp4$/i, "");
			const files = [
				videoPath,
				getTelemetryPathForVideo(videoPath),
				`${base}.recording-diagnostics.json`,
				...[
					".system.m4a",
					".mic.m4a",
					".system.wav",
					".mic.wav",
					".system.wav.json",
					".mic.wav.json",
				].map((suffix) => `${base}${suffix}`),
			];
			await Promise.all(files.map((file) => fs.rm(file, { force: true })));
		},
		reset: () => setRecordingState(false),
		report: async (result) => {
			const response = await dialog.showMessageBox({
				type: result.success ? "warning" : "error",
				title: "Recording interrupted",
				message: result.success
					? "The recording controls closed unexpectedly. Your recording was saved."
					: "The recording controls closed unexpectedly and recording recovery failed.",
				detail: result.path || result.error || result.message,
				buttons: result.path ? ["OK", "Show in Folder"] : ["OK"],
			});
			if (response.response === 1 && result.path) shell.showItemInFolder(result.path);
		},
	});
	const context = {
		sessionLock,
		recordingProcessGuard,
		windowsFinalizer,
		windowsInterruptedRecovery,
		ownerRecovery,
		setRecordingState,
	};
	registerNativeStart(context);
	registerNativeControls(context);
	registerFfmpegHandlers(context);
	registerMicrophoneSidecar();
	registerRecordingFiles();
	ipcMain.handle("set-recording-state", (event, recording: boolean) => {
		if (!isTrustedRenderer(event) || typeof recording !== "boolean")
			throw new Error("Invalid recording state caller");
		setRecordingState(recording, event.sender.id);
	});
	registerCursorHandlers();
	function setRecordingState(recording: boolean, ownerId?: number) {
		applyRecordingState(context, recording, ownerId, onRecordingStateChange);
	}
}
