import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ipcMain } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
	allowed: new Set<string>(),
	assetRoot: "",
	userData: "",
	decode: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { getAppPath: () => "/recordly", isPackaged: true },
	ipcMain: { handle: vi.fn() },
	nativeImage: { createFromPath: state.decode },
}));
vi.mock("../../appPaths", () => ({
	get USER_DATA_PATH() {
		return state.userData;
	},
}));
vi.mock("../../rendererServer", () => ({
	getPackagedRendererBaseUrl: () => "http://127.0.0.1:43820",
}));
vi.mock("../project/manager", () => ({
	getAssetRootPath: () => state.assetRoot,
	isAllowedLocalReadPath: (candidate: string) => state.allowed.has(candidate),
}));
vi.mock("../utils", () => ({ normalizePath: (value: string) => path.resolve(value) }));
import { registerAssetHandlers } from "./assets";
let directory: string;
const frame = { url: "file:///recordly/dist/index.html?windowType=editor" };
const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as Electron.IpcMainInvokeEvent;
let handlers: Map<string, Parameters<typeof ipcMain.handle>[1]>;
beforeEach(async () => {
	directory = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "recordly-assets-security-")),
	);
	state.assetRoot = directory;
	state.userData = path.join(directory, "user-data");
	state.decode.mockReset().mockReturnValue({
		isEmpty: () => false,
		getSize: () => ({ width: 100, height: 100 }),
		resize: () => ({ toJPEG: () => Buffer.from("jpeg") }),
	});
	state.allowed.clear();
	vi.mocked(ipcMain.handle).mockClear();
	registerAssetHandlers();
	handlers = new Map(vi.mocked(ipcMain.handle).mock.calls);
});
afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

it("reads approved imported, generated and bundled assets", async () => {
	for (const name of ["imported.jpg", "export.mp4", "bundled.svg"]) {
		const file = path.join(directory, name);
		await fs.writeFile(file, name);
		state.allowed.add(file);
		const result = await handlers.get("read-local-file")!(trusted, file);
		expect(result.success).toBe(true);
		expect(Buffer.from(result.data).toString()).toBe(name);
	}
});

it("rejects an existing unapproved file and a symlink to an unapproved target", async () => {
	const file = path.join(directory, "private.txt");
	await fs.writeFile(file, "private");
	const symlink = path.join(directory, "approved.jpg");
	await fs.symlink(file, symlink);
	state.allowed.add(symlink);
	for (const target of [file, symlink]) {
		expect(await handlers.get("read-local-file")!(trusted, target)).toMatchObject({
			success: false,
		});
	}
});

it("rejects foreign and embedded frames even for an approved file", async () => {
	const file = path.join(directory, "approved.jpg");
	await fs.writeFile(file, "image");
	state.allowed.add(file);
	for (const foreign of [false, true]) {
		const senderFrame = { url: foreign ? "https://foreign.test/" : frame.url };
		const event = {
			sender: foreign ? { mainFrame: senderFrame } : trusted.sender,
			senderFrame,
		};
		expect(
			await handlers.get("read-local-file")!(event as Electron.IpcMainInvokeEvent, file),
		).toMatchObject({
			success: false,
		});
	}
});

it("preserves the native packaged asset path metadata", () => {
	expect(handlers.get("get-asset-base-path")!(trusted)).toBe(
		pathToFileURL(`${state.assetRoot}${path.sep}`).href,
	);
});

it("only decodes approved imported and bundled thumbnails", async () => {
	await fs.mkdir(path.join(directory, "wallpapers"));
	for (const [candidate, file] of [
		[path.join(directory, "imported.jpg"), path.join(directory, "imported.jpg")],
		["/wallpapers/bundled.jpg", path.join(directory, "wallpapers", "bundled.jpg")],
	]) {
		await fs.writeFile(file, "image");
		state.allowed.add(file);
		expect(
			await handlers.get("generate-wallpaper-thumbnail")!(trusted, candidate),
		).toMatchObject({ success: true, data: Buffer.from("jpeg") });
		expect(state.decode).toHaveBeenCalledWith(file);
	}
});

it("rejects unapproved thumbnail paths and foreign senders before native decoding", async () => {
	const file = path.join(directory, "private.jpg");
	await fs.writeFile(file, "private-image");
	const handler = handlers.get("generate-wallpaper-thumbnail")!;
	expect(await handler(trusted, file)).toMatchObject({ success: false });
	state.allowed.add(file);
	const senderFrame = { ...frame };
	expect(
		await handler({ sender: trusted.sender, senderFrame } as Electron.IpcMainInvokeEvent, file),
	).toMatchObject({ success: false });
	expect(state.decode).not.toHaveBeenCalled();
});

it("rejects thumbnail symlink targets outside approved paths", async () => {
	const target = path.join(directory, "private.jpg");
	const link = path.join(directory, "approved.jpg");
	await fs.writeFile(target, "private-image");
	await fs.symlink(target, link);
	state.allowed.add(link);
	expect(await handlers.get("generate-wallpaper-thumbnail")!(trusted, link)).toMatchObject({
		success: false,
	});
	expect(state.decode).not.toHaveBeenCalled();
});

it("keeps directory listings within the canonical asset root", async () => {
	state.assetRoot = path.join(directory, "assets");
	const outside = path.join(directory, "private");
	await fs.mkdir(state.assetRoot);
	await fs.mkdir(outside);
	await fs.writeFile(path.join(outside, "private.txt"), "private");
	await fs.writeFile(path.join(state.assetRoot, "bundled.jpg"), "image");
	await fs.symlink(outside, path.join(state.assetRoot, "escape"));
	const list = handlers.get("list-asset-directory")!;
	expect(await list(trusted, "")).toMatchObject({ success: true, files: ["bundled.jpg"] });
	expect(await list(trusted, "escape")).toMatchObject({ success: false });
	const senderFrame = { url: "https://foreign.test/" };
	const foreign = {
		sender: { mainFrame: senderFrame },
		senderFrame,
	} as Electron.IpcMainInvokeEvent;
	expect(await list(foreign, "")).toMatchObject({ success: false });
	expect(handlers.get("get-asset-base-path")!(foreign)).toBeNull();
});
