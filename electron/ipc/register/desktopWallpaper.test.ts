import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), snapshot: vi.fn(), trusted: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock("../../appPaths", () => ({ USER_DATA_PATH: "/recordly-data" }));
vi.mock("../../desktopWallpaper", () => ({ getDesktopWallpaperSnapshot: mocks.snapshot }));
vi.mock("../../trustedRenderer", () => ({ isTrustedRenderer: mocks.trusted }));
import { registerDesktopWallpaperHandler } from "./desktopWallpaper";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.trusted.mockReturnValue(true);
	mocks.snapshot.mockResolvedValue("/recordly-data/desktop-wallpapers/image.png");
});

function handler() {
	registerDesktopWallpaperHandler();
	expect(mocks.handle).toHaveBeenCalledWith("get-desktop-wallpaper", expect.any(Function));
	return mocks.handle.mock.calls[0][1] as (event: unknown) => Promise<unknown>;
}

it("returns the app-managed desktop image to the trusted renderer", async () => {
	expect(await handler()({})).toEqual({
		success: true,
		path: "/recordly-data/desktop-wallpapers/image.png",
	});
	expect(mocks.snapshot).toHaveBeenCalledWith("/recordly-data");
});

it("rejects foreign frames before querying the user's desktop", async () => {
	mocks.trusted.mockReturnValue(false);
	expect(await handler()({})).toMatchObject({ success: false });
	expect(mocks.snapshot).not.toHaveBeenCalled();
});

it("shares an in-flight import, handles errors, and allows a later retry", async () => {
	let finish!: (path: string) => void;
	mocks.snapshot.mockReturnValueOnce(
		new Promise<string>((resolve) => {
			finish = resolve;
		}),
	);
	const invoke = handler();
	const first = invoke({});
	const second = invoke({});
	expect(mocks.snapshot).toHaveBeenCalledTimes(1);
	finish("/recordly-data/desktop-wallpapers/shared.png");
	expect(await first).toEqual(await second);
	mocks.snapshot.mockRejectedValueOnce(new Error("private source path"));
	expect(await invoke({})).toEqual({
		success: false,
		error: "Desktop wallpaper image is unavailable",
	});
	expect(await invoke({})).toMatchObject({ success: true });
});
