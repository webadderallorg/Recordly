import { ipcMain } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { getDesktopWallpaperSnapshot } from "../../desktopWallpaper";
import { isTrustedRenderer } from "../../trustedRenderer";

export function registerDesktopWallpaperHandler() {
	let pending: Promise<string> | undefined;
	ipcMain.handle("get-desktop-wallpaper", async (event) => {
		if (!isTrustedRenderer(event))
			return { success: false, error: "Untrusted wallpaper request" };
		try {
			// Decode one full-resolution image at a time when editor and picker mount together.
			pending ??= getDesktopWallpaperSnapshot(USER_DATA_PATH);
			const path = await pending;
			return { success: true, path };
		} catch {
			return { success: false, error: "Desktop wallpaper image is unavailable" };
		} finally {
			pending = undefined;
		}
	});
}
