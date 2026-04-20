import fs from "node:fs/promises"
import path from "node:path"
import { ipcMain } from "electron"
import { getRecordingsDir } from "../../utils"
import { finalizeStoredVideo } from "../../recording/mac"

export function registerRecordingStorageHandlers() {
	ipcMain.handle("store-microphone-sidecar", async (_, audioData: ArrayBuffer, videoPath: string) => {
		try {
			const baseName = videoPath.replace(/\.[^.]+$/, "")
			const sidecarPath = `${baseName}.mic.webm`
			await fs.writeFile(sidecarPath, Buffer.from(audioData))
			return { success: true, path: sidecarPath }
		} catch (error) {
			console.error("Failed to store microphone sidecar:", error)
			return { success: false, error: String(error) }
		}
	})

	ipcMain.handle("store-recorded-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			const recordingsDir = await getRecordingsDir()
			const videoPath = path.join(recordingsDir, fileName)
			await fs.writeFile(videoPath, Buffer.from(videoData))
			return await finalizeStoredVideo(videoPath)
		} catch (error) {
			console.error("Failed to store video:", error)
			return {
				success: false,
				message: "Failed to store video",
				error: String(error),
			}
		}
	})

	ipcMain.handle("get-recorded-video-path", async () => {
		try {
			const recordingsDir = await getRecordingsDir()
			const entries = await fs.readdir(recordingsDir, { withFileTypes: true })
			const candidates = await Promise.all(
				entries
					.filter(
						(entry) => entry.isFile() && /^recording-\d+\.(webm|mov|mp4)$/i.test(entry.name),
					)
					.map(async (entry) => {
						const fullPath = path.join(recordingsDir, entry.name)
						const stat = await fs.stat(fullPath).catch(() => null)
						return stat ? { path: fullPath, mtimeMs: stat.mtimeMs } : null
					}),
			)
			const latestVideo = candidates
				.filter(
					(candidate): candidate is { path: string; mtimeMs: number } => candidate !== null,
				)
				.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]

			if (!latestVideo) {
				return { success: false, message: "No recorded video found" }
			}

			return { success: true, path: latestVideo.path }
		} catch (error) {
			console.error("Failed to get video path:", error)
			return {
				success: false,
				message: "Failed to get video path",
				error: String(error),
			}
		}
	})
}