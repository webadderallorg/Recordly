import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DESKTOP_WALLPAPER,
	desktopWallpaperPreference,
	getDesktopWallpaperPath,
} from "./desktopWallpaper";
import { getAvailableWallpapers } from "./wallpapers";

afterEach(() => vi.unstubAllGlobals());

describe("desktop wallpaper", () => {
	it("shares a single snapshot request and places it before bundled wallpapers", async () => {
		const path = `/Users/example/Recordly/desktop-wallpapers/${"a".repeat(64)}.png`;
		const getDesktopWallpaper = vi.fn(async () => ({ success: true, path }));
		vi.stubGlobal("window", { electronAPI: { getDesktopWallpaper } });
		const [selected, available] = await Promise.all([
			getDesktopWallpaperPath(),
			getAvailableWallpapers(),
		]);
		expect(selected).toBe(path);
		expect(getDesktopWallpaper).toHaveBeenCalledTimes(1);
		expect(available[0]).toMatchObject({
			id: DESKTOP_WALLPAPER,
			publicPath: path,
			label: "Desktop wallpaper",
		});
	});

	it("retains the bundled gallery when desktop retrieval fails or is unavailable", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				getDesktopWallpaper: vi.fn().mockRejectedValue(new Error("Unavailable")),
			},
		});
		expect(await getDesktopWallpaperPath()).toBeNull();
		expect((await getAvailableWallpapers())[0]).toMatchObject({
			id: "golden-gate-day-no-vignette",
			label: "Golden Gate Day",
			publicPath: "/wallpapers/golden-gate-day-no-vignette.png",
		});
		vi.stubGlobal("window", { electronAPI: {} });
		expect(await getDesktopWallpaperPath()).toBeNull();
	});

	it("remembers desktop selection for future sessions without changing explicit image choices", () => {
		expect(desktopWallpaperPreference(`/data/desktop-wallpapers/${"b".repeat(64)}.png`)).toBe(
			DESKTOP_WALLPAPER,
		);
		expect(
			desktopWallpaperPreference(`C:\\Recordly\\desktop-wallpapers\\${"c".repeat(64)}.png`),
		).toBe(DESKTOP_WALLPAPER);
		for (const path of ["/wallpapers/tahoe-light.jpg", "#112233", "/pictures/custom.png"])
			expect(desktopWallpaperPreference(path)).toBe(path);
	});

	it("refreshes the image for later sessions and retries an unavailable desktop", async () => {
		const getDesktopWallpaper = vi
			.fn()
			.mockResolvedValueOnce({ success: false })
			.mockResolvedValueOnce({ success: true, path: "/desktop/first.png" })
			.mockResolvedValueOnce({ success: true, path: "/desktop/changed.png" });
		vi.stubGlobal("window", { electronAPI: { getDesktopWallpaper } });
		expect(await getDesktopWallpaperPath()).toBeNull();
		expect(await getDesktopWallpaperPath()).toBe("/desktop/first.png");
		expect(await getDesktopWallpaperPath()).toBe("/desktop/changed.png");
	});
});
