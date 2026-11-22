import {
	setWindowsMicAudioPath,
	setWindowsOrphanedMicAudioPath,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsMicAudioPath,
	windowsOrphanedMicAudioPath,
	windowsPendingVideoPath,
	windowsSystemAudioPath,
} from "../../state";
import {
	getFileSizeIfPresent,
	recordNativeCaptureDiagnostics,
	validateRecordedVideo,
} from "../diagnostics";
import { finalizeStoredVideo } from "../mac";
import { muxNativeWindowsVideoWithAudio } from "../windows";
import {
	cleanupWindowsOrphanedMicAudioPath,
	writeWindowsRecordingDiagnostics,
} from "./nativeCaptureSupport";

export async function performWindowsMux(expectedDurationMs?: number) {
	const start = Date.now();
	console.log("[PERF:MAIN] Handler: mux-native-windows-recording: STARTED");
	try {
		const videoPath = windowsPendingVideoPath;
		const orphanedMicAudioPath = windowsOrphanedMicAudioPath;
		const diagnosticsSystemAudioPath = windowsSystemAudioPath;
		const diagnosticsMicAudioPath = windowsMicAudioPath;
		setWindowsPendingVideoPath(null);
		setWindowsOrphanedMicAudioPath(null);

		if (!videoPath) {
			return { success: false, message: "No native Windows video pending for mux" };
		}

		try {
			await writeWindowsRecordingDiagnostics(videoPath, {
				phase: "mux-start",
				expectedDurationMs,
				outputPath: videoPath,
				systemAudioPath: diagnosticsSystemAudioPath,
				microphonePath: diagnosticsMicAudioPath,
				details: {
					hasSystemAudio: Boolean(diagnosticsSystemAudioPath),
					hasMicrophone: Boolean(diagnosticsMicAudioPath),
					hasOrphanedMicrophone: Boolean(orphanedMicAudioPath),
				},
			});
			console.log("[mux-win] Optimization active: skipping video padding.");

			let muxDetails: unknown = null;
			if (diagnosticsSystemAudioPath || diagnosticsMicAudioPath) {
				muxDetails = await muxNativeWindowsVideoWithAudio(
					videoPath,
					diagnosticsSystemAudioPath,
					diagnosticsMicAudioPath,
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
			await writeWindowsRecordingDiagnostics(videoPath, {
				phase: "mux-complete",
				expectedDurationMs,
				outputPath: videoPath,
				systemAudioPath: diagnosticsSystemAudioPath,
				microphonePath: diagnosticsMicAudioPath,
				details: {
					fileSizeBytes: await getFileSizeIfPresent(videoPath),
					mux: muxDetails,
				},
			});
			await cleanupWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
			return await finalizeStoredVideo(videoPath);
		} catch (error) {
			console.error("Failed to mux native Windows recording:", error);
			recordNativeCaptureDiagnostics({
				backend: "windows-wgc",
				phase: "mux",
				outputPath: videoPath,
				systemAudioPath: diagnosticsSystemAudioPath,
				microphonePath: diagnosticsMicAudioPath,
				fileSizeBytes: await getFileSizeIfPresent(videoPath),
				error: String(error),
			});
			await writeWindowsRecordingDiagnostics(videoPath, {
				phase: "mux-error",
				expectedDurationMs,
				outputPath: videoPath,
				systemAudioPath: diagnosticsSystemAudioPath,
				microphonePath: diagnosticsMicAudioPath,
				error: String(error),
				details: {
					fileSizeBytes: await getFileSizeIfPresent(videoPath),
				},
			});
			setWindowsSystemAudioPath(null);
			setWindowsMicAudioPath(null);
			await cleanupWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
			try {
				return await finalizeStoredVideo(videoPath);
			} catch {
				try {
					await validateRecordedVideo(videoPath);
					return {
						success: false,
						path: videoPath,
						message: "Failed to mux native Windows recording",
						error: String(error),
					};
				} catch {
					// The fallback path is not safely playable; surface the original mux error.
				}

				return {
					success: false,
					message: "Failed to mux native Windows recording",
					error: String(error),
				};
			}
		}
	} finally {
		console.log(
			`[PERF:MAIN] Handler: mux-native-windows-recording: COMPLETED in ${Date.now() - start}ms`,
		);
	}
}
