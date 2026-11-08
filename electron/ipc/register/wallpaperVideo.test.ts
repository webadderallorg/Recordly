import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Handler = (event: unknown, value: unknown) => Promise<{ success: boolean; path?: string }>;
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), approve: vi.fn() }));
vi.mock("electron", () => ({
	ipcMain: { handle: (name: string, fn: Handler) => mocks.handlers.set(name, fn) },
}));
vi.mock("../utils", () => ({ approveUserPath: mocks.approve }));

import { registerWallpaperVideoHandler } from "./wallpaperVideo";

let folder: string;
beforeEach(async () => {
	folder = await mkdtemp(path.join(os.tmpdir(), "recordly-wallpaper-"));
	mocks.approve.mockClear();
	registerWallpaperVideoHandler();
});
afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});
const call = (value: unknown) => mocks.handlers.get("import-wallpaper-video")!({}, value);
it("approves a selected local WebM without changing the current project", async () => {
	const file = path.join(folder, "background.WEBM");
	await writeFile(file, "selected video");
	expect(await call(file)).toEqual({ success: true, path: file });
	expect(mocks.approve).toHaveBeenCalledWith(file);
});
it("does not authorize missing files, directories, non-video files or non-local paths", async () => {
	const image = path.join(folder, "image.png");
	const directory = path.join(folder, "directory.webm");
	await writeFile(image, "image");
	await mkdir(directory);
	for (const value of [
		null,
		"relative.webm",
		"https://example.com/video.webm",
		path.join(folder, "missing.mp4"),
		image,
		directory,
	]) {
		expect(await call(value)).toEqual({ success: false });
	}
	expect(mocks.approve).not.toHaveBeenCalled();
});
