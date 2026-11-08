import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { ipcMain } from "electron";
import { getFfmpegBinaryPath } from "../../ffmpeg/binary";
import {
	ffmpegCaptureOutputBuffer,
	ffmpegCaptureProcess,
	ffmpegCaptureTargetPath,
	ffmpegScreenRecordingActive,
	setFfmpegCaptureOutputBuffer,
	setFfmpegCaptureProcess,
	setFfmpegCaptureTargetPath,
	setFfmpegScreenRecordingActive,
} from "../../state";
import { type SelectedSource } from "../../types";
import { getRecordingsDir } from "../../utils";
import {
	buildFfmpegCaptureArgs,
	waitForFfmpegCaptureStart,
	waitForFfmpegCaptureStop,
} from "../ffmpeg";
import { finalizeStoredVideo } from "../mac";

import type { RecordingHandlerContext } from "./handlerContext";

export function registerFfmpegHandlers(
	context: Pick<
		RecordingHandlerContext,
		"recordingProcessGuard" | "windowsFinalizer" | "windowsInterruptedRecovery"
	>,
) {
	const { recordingProcessGuard, windowsFinalizer, windowsInterruptedRecovery } = context;
	ipcMain.handle(
		"start-ffmpeg-recording",
		recordingProcessGuard.wrap(
			async (_: Electron.IpcMainInvokeEvent, source: SelectedSource) => {
				if (windowsFinalizer.needsFinish)
					return {
						success: false,
						message: "The previous recording is still finalizing.",
					};
				if (ffmpegCaptureProcess) {
					return { success: false, message: "An FFmpeg recording is already active." };
				}

				windowsInterruptedRecovery.current = null;
				let ffProc: ChildProcessWithoutNullStreams | null = null;
				try {
					const recordingsDir = await getRecordingsDir();
					const ffmpegPath = getFfmpegBinaryPath();
					const outputPath = path.join(recordingsDir, `recording-${Date.now()}.mp4`);
					const args = await buildFfmpegCaptureArgs(source, outputPath);

					setFfmpegCaptureOutputBuffer("");
					setFfmpegCaptureTargetPath(outputPath);
					ffProc = recordingProcessGuard.track(
						spawn(ffmpegPath, args, {
							cwd: recordingsDir,
							stdio: ["pipe", "pipe", "pipe"],
						}),
					);
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
					try {
						ffProc?.kill();
					} catch {
						// Keep the reservation until the child actually closes.
					}
					setFfmpegScreenRecordingActive(false);
					setFfmpegCaptureProcess(null);
					setFfmpegCaptureTargetPath(null);
					return {
						success: false,
						message: "Failed to start FFmpeg recording",
						error: String(error),
					};
				}
			},
		),
	);

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
}
