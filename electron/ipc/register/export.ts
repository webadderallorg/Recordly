import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import type { SaveDialogOptions } from "electron";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
	closeExportStream,
	isOwnedExportPath,
	openExportStream,
	registerOwnedExportPath,
	releaseOwnedExportPath,
	writeToExportStream,
} from "../export/exportStream";
import {
	enqueueNativeVideoExportFrameWrite,
	exportNativeFastVideo,
	flushNativeVideoExportPendingWriteRequests,
	getNativeVideoExportMaxQueuedWriteBytes,
	getNativeVideoExportSessionError,
	isHardwareAcceleratedVideoEncoder,
	isIgnorableNativeVideoExportStreamError,
	muxExportedVideoAudioBuffer,
	muxNativeVideoExportAudio,
	type NativeVideoExportSession,
	nativeVideoExportSessions,
	removeTemporaryExportFile,
	resolveNativeVideoEncoder,
	sendNativeVideoExportWriteFrameResult,
	settleNativeVideoExportWriteFrameRequest,
} from "../export/native-video";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import {
	buildNativeH264StreamExportArgs,
	buildNativeVideoExportArgs,
	getNativeVideoInputByteSize,
	type NativeExportEncodingMode,
	type NativeFastVideoExportOptions,
	type NativeVideoExportFinishOptions,
} from "../nativeVideoExport";
import { approveUserPath } from "../utils";

async function moveExportedTempFile(tempPath: string, destinationPath: string) {
	await fs.mkdir(path.dirname(destinationPath), { recursive: true });
	try {
		await fs.rename(tempPath, destinationPath);
		return;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "EXDEV" && code !== "EPERM" && code !== "ENOTEMPTY") {
			throw error;
		}
		// Cross-device or Windows permission quirks — fall back to copy + unlink so
		// exporting to a different volume still works.
	}

	await fs.copyFile(tempPath, destinationPath);
	try {
		await fs.rm(tempPath, { force: true });
	} catch (unlinkError) {
		// Copy succeeded, so the export itself is safe; surface the leaked temp
		// path instead of silently swallowing the failure so operators can
		// reclaim disk space manually if the OS temp reaper misses it.
		console.warn(
			`[export] Failed to remove temp file after cross-volume copy (${tempPath}):`,
			unlinkError,
		);
	}
}

function isTempPathSafe(tempPath: string): boolean {
	const tempRoot = path.resolve(app.getPath("temp"));
	const candidate = path.resolve(tempPath);
	if (candidate === tempRoot) {
		return false;
	}
	const withSep = tempRoot.endsWith(path.sep) ? tempRoot : tempRoot + path.sep;
	return candidate.startsWith(withSep);
}

export function registerExportHandlers() {
	ipcMain.handle(
		"native-video-export-start",
		async (
			event,
			options: {
				width: number;
				height: number;
				frameRate: number;
				bitrate: number;
				encodingMode: NativeExportEncodingMode;
				inputMode?: "rawvideo" | "h264-stream";
			},
		) => {
			try {
				if (options.width % 2 !== 0 || options.height % 2 !== 0) {
					throw new Error("Native export requires even output dimensions");
				}

				const ffmpegPath = getFfmpegBinaryPath();
				const inputMode = options.inputMode ?? "rawvideo";
				const sessionId = `recordly-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				const outputPath = path.join(app.getPath("temp"), `${sessionId}.mp4`);

				let encoderName: string;
				let ffmpegArgs: string[];

				if (inputMode === "h264-stream") {
					// Pre-encoded H.264 Annex B from browser VideoEncoder — just stream-copy into MP4
					encoderName = "h264-stream-copy";
					ffmpegArgs = buildNativeH264StreamExportArgs({
						frameRate: options.frameRate,
						outputPath,
					});
				} else {
					encoderName = await resolveNativeVideoEncoder(ffmpegPath, options.encodingMode);
					ffmpegArgs = buildNativeVideoExportArgs(encoderName, options, outputPath);
				}

				const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
					stdio: ["pipe", "ignore", "pipe"],
				}) as ChildProcessByStdio<Writable, null, Readable>;
				// For rawvideo, frames are a fixed RGBA size. For h264-stream, chunks are variable.
				const inputByteSize =
					inputMode === "rawvideo"
						? getNativeVideoInputByteSize(options.width, options.height)
						: 0;

				const session: NativeVideoExportSession = {
					ffmpegProcess,
					outputPath,
					inputByteSize,
					inputMode,
					maxQueuedWriteBytes:
						inputMode === "h264-stream"
							? 8 * 1024 * 1024
							: getNativeVideoExportMaxQueuedWriteBytes(inputByteSize),
					stderrOutput: "",
					encoderName,
					processError: null,
					stdinError: null,
					terminating: false,
					writeSequence: Promise.resolve(),
					sender: event.sender,
					pendingWriteRequestIds: new Set<number>(),
					completionPromise: new Promise<void>((resolve, reject) => {
						ffmpegProcess.once("error", (error) => {
							const processError =
								error instanceof Error ? error : new Error(String(error));
							if (session.terminating) {
								resolve();
								return;
							}

							session.processError = processError;
							reject(processError);
						});
						ffmpegProcess.stdin.once("error", (error) => {
							const stdinError =
								error instanceof Error ? error : new Error(String(error));
							if (
								session.terminating &&
								isIgnorableNativeVideoExportStreamError(stdinError)
							) {
								return;
							}

							session.stdinError = stdinError;
						});
						ffmpegProcess.once("close", (code, signal) => {
							if (session.terminating) {
								resolve();
								return;
							}

							if (code === 0) {
								resolve();
								return;
							}

							reject(
								new Error(
									getNativeVideoExportSessionError(
										session,
										`FFmpeg exited with code ${code ?? "unknown"}${signal ? ` (signal ${signal})` : ""}`,
									),
								),
							);
						});
					}),
				};
				void session.completionPromise.catch(() => undefined);

				ffmpegProcess.stderr.on("data", (chunk: Buffer) => {
					session.stderrOutput += chunk.toString();
				});

				nativeVideoExportSessions.set(sessionId, session);

				console.log(
					`[native-export] Started ${isHardwareAcceleratedVideoEncoder(encoderName) ? "hardware" : "software"} session ${sessionId} with ${encoderName}`,
				);

				return {
					success: true,
					sessionId,
					encoderName,
				};
			} catch (error) {
				console.error(
					"[native-export] Failed to start native video export session:",
					error,
				);
				return {
					success: false,
					error: String(error),
				};
			}
		},
	);

	ipcMain.on(
		"native-video-export-write-frame-async",
		(
			event,
			payload: {
				sessionId: string;
				requestId: number;
				frameData: Uint8Array;
			},
		) => {
			const sessionId = payload?.sessionId;
			const requestId = payload?.requestId;
			const frameData = payload?.frameData;

			if (typeof sessionId !== "string" || typeof requestId !== "number" || !frameData) {
				return;
			}

			const session = nativeVideoExportSessions.get(sessionId);
			if (!session) {
				sendNativeVideoExportWriteFrameResult(event.sender, sessionId, requestId, {
					success: false,
					error: "Invalid native export session",
				});
				return;
			}

			session.sender = event.sender;
			session.pendingWriteRequestIds.add(requestId);

			if (session.terminating) {
				settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
					success: false,
					error: "Native video export session was cancelled",
				});
				return;
			}

			if (
				session.inputMode !== "h264-stream" &&
				frameData.byteLength !== session.inputByteSize
			) {
				settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
					success: false,
					error: `Native video export expected ${session.inputByteSize} bytes per frame but received ${frameData.byteLength}`,
				});
				return;
			}

			void enqueueNativeVideoExportFrameWrite(session, frameData)
				.then(() => {
					settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
						success: true,
					});
				})
				.catch((error) => {
					session.stdinError = error instanceof Error ? error : new Error(String(error));
					settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
						success: false,
						error: getNativeVideoExportSessionError(
							session,
							session.stdinError.message,
						),
					});
				});
		},
	);

	ipcMain.handle(
		"native-video-export-finish",
		async (_, sessionId: string, options?: NativeVideoExportFinishOptions) => {
			const session = nativeVideoExportSessions.get(sessionId);
			if (!session) {
				return { success: false, error: "Invalid native export session" };
			}

			try {
				await session.writeSequence;
				if (
					!session.ffmpegProcess.stdin.destroyed &&
					!session.ffmpegProcess.stdin.writableEnded
				) {
					session.ffmpegProcess.stdin.end();
				}
				await session.completionPromise;

				const finalized = await muxNativeVideoExportAudio(
					session.outputPath,
					options ?? {},
				);
				nativeVideoExportSessions.delete(sessionId);
				// Register the finalized path so only app-produced paths can flow back
				// through finalize-exported-video / discard-exported-temp.
				registerOwnedExportPath(finalized.outputPath);
				if (finalized.outputPath !== session.outputPath) {
					// muxNativeVideoExportAudio removes the intermediate on success, but
					// clear our registry entry defensively in case a future refactor
					// changes that contract.
					releaseOwnedExportPath(session.outputPath);
				}

				// Return a temp path instead of reading the file back into memory so we
				// never hit V8's per-ArrayBuffer limit on >2 GiB exports. The renderer
				// uses finalize-exported-video to move the file to its final path.
				return {
					success: true,
					tempPath: finalized.outputPath,
					encoderName: session.encoderName,
					metrics: finalized.metrics,
				};
			} catch (error) {
				flushNativeVideoExportPendingWriteRequests(sessionId, session, String(error));
				nativeVideoExportSessions.delete(sessionId);
				await removeTemporaryExportFile(session.outputPath);
				const finalizedSuffix = session.outputPath.replace(/\.mp4$/, "-final.mp4");
				await removeTemporaryExportFile(finalizedSuffix);
				return {
					success: false,
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"mux-exported-video-audio-from-path",
		async (_, videoPath: string, options?: NativeVideoExportFinishOptions) => {
			if (typeof videoPath !== "string" || !isOwnedExportPath(videoPath)) {
				return {
					success: false,
					error: "Video path is not an app-managed export temp",
				};
			}
			try {
				const finalized = await muxNativeVideoExportAudio(videoPath, options ?? {});
				if (finalized.outputPath !== videoPath) {
					registerOwnedExportPath(finalized.outputPath);
					// muxNativeVideoExportAudio removes the intermediate on success, so
					// the input is no longer owned by the registry after the call
					// returns.
					releaseOwnedExportPath(videoPath);
				}
				return {
					success: true,
					tempPath: finalized.outputPath,
					metrics: finalized.metrics,
				};
			} catch (error) {
				// Only clean up the input path if it is still an owned temp (i.e.
				// muxNativeVideoExportAudio failed before consuming it).
				if (isOwnedExportPath(videoPath)) {
					await removeTemporaryExportFile(videoPath);
					releaseOwnedExportPath(videoPath);
				}
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle(
		"mux-exported-video-audio",
		async (_, videoData: ArrayBuffer, options?: NativeVideoExportFinishOptions) => {
			try {
				const result = await muxExportedVideoAudioBuffer(videoData, options ?? {});
				return {
					success: true,
					data: result.data,
					metrics: result.metrics,
				};
			} catch (error) {
				return {
					success: false,
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle("native-fast-video-export", async (_, options: NativeFastVideoExportOptions) => {
		try {
			if (
				!options ||
				typeof options.sourcePath !== "string" ||
				options.sourcePath.trim().length === 0 ||
				!Number.isFinite(options.width) ||
				!Number.isFinite(options.height) ||
				!Number.isFinite(options.frameRate) ||
				!Number.isFinite(options.bitrate)
			) {
				throw new Error("Invalid native fast export options");
			}

			if (
				options.width <= 0 ||
				options.height <= 0 ||
				options.width % 2 !== 0 ||
				options.height % 2 !== 0 ||
				options.frameRate <= 0 ||
				options.bitrate <= 0
			) {
				throw new Error("Native fast export requires positive even dimensions");
			}

			const exported = await exportNativeFastVideo(options);
			registerOwnedExportPath(exported.outputPath);
			return {
				success: true,
				tempPath: exported.outputPath,
				encoderName: exported.encoderName,
				metrics: exported.metrics,
			};
		} catch (error) {
			console.error("[native-fast-export] Failed to export video:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle("export-stream-open", async (_event, options?: { extension?: string }) => {
		try {
			const result = await openExportStream(options);
			return { success: true, streamId: result.streamId, tempPath: result.tempPath };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle(
		"export-stream-write",
		async (_event, streamId: string, position: number, chunk: Uint8Array) => {
			try {
				await writeToExportStream(streamId, position, chunk);
				return { success: true };
			} catch (error) {
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle(
		"export-stream-close",
		async (_event, streamId: string, options?: { abort?: boolean }) => {
			try {
				const result = await closeExportStream(streamId, options);
				return {
					success: true,
					tempPath: result.tempPath,
					bytesWritten: result.bytesWritten,
				};
			} catch (error) {
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle("native-video-export-cancel", async (_, sessionId: string) => {
		const session = nativeVideoExportSessions.get(sessionId);
		if (!session) {
			return { success: true };
		}

		session.terminating = true;
		nativeVideoExportSessions.delete(sessionId);
		flushNativeVideoExportPendingWriteRequests(
			sessionId,
			session,
			"Native video export session was cancelled",
		);

		try {
			if (
				!session.ffmpegProcess.stdin.destroyed &&
				!session.ffmpegProcess.stdin.writableEnded
			) {
				session.ffmpegProcess.stdin.destroy();
			}
		} catch {
			// Stream may already be closed.
		}

		try {
			session.ffmpegProcess.kill("SIGKILL");
		} catch {
			// Process may already be closed.
		}

		await session.completionPromise.catch(() => undefined);
		await removeTemporaryExportFile(session.outputPath);
		return { success: true };
	});

	ipcMain.handle(
		"save-exported-video",
		async (event, videoData: ArrayBuffer, fileName: string) => {
			try {
				// Determine file type from extension
				const isGif = fileName.toLowerCase().endsWith(".gif");
				const filters = isGif
					? [{ name: "GIF Image", extensions: ["gif"] }]
					: [{ name: "MP4 Video", extensions: ["mp4"] }];
				const parentWindow = BrowserWindow.fromWebContents(event.sender);
				const saveDialogOptions: SaveDialogOptions = {
					title: isGif ? "Save Exported GIF" : "Save Exported Video",
					defaultPath: path.join(app.getPath("downloads"), fileName),
					filters,
					properties: ["createDirectory", "showOverwriteConfirmation"],
				};

				const result = parentWindow
					? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
					: await dialog.showSaveDialog(saveDialogOptions);

				if (result.canceled || !result.filePath) {
					return {
						success: false,
						canceled: true,
						message: "Export canceled",
					};
				}

				await fs.writeFile(result.filePath, Buffer.from(videoData));
				approveUserPath(result.filePath);

				return {
					success: true,
					path: result.filePath,
					message: "Video exported successfully",
				};
			} catch (error) {
				console.error("Failed to save exported video:", error);
				return {
					success: false,
					message: "Failed to save exported video",
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"write-exported-video-to-path",
		async (_event, videoData: ArrayBuffer, outputPath: string) => {
			try {
				const resolvedPath = path.resolve(outputPath);
				await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
				await fs.writeFile(resolvedPath, Buffer.from(videoData));
				approveUserPath(resolvedPath);

				return {
					success: true,
					path: resolvedPath,
					message: "Video exported successfully",
					canceled: false,
				};
			} catch (error) {
				console.error("Failed to write exported video to path:", error);
				return {
					success: false,
					message: "Failed to write exported video",
					canceled: false,
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"finalize-exported-video",
		async (
			event,
			payload: {
				tempPath: string;
				fileName: string;
				outputPath?: string | null;
			},
		) => {
			const tempPath = payload?.tempPath;
			const fileName = payload?.fileName;
			if (typeof tempPath !== "string" || typeof fileName !== "string") {
				return { success: false, error: "Invalid finalize-exported-video payload" };
			}

			if (!isTempPathSafe(tempPath) || !isOwnedExportPath(tempPath)) {
				return {
					success: false,
					error: "Temp path is not an app-managed export temp",
				};
			}

			try {
				await fs.access(tempPath);
			} catch {
				return {
					success: false,
					error: `Exported video temp file is missing: ${tempPath}`,
				};
			}

			try {
				if (payload.outputPath) {
					const resolvedPath = path.resolve(payload.outputPath);
					await moveExportedTempFile(tempPath, resolvedPath);
					releaseOwnedExportPath(tempPath);
					approveUserPath(resolvedPath);
					return {
						success: true,
						path: resolvedPath,
						canceled: false,
						message: "Video exported successfully",
					};
				}

				const isGif = fileName.toLowerCase().endsWith(".gif");
				const filters = isGif
					? [{ name: "GIF Image", extensions: ["gif"] }]
					: [{ name: "MP4 Video", extensions: ["mp4"] }];
				const parentWindow = BrowserWindow.fromWebContents(event.sender);
				const saveDialogOptions: SaveDialogOptions = {
					title: isGif ? "Save Exported GIF" : "Save Exported Video",
					defaultPath: path.join(app.getPath("downloads"), fileName),
					filters,
					properties: ["createDirectory", "showOverwriteConfirmation"],
				};

				const result = parentWindow
					? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
					: await dialog.showSaveDialog(saveDialogOptions);

				if (result.canceled || !result.filePath) {
					// Leave the temp file in place so the renderer can offer "Save Again"
					// without re-rendering. The renderer owns cleanup on discard.
					return {
						success: false,
						canceled: true,
						message: "Export canceled",
					};
				}

				await moveExportedTempFile(tempPath, result.filePath);
				releaseOwnedExportPath(tempPath);
				approveUserPath(result.filePath);

				return {
					success: true,
					path: result.filePath,
					canceled: false,
					message: "Video exported successfully",
				};
			} catch (error) {
				console.error("Failed to finalize exported video:", error);
				return {
					success: false,
					canceled: false,
					message: "Failed to save exported video",
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle("discard-exported-temp", async (_event, tempPath: string) => {
		if (typeof tempPath !== "string" || tempPath.length === 0) {
			return { success: false, error: "Invalid temp path" };
		}
		if (!isTempPathSafe(tempPath) || !isOwnedExportPath(tempPath)) {
			return {
				success: false,
				error: "Temp path is not an app-managed export temp",
			};
		}
		try {
			await removeTemporaryExportFile(tempPath);
			releaseOwnedExportPath(tempPath);
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
}
