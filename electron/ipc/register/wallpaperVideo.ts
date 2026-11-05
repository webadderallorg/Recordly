import { stat } from "node:fs/promises";
import path from "node:path";
import { ipcMain } from "electron";
import { approveUserPath } from "../utils";

const VIDEO_FILE_EXTENSIONS = ["webm", "mp4", "mov", "m4v", "avi", "mkv"];

export function registerWallpaperVideoHandler() {
	ipcMain.handle("import-wallpaper-video", async (_, selectedPath: unknown) => {
		try {
			if (
				typeof selectedPath !== "string" ||
				!path.isAbsolute(selectedPath) ||
				!VIDEO_FILE_EXTENSIONS.includes(
					path.extname(selectedPath).slice(1).toLowerCase(),
				) ||
				!(await stat(selectedPath)).isFile()
			)
				return { success: false };
			approveUserPath(selectedPath);
			return { success: true, path: selectedPath };
		} catch {
			return { success: false };
		}
	});
}
