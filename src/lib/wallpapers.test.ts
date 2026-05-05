import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	BUILT_IN_WALLPAPERS,
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	getAvailableWallpapers,
} from "./wallpapers";

describe("wallpapers", () => {
	beforeEach(() => {
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
});