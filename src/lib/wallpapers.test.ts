import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BUILT_IN_WALLPAPERS,
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	getAvailableWallpapers,
	resolveAvailableWallpaperPath,
} from "./wallpapers";

describe("wallpapers", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps the curated wallpaper list and default path aligned", () => {
		expect(DEFAULT_WALLPAPER_PATH).toBe("/wallpapers/tahoe-light.jpg");
		expect(DEFAULT_WALLPAPER_RELATIVE_PATH).toBe("wallpapers/tahoe-light.jpg");
		expect(BUILT_IN_WALLPAPERS.at(0)?.publicPath).toBe(DEFAULT_WALLPAPER_PATH);
		expect(BUILT_IN_WALLPAPERS.at(1)?.publicPath).toBe("/wallpapers/tahoe-dark.jpg");
		expect(BUILT_IN_WALLPAPERS).toHaveLength(25);
	});

	it("preserves the curated order when asset discovery returns extra files", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				listAssetDirectory: vi.fn(async () => ({
					success: true,
					files: [
						"wallpaper1.jpg",
						"energy-17.jpg",
						"midnight-8.jpg",
						"wallpaper4.jpg",
						"wispysky.mp4",
						"cityscape.jpg",
						"ipad-17-light.jpg",
					],
				})),
			},
		});

		await expect(getAvailableWallpapers()).resolves.toEqual([
			BUILT_IN_WALLPAPERS[2],
			BUILT_IN_WALLPAPERS[4],
			BUILT_IN_WALLPAPERS[15],
			BUILT_IN_WALLPAPERS[16],
			BUILT_IN_WALLPAPERS[23],
			BUILT_IN_WALLPAPERS[24],
		]);
	});

	it("falls back to the default wallpaper when a bundled wallpaper is missing", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				listAssetDirectory: vi.fn().mockResolvedValue({
					success: true,
					files: ["wallpaper2.jpg"],
				}),
			},
		});

		await expect(resolveAvailableWallpaperPath("/wallpapers/midnight-8.jpg")).resolves.toBe(
			DEFAULT_WALLPAPER_PATH,
		);
		await expect(resolveAvailableWallpaperPath("/wallpapers/wallpaper2.jpg")).resolves.toBe(
			"/wallpapers/wallpaper2.jpg",
		);
	});

	it("preserves non-bundled wallpaper values", async () => {
		await expect(resolveAvailableWallpaperPath("#123456")).resolves.toBe("#123456");
		await expect(resolveAvailableWallpaperPath("data:image/png;base64,abc")).resolves.toBe(
			"data:image/png;base64,abc",
		);
	});
});
