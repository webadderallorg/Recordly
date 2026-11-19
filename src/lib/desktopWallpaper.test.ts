import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DESKTOP_WALLPAPER,
	desktopWallpaperPreference,
	getDesktopWallpaperPath,
} from "./desktopWallpaper";
import { getAvailableWallpapers } from "./wallpapers";
import { usePlaybackWallpaper } from "../components/video-editor/videoPlayback/usePlaybackWallpaper";

const playback = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", () => ({
	useState: (initial: unknown) => {
		const index = playback.cursor++;
		playback.values[index] = initial;
		return [
			initial,
			(value: unknown) => {
				playback.values[index] = value;
			},
		];
	},
	useEffect: (effect: () => void) => effect(),
}));

afterEach(() => vi.unstubAllGlobals());

describe("desktop wallpaper", () => {
	it.each([
		[
			String.raw`C:\Users\Example\desktop image.png`,
			"file:///C:/Users/Example/desktop%20image.png",
		],
		[String.raw`\\server\share\desktop image.png`, "file://server/share/desktop%20image.png"],
		["/Users/Example/desktop image.png", "file:///Users/Example/desktop%20image.png"],
	])("previews an absolute desktop image without treating %s as a bundled asset", async (path, url) => {
		const getAssetBasePath = vi.fn(async () => "file:///app/assets/");
		vi.stubGlobal("window", {
			location: { protocol: "http:", origin: "http://localhost" },
			electronAPI: {
				getDesktopWallpaper: vi.fn(async () => ({ success: true, path })),
				getAssetBasePath,
				readLocalFile: vi.fn(async () => ({ success: false })),
			},
		});
		const originalPath = await getDesktopWallpaperPath();
		playback.values = [];
		playback.cursor = 0;
		usePlaybackWallpaper({
			wallpaper: originalPath ?? "",
			previewViewportWidth: 1000,
			backgroundBlur: 0,
			showShadow: false,
			shadowIntensity: 0,
			lockedVideoDimensionsRef: { current: null },
			videoRef: { current: null },
		} as Parameters<typeof usePlaybackWallpaper>[0]);
		await vi.waitFor(() => expect(playback.values[0]).toBe(url));
		expect(playback.values[1]).toBe("image");
		expect(getAssetBasePath).not.toHaveBeenCalled();
		expect(originalPath).toBe(path);
	});

	it.each([
		"/wallpapers/tahoe-light.jpg",
		"wallpapers/tahoe-light.jpg",
	])("preserves bundled wallpaper URL resolution for %s", async (path) => {
		const getAssetBasePath = vi.fn(async () => "file:///app/assets/");
		vi.stubGlobal("window", {
			location: { protocol: "http:", origin: "http://localhost" },
			electronAPI: { getAssetBasePath },
		});
		playback.values = [];
		playback.cursor = 0;
		usePlaybackWallpaper({
			wallpaper: path,
			previewViewportWidth: 1000,
			backgroundBlur: 0,
			showShadow: false,
			shadowIntensity: 0,
			lockedVideoDimensionsRef: { current: null },
			videoRef: { current: null },
		} as Parameters<typeof usePlaybackWallpaper>[0]);
		await vi.waitFor(() =>
			expect(playback.values[0]).toBe(
				"http://localhost/__recordly_assets/wallpapers/tahoe-light.jpg",
			),
		);
		expect(playback.values[1]).toBe("image");
		expect(getAssetBasePath).toHaveBeenCalledOnce();
	});

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
