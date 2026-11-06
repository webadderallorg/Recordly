import fs from "node:fs/promises";
import { fixWebmDuration } from "@fix-webm-duration/fix";
import { ipcMain } from "electron";
import { isWebmMimeType } from "../../../src/hooks/recordingMimeType";
import { resolveRecordedVideoStoragePath } from "../recording/storagePath";
import { getRecordingsDir } from "../utils";

/**
 * Webcam chunks are written to disk as they arrive instead of being held in
 * renderer memory for the whole recording. On a multi-hour recording the old
 * in-memory Blob[] approach grew unbounded and caused GC pressure (stutter,
 * drift) long before the renderer eventually ran out of memory.
 */
let activeWebcamStreamPath: string | null = null;

async function discardActiveWebcamStream() {
	const videoPath = activeWebcamStreamPath;
	activeWebcamStreamPath = null;
	if (videoPath) {
		await fs.rm(videoPath, { force: true }).catch(() => undefined);
	}
}

export function registerWebcamChunkStreamHandlers() {
	ipcMain.handle("webcam-chunk-start", async (_, fileName: unknown) => {
		try {
			await discardActiveWebcamStream();
			const recordingsDir = await getRecordingsDir();
			const videoPath = resolveRecordedVideoStoragePath(recordingsDir, fileName);
			await fs.writeFile(videoPath, Buffer.alloc(0));
			activeWebcamStreamPath = videoPath;
			return { success: true };
		} catch (error) {
			activeWebcamStreamPath = null;
			console.error("Failed to start webcam chunk stream:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("webcam-chunk-append", async (_, chunk: ArrayBuffer) => {
		if (!activeWebcamStreamPath) {
			return { success: false, error: "No active webcam stream" };
		}
		try {
			await fs.appendFile(activeWebcamStreamPath, Buffer.from(chunk));
			return { success: true };
		} catch (error) {
			console.error("Failed to append webcam chunk:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle(
		"webcam-chunk-finalize",
		async (_, options: { mimeType?: string; durationMs?: number } | undefined) => {
			const videoPath = activeWebcamStreamPath;
			activeWebcamStreamPath = null;
			if (!videoPath) {
				return { success: false, error: "No active webcam stream" };
			}
			try {
				if (options?.mimeType && isWebmMimeType(options.mimeType) && options.durationMs) {
					const raw = await fs.readFile(videoPath);
					const blob = new Blob([raw], { type: options.mimeType });
					const fixed = await fixWebmDuration(blob, options.durationMs);
					await fs.writeFile(videoPath, Buffer.from(await fixed.arrayBuffer()));
				}
				return { success: true, path: videoPath };
			} catch (error) {
				console.error("Failed to finalize webcam recording:", error);
				// The chunks already reached disk; return the path even if the
				// duration-metadata fixup failed.
				return { success: true, path: videoPath };
			}
		},
	);

	ipcMain.handle("webcam-chunk-discard", async () => {
		await discardActiveWebcamStream();
		return { success: true };
	});
}
