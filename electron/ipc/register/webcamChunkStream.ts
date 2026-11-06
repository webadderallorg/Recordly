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
					// Full-buffer rewrite, bounded by @fix-webm-duration/fix's
					// Blob-only API. Upgrade to a streaming rewrite if hour+ 1080p60
					// webcam files become common enough to matter.
					const raw = await fs.readFile(videoPath);
					const blob = new Blob([raw], { type: options.mimeType });
					const fixed = await fixWebmDuration(blob, options.durationMs);
					const tmpPath = `${videoPath}.tmp`;
					await fs.writeFile(tmpPath, Buffer.from(await fixed.arrayBuffer()));
					await fs.rename(tmpPath, videoPath);
				}
				return { success: true, path: videoPath };
			} catch (error) {
				console.error("Failed to finalize webcam recording:", error);
				// The original chunks-on-disk file is untouched (we only ever write
				// the duration fixup to a temp file), so it's still safe to return.
				await fs.rm(`${videoPath}.tmp`, { force: true }).catch(() => undefined);
				return { success: true, path: videoPath };
			}
		},
	);

	ipcMain.handle("webcam-chunk-discard", async () => {
		await discardActiveWebcamStream();
		return { success: true };
	});
}
