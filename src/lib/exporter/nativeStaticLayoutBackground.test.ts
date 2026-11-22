import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeStaticLayoutBackgroundAssets } from "./nativeStaticLayoutBackground";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function createAssets(wallpaper: string) {
	return new NativeStaticLayoutBackgroundAssets({ wallpaper, width: 1920, height: 1080 });
}

function mockExportStream() {
	const api = {
		openExportStream: vi.fn(async () => ({ success: true, streamId: "background-stream" })),
		writeExportStreamChunk: vi.fn(async () => ({ success: true })),
		closeExportStream: vi.fn(async () => ({ success: true, tempPath: "/tmp/background.png" })),
		discardExportedTemp: vi.fn(async () => ({ success: true })),
	};
	vi.stubGlobal("window", { electronAPI: api });
	return api;
}

describe("native static-layout background asset lifecycle", () => {
	it("writes an image to a native temporary asset and releases only that asset", async () => {
		const api = mockExportStream();
		const bytes = new Uint8Array([137, 80, 78, 71]);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(bytes, {
						headers: { "Content-Type": "image/png" },
					}),
			),
		);
		const assets = createAssets("blob:uploaded-wallpaper");

		const background = await assets.resolve();
		expect(background).toEqual({
			backgroundColor: "#101010",
			backgroundImagePath: "/tmp/background.png",
			temporaryPath: "/tmp/background.png",
		});
		expect(api.openExportStream).toHaveBeenCalledWith({ extension: "png" });
		expect(api.writeExportStreamChunk).toHaveBeenCalledWith("background-stream", 0, bytes);
		expect(api.closeExportStream).toHaveBeenCalledWith("background-stream");
		expect(assets.skipReason).toBeNull();

		await assets.cleanup(background);
		expect(api.discardExportedTemp).toHaveBeenCalledExactlyOnceWith("/tmp/background.png");
		await assets.cleanup({ backgroundColor: "#ffffff", backgroundImagePath: "/wallpaper.png" });
		expect(api.discardExportedTemp).toHaveBeenCalledTimes(1);
	});

	it("aborts an allocated stream on a write failure and reports the fallback reason", async () => {
		const api = mockExportStream();
		api.writeExportStreamChunk.mockRejectedValueOnce(new Error("disk full"));
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(new Uint8Array([1]), {
						headers: { "Content-Type": "image/png" },
					}),
			),
		);
		const assets = createAssets("data:image/png;base64,AQ==");

		await expect(assets.resolve()).resolves.toBeNull();
		expect(api.closeExportStream).toHaveBeenCalledExactlyOnceWith("background-stream", {
			abort: true,
		});
		expect(assets.skipReason).toBe("unsupported-background-image-materialize-failed");
	});

	it("rejects a fetched non-image without opening a native stream", async () => {
		const api = mockExportStream();
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("not an image", {
						headers: { "Content-Type": "text/plain" },
					}),
			),
		);
		const assets = createAssets("blob:invalid-wallpaper");

		await expect(assets.resolve()).resolves.toBeNull();
		expect(api.openExportStream).not.toHaveBeenCalled();
		expect(assets.skipReason).toBe("unsupported-background-image-materialize-failed");
	});

	it("resets the previous skip reason when the next wallpaper is compatible", async () => {
		vi.stubGlobal("window", { electronAPI: {} });
		const config = {
			wallpaper: "https://example.com/wallpaper.png",
			width: 1920,
			height: 1080,
		};
		const assets = new NativeStaticLayoutBackgroundAssets(config);
		await expect(assets.resolve()).resolves.toBeNull();
		expect(assets.skipReason).toBe("unsupported-background-remote");

		config.wallpaper = "123abc";
		await expect(assets.resolve()).resolves.toEqual({
			backgroundColor: "#123abc",
			backgroundImagePath: null,
		});
		expect(assets.skipReason).toBeNull();
	});

	it("keeps temporary cleanup best effort when the native deletion fails", async () => {
		const api = mockExportStream();
		api.discardExportedTemp.mockRejectedValueOnce(new Error("file is already gone"));
		await expect(
			createAssets("#ffffff").cleanup({
				backgroundColor: "#101010",
				backgroundImagePath: "/tmp/background.png",
				temporaryPath: "/tmp/background.png",
			}),
		).resolves.toBeUndefined();
	});
});

describe("native bundled background containment", () => {
	function resolveBundled(assetPath: string) {
		return (
			createAssets("#ffffff") as unknown as {
				resolveBundledAssetPath: (path: string) => Promise<string | null>;
			}
		).resolveBundledAssetPath(assetPath);
	}

	it.each([
		true,
		false,
	])("rejects nested, encoded and backslash path escapes with directory probe=%s", async (probe) => {
		vi.stubGlobal("window", {
			electronAPI: {
				getAssetBasePath: vi.fn(async () => "file:///Recordly/resources/"),
				...(probe
					? {
							listAssetDirectory: vi.fn(async () => ({
								success: true,
								files: ["known.jpg"],
							})),
						}
					: {}),
			},
		});
		for (const asset of [
			"/wallpapers/known.jpg/../../../../private.png",
			"/wallpapers/../private.png",
			"/wallpapers/%2e%2e/private.png",
			"/wallpapers/known.jpg\\..\\..\\private.png",
			"/wallpapers/%2e%2e%2fprivate.png",
			"/wallpapers/%2e%2e%5cprivate.png",
			"/wallpapers/%2fprivate.png",
			"/wallpapers/%",
			"/wallpapers//known.jpg",
			"/wallpapers/.",
			"/app-icons/..",
			"/wallpapers/..%20",
			"/wallpapers/...",
			"/wallpapers/known.jpg.",
			"/wallpapers/known.jpg%20",
			"/wallpapers/C%3aprivate.png",
			"/wallpapers/known.jpg%3astream",
			"/wallpapers/%00hidden.png",
			"/wallpapers/tab%09.jpg",
			"/wallpapers/control%7f.png",
		]) {
			await expect(resolveBundled(asset), asset).resolves.toBeNull();
		}
	});

	it.each([
		"file:///Recordly/resources/",
		"file:///C:/Recordly/resources/",
	])("preserves valid bundled filenames under %s", async (base) => {
		vi.stubGlobal("window", {
			electronAPI: {
				getAssetBasePath: vi.fn(async () => base),
				listAssetDirectory: vi.fn(async () => ({
					success: true,
					files: ["known file.jpg"],
				})),
			},
		});
		const result = await resolveBundled("/wallpapers/known%20file.jpg");
		expect(result?.replace(/\\/g, "/")).toMatch(
			/(?:C:)?\/Recordly\/resources\/wallpapers\/known file\.jpg$/,
		);
	});
});
