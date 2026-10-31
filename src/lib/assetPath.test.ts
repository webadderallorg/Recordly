import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAssetPath,
	getWallpaperThumbnailUrl,
	getExportableVideoUrl,
	getRenderableAssetUrl,
	getRenderableVideoUrl,
} from "./assetPath";

describe("getAssetPath", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses the packaged asset directory from an HTTP renderer", async () => {
		vi.stubGlobal("window", {
			location: { protocol: "http:" },
			electronAPI: {
				getAssetBasePath: vi.fn(
					async () => "file:///Applications/Recordly.app/Contents/Resources/assets/",
				),
			},
		});

		await expect(getAssetPath("wallpapers/tahoe-light.jpg")).resolves.toBe(
			"file:///Applications/Recordly.app/Contents/Resources/assets/wallpapers/tahoe-light.jpg",
		);
	});

	it("uses root-relative assets when the dev server has no packaged asset base", async () => {
		vi.stubGlobal("window", {
			location: { protocol: "http:" },
			electronAPI: {
				getAssetBasePath: vi.fn(async () => null),
			},
		});

		await expect(getAssetPath("wallpapers/tahoe-light.jpg")).resolves.toBe(
			"/wallpapers/tahoe-light.jpg",
		);
	});
});

describe("getRenderableAssetUrl", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps absolute POSIX image paths on the local-file path", async () => {
		const readLocalFile = vi.fn(async () => ({
			success: false,
		}));
		vi.stubGlobal("window", {
			electronAPI: {
				readLocalFile,
			},
		});

		await expect(getRenderableAssetUrl("/Users/egg/Desktop/bg.jpg")).resolves.toBe(
			"file:///Users/egg/Desktop/bg.jpg",
		);
		expect(readLocalFile).toHaveBeenCalledWith("/Users/egg/Desktop/bg.jpg");
	});
});

describe("getRenderableVideoUrl", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses the local media server for absolute local video paths when available", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				getLocalMediaUrl: vi.fn(async (filePath: string) => ({
					success: true,
					url: `http://127.0.0.1:4321/video?path=${encodeURIComponent(filePath)}`,
				})),
			},
		});

		await expect(getRenderableVideoUrl("/Users/egg/Desktop/bg.mp4")).resolves.toBe(
			"http://127.0.0.1:4321/video?path=%2FUsers%2Fegg%2FDesktop%2Fbg.mp4",
		);
	});

	it("falls back to a file URL for absolute local video paths", async () => {
		await expect(getRenderableVideoUrl("/Users/egg/Desktop/bg.mp4")).resolves.toBe(
			"file:///Users/egg/Desktop/bg.mp4",
		);
	});

	it("keeps bundled wallpaper paths routed through the app asset directory", async () => {
		vi.stubGlobal("window", {
			location: {
				protocol: "http:",
			},
		});

		await expect(getRenderableVideoUrl("/wallpapers/wispysky.mp4")).resolves.toBe(
			"/wallpapers/wispysky.mp4",
		);
	});
});

describe("getExportableVideoUrl", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses a direct file URL for absolute local video paths", async () => {
		await expect(getExportableVideoUrl("/Users/egg/Desktop/bg.mp4")).resolves.toBe(
			"file:///Users/egg/Desktop/bg.mp4",
		);
	});

	it("keeps bundled wallpaper paths routed through the app asset directory", async () => {
		vi.stubGlobal("window", {
			location: {
				protocol: "http:",
			},
		});

		await expect(getExportableVideoUrl("/wallpapers/wispysky.mp4")).resolves.toBe(
			"/wallpapers/wispysky.mp4",
		);
	});
});

 it("requests a cached thumbnail for a dev wallpaper instead of loading the original", async () => {
  const generateWallpaperThumbnail = vi.fn(async () => ({ success: true, data: new Uint8Array([255, 216, 255]) }));
  vi.stubGlobal("window", { location: { protocol: "http:" }, electronAPI: { getAssetBasePath: async () => null, generateWallpaperThumbnail } });
  const url = await getWallpaperThumbnailUrl("/wallpapers/thumbnail-regression.jpg");
  expect(url).toBe("data:image/jpeg;base64,/9j/");
  expect(generateWallpaperThumbnail).toHaveBeenCalledWith("/wallpapers/thumbnail-regression.jpg");
  await expect(getWallpaperThumbnailUrl("/wallpapers/thumbnail-regression.jpg")).resolves.toBe(url);
  expect(generateWallpaperThumbnail).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
 });
