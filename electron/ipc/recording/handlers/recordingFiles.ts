import fs from "node:fs/promises";
import path from "node:path";
import { ipcMain } from "electron";
import { isTrustedRenderer } from "../../../trustedRenderer";
import { getFfmpegBinaryPath } from "../../ffmpeg/binary";
import { rememberApprovedLocalReadPath } from "../../project/manager";
import { getRecordingsDir } from "../../utils";
import { validateRecordedVideo } from "../diagnostics";
import { finalizeStoredVideo } from "../mac";
import {
	finalizeKeepingPath,
	MAX_RECORDING_CHUNK_BYTES,
	RecordingFileCloseError,
	RecordingFileStreams,
} from "../recordingFileStreams";
import { resolveRecordedVideoStoragePath } from "../storagePath";
import { finishWebmRecording } from "../webmDuration";

// Whole-file fallback uses Electron's structured-clone transport; long recordings stream instead.
const MAX_RECORDING_FILE_BYTES = 512 * 1024 * 1024;

export function registerRecordingFiles() {
	const recordingStreams = new RecordingFileStreams();

	async function finishStream(filePath: string) {
		if (!/\.webm$/i.test(filePath)) return filePath;
		let finishedPath = filePath;
		try {
			finishedPath = await finishWebmRecording(getFfmpegBinaryPath(), filePath);
		} catch (error) {
			console.warn("Recording post-processing failed; preserving source", error);
		}
		return finishedPath;
	}

	function trust(event: Electron.IpcMainInvokeEvent) {
		if (!isTrustedRenderer(event)) throw new Error("Untrusted recording caller");
	}

	ipcMain.handle(
		"open-recording-file-stream",
		async (event, fileName: unknown, mimeType: unknown) => {
			try {
				trust(event);
				if (
					typeof mimeType !== "string" ||
					!/^video\/webm(?:[;\s]|$)/i.test(mimeType) ||
					typeof fileName !== "string" ||
					!fileName.endsWith(".webm")
				)
					throw new Error("Only WebM recording streams are supported");
				const sender = event.sender;
				const originalFrame = event.senderFrame;
				let gone = false;
				const onGone = () => {
					gone = true;
				};
				const onNavigation = (
					details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
				) => {
					if (details.isMainFrame && !details.isSameDocument) gone = true;
				};
				sender.on("destroyed", onGone);
				sender.on("render-process-gone", onGone);
				sender.on("did-start-navigation", onNavigation);
				recordingStreams.closeWhenOwnerGoes(sender, (closed) => {
					void Promise.all(
						closed.map(async (item) => {
							if (!item.bytesWritten) {
								await fs.rm(item.path, { force: true });
								return;
							}
							const recoveredPath = await finishStream(item.path);
							await rememberApprovedLocalReadPath(recoveredPath);
						}),
					).catch((error) =>
						console.error("Could not finalize interrupted recording", error),
					);
				});
				let filePath: string;
				let streamId: string;
				try {
					const recordingsDir = await fs.realpath(await getRecordingsDir());
					if (
						gone ||
						sender.isDestroyed() ||
						sender.mainFrame !== originalFrame ||
						!isTrustedRenderer(event)
					)
						throw new Error("Recording renderer went away");
					filePath = resolveRecordedVideoStoragePath(recordingsDir, fileName);
					streamId = await recordingStreams.open(filePath, sender.id);
				} finally {
					sender.removeListener("destroyed", onGone);
					sender.removeListener("render-process-gone", onGone);
					sender.removeListener("did-start-navigation", onNavigation);
				}
				return { success: true, streamId, path: filePath };
			} catch (error) {
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle(
		"append-recording-file-stream",
		async (event, streamId: unknown, data: unknown) => {
			try {
				trust(event);
				if (
					typeof streamId !== "string" ||
					!(data instanceof ArrayBuffer) ||
					data.byteLength > MAX_RECORDING_CHUNK_BYTES
				)
					throw new Error("Invalid recording chunk");
				await recordingStreams.append(streamId, event.sender.id, new Uint8Array(data));
				return { success: true };
			} catch (error) {
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle("close-recording-file-stream", async (event, streamId: unknown) => {
		try {
			trust(event);
			if (typeof streamId !== "string") throw new Error("Invalid recording stream");
			const closed = await recordingStreams.close(streamId, event.sender.id);
			if (!closed.bytesWritten) {
				await fs.rm(closed.path, { force: true });
				return { success: false, message: "No video frames were captured." };
			}
			const filePath = await finishStream(closed.path);
			return await finalizeKeepingPath(filePath, async (savedPath) => {
				await rememberApprovedLocalReadPath(savedPath);
				return await finalizeStoredVideo(savedPath);
			});
		} catch (error) {
			return {
				success: false,
				message: "Could not save the complete recording.",
				error: String(error),
				...(error instanceof RecordingFileCloseError ? { path: error.partialPath } : {}),
			};
		}
	});

	ipcMain.handle("discard-recording-file-stream", async (event, streamId: unknown) => {
		try {
			trust(event);
			if (typeof streamId !== "string") throw new Error("Invalid recording stream");
			await recordingStreams.discard(streamId, event.sender.id);
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("store-recorded-video", async (event, videoData: unknown, fileName: unknown) => {
		try {
			trust(event);
			if (
				!(videoData instanceof ArrayBuffer) ||
				videoData.byteLength > MAX_RECORDING_FILE_BYTES
			)
				throw new Error("Invalid recording data");
			const recordingsDir = await getRecordingsDir();
			const videoPath = resolveRecordedVideoStoragePath(recordingsDir, fileName);
			await fs.writeFile(videoPath, Buffer.from(videoData), { flag: "wx", mode: 0o600 });
			const filePath = await finishStream(videoPath);
			return await finalizeKeepingPath(filePath, async (savedPath) => {
				await rememberApprovedLocalReadPath(savedPath);
				return await finalizeStoredVideo(savedPath);
			});
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
}
