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
			location: { protocol: "http:", origin: "http://127.0.0.1:54321" },
			electronAPI: {
				getAssetBasePath: vi.fn(
					async () => "file:///Applications/Recordly.app/Contents/Resources/assets/",
				),
			},
		});

		await expect(getAssetPath("wallpapers/tahoe-light.jpg")).resolves.toBe(
			"http://127.0.0.1:54321/__recordly_assets/wallpapers/tahoe-light.jpg",
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

	it("refreshes persisted file URLs through approved local media transport", async () => {
		const getLocalMediaUrl = vi.fn(async () => ({
			success: true,
			url: "http://127.0.0.1:4321/video?path=recording&token=capability",
		}));
		vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });
		await expect(getRenderableVideoUrl("file:///Users/egg/My%20video.mp4")).resolves.toContain(
			"token=capability",
		);
		expect(getLocalMediaUrl).toHaveBeenCalledWith("/Users/egg/My video.mp4");
	});

	it.each([
		"file:///Users/egg/100%.mp4",
		"file:///Users/egg/bad%E0%A4.mp4",
	])("preserves malformed persisted file URLs without rejecting: %s", async (asset) => {
		const getLocalMediaUrl = vi.fn();
		vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });
		await expect(getRenderableVideoUrl(asset)).resolves.toBe(asset);
		expect(getLocalMediaUrl).not.toHaveBeenCalled();
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
	const generateWallpaperThumbnail = vi.fn(async () => ({
		success: true,
		data: new Uint8Array([255, 216, 255]),
	}));
	vi.stubGlobal("window", {
		location: { protocol: "http:" },
		electronAPI: { getAssetBasePath: async () => null, generateWallpaperThumbnail },
	});
	const url = await getWallpaperThumbnailUrl("/wallpapers/thumbnail-regression.jpg");
	expect(url).toBe("data:image/jpeg;base64,/9j/");
	expect(generateWallpaperThumbnail).toHaveBeenCalledWith("/wallpapers/thumbnail-regression.jpg");
	await expect(getWallpaperThumbnailUrl("/wallpapers/thumbnail-regression.jpg")).resolves.toBe(
		url,
	);
	expect(generateWallpaperThumbnail).toHaveBeenCalledTimes(1);
	vi.unstubAllGlobals();
});

it("generates a small thumbnail for an absolute desktop snapshot", async () => {
	const generateWallpaperThumbnail = vi.fn(async () => ({
		success: true,
		data: new Uint8Array([255, 216, 255]),
	}));
	const getAssetBasePath = vi.fn();
	vi.stubGlobal("window", {
		location: { protocol: "http:" },
		electronAPI: { getAssetBasePath, generateWallpaperThumbnail },
	});
	const file = `/Users/example/Recordly/desktop-wallpapers/${"d".repeat(64)}.png`;
	try {
		await expect(getWallpaperThumbnailUrl(file)).resolves.toBe("data:image/jpeg;base64,/9j/");
		expect(generateWallpaperThumbnail).toHaveBeenCalledWith(file);
		expect(getAssetBasePath).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
	}
});

it("shares concurrent wallpaper thumbnail requests rather than decoding twice", async () => {
	let finish!: (value: { success: boolean; data: Uint8Array }) => void;
	const generateWallpaperThumbnail = vi.fn(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	vi.stubGlobal("window", { electronAPI: { generateWallpaperThumbnail } });
	try {
		const first = getWallpaperThumbnailUrl("/wallpapers/concurrent.jpg");
		const second = getWallpaperThumbnailUrl("/wallpapers/concurrent.jpg");
		await vi.waitFor(() => expect(generateWallpaperThumbnail).toHaveBeenCalledOnce());
		finish({ success: true, data: new Uint8Array([255, 216, 255]) });
		expect(await second).toBe(await first);
		expect(generateWallpaperThumbnail).toHaveBeenCalledOnce();
	} finally {
		vi.unstubAllGlobals();
	}
});

it("allows a wallpaper cache read to bypass unrelated slow generations", async () => {
	const finish: Array<(value: { success: boolean; data: Uint8Array }) => void> = [];
	const generateWallpaperThumbnail = vi.fn((asset: string) => {
		if (asset.includes("slow-")) return new Promise((resolve) => finish.push(resolve));
		return Promise.resolve({ success: true, data: new Uint8Array([255, 216, 255]) });
	});
	vi.stubGlobal("window", { electronAPI: { generateWallpaperThumbnail } });
	try {
		const slow = [1, 2, 3].map((index) =>
			getWallpaperThumbnailUrl(`/wallpapers/slow-${index}.jpg`),
		);
		await vi.waitFor(() => expect(finish).toHaveLength(3));
		await expect(getWallpaperThumbnailUrl("/wallpapers/disk-hit.jpg")).resolves.toBe(
			"data:image/jpeg;base64,/9j/",
		);
		for (const resolve of finish)
			resolve({ success: true, data: new Uint8Array([255, 216, 255]) });
		await Promise.all(slow);
	} finally {
		vi.unstubAllGlobals();
	}
});
