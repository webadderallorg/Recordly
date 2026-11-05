import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	app: { isPackaged: true },
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	status: vi.fn(),
	requestMedia: vi.fn(),
	sources: vi.fn(),
	open: vi.fn(),
	accessory: vi.fn(),
}));
vi.mock("./permissionAccessory", () => ({
	showPermissionAccessory: mocks.accessory,
	startPermissionAccessoryDrag: vi.fn(),
	dismissPermissionAccessory: vi.fn(),
}));
vi.mock("electron", () => ({
	app: mocks.app,
	ipcMain: {
		handle: (key: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(key, handler),
	},
	desktopCapturer: { getSources: mocks.sources },
	systemPreferences: {
		getMediaAccessStatus: mocks.status,
		askForMediaAccess: mocks.requestMedia,
	},
	shell: { openExternal: mocks.open },
}));
vi.mock("../utils", () => ({ getMacPrivacySettingsUrl: (pane: string) => `settings:${pane}` }));
import { registerPermissionHandlers } from "./permissions";
const platform = process.platform;
afterEach(() => Object.defineProperty(process, "platform", { value: platform }));
beforeEach(() => {
	vi.resetAllMocks();
	mocks.app.isPackaged = true;
	Object.defineProperty(process, "platform", { value: "darwin" });
	mocks.handlers.clear();
	registerPermissionHandlers();
});
it("does not prompt or open settings merely by registering permission handlers", () => {
	expect(mocks.sources).not.toHaveBeenCalled();
	expect(mocks.open).not.toHaveBeenCalled();
});

it("reports microphone and camera status without requesting access", async () => {
	mocks.status.mockImplementation((device: string) =>
		device === "microphone" ? "denied" : "not-determined",
	);
	expect(await mocks.handlers.get("get-media-permission-status")!()).toEqual({
		success: true,
		microphone: "denied",
		camera: "not-determined",
	});
	expect(mocks.status.mock.calls).toEqual([["microphone"], ["camera"]]);
	expect(mocks.requestMedia).not.toHaveBeenCalled();
	expect(mocks.sources).not.toHaveBeenCalled();
	expect(mocks.open).not.toHaveBeenCalled();
});

it.each([
	"win32",
	"linux",
])("reports unknown media access on %s without querying native permissions", async (platform) => {
	Object.defineProperty(process, "platform", { value: platform });
	expect(await mocks.handlers.get("get-media-permission-status")!()).toEqual({
		success: true,
		microphone: "unknown",
		camera: "unknown",
	});
	expect(mocks.status).not.toHaveBeenCalled();
	expect(mocks.requestMedia).not.toHaveBeenCalled();
});

it("reports permission inspection failures without claiming access is granted", async () => {
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	mocks.status.mockImplementation(() => {
		throw new Error("Permission service unavailable");
	});
	expect(await mocks.handlers.get("get-media-permission-status")!()).toEqual({
		success: false,
		microphone: "unknown",
		camera: "unknown",
		error: "Error: Permission service unavailable",
	});
	expect(mocks.requestMedia).not.toHaveBeenCalled();
	log.mockRestore();
});

it.each(["microphone", "camera"])("opens %s settings without requesting access", async (device) => {
	expect(
		await mocks.handlers.get("open-media-permission-preferences")!(undefined, device),
	).toEqual({ success: true });
	expect(mocks.open).toHaveBeenCalledWith(`settings:${device}`);
	expect(mocks.status).not.toHaveBeenCalled();
	expect(mocks.requestMedia).not.toHaveBeenCalled();
	expect(mocks.sources).not.toHaveBeenCalled();
	expect(mocks.accessory).not.toHaveBeenCalled();
});

it.each([
	undefined,
	null,
	"screen",
	"https://example.com",
	{},
	1,
])("rejects invalid media settings device %j", async (device) => {
	expect(
		await mocks.handlers.get("open-media-permission-preferences")!(undefined, device),
	).toEqual({
		success: false,
		error: "Invalid media permission device",
	});
	expect(mocks.open).not.toHaveBeenCalled();
});

it.each(["win32", "linux"])("rejects opening media settings on %s", async (platform) => {
	Object.defineProperty(process, "platform", { value: platform });
	expect(
		await mocks.handlers.get("open-media-permission-preferences")!(undefined, "camera"),
	).toEqual({
		success: false,
		error: "Media permission settings are unsupported on this platform",
	});
	expect(mocks.open).not.toHaveBeenCalled();
	expect(mocks.requestMedia).not.toHaveBeenCalled();
});

it("reports a failure to open media settings", async () => {
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	mocks.open.mockRejectedValue(new Error("Unable to open settings"));
	expect(
		await mocks.handlers.get("open-media-permission-preferences")!(undefined, "microphone"),
	).toEqual({
		success: false,
		error: "Error: Unable to open settings",
	});
	log.mockRestore();
});
it("registers first-time Screen Recording access before opening its settings", async () => {
	mocks.status.mockReturnValue("not-determined");
	mocks.sources.mockResolvedValue([]);
	expect(await mocks.handlers.get("open-screen-recording-preferences")!()).toEqual({
		success: true,
	});
	expect(mocks.sources).toHaveBeenCalledWith({
		types: ["screen"],
		thumbnailSize: { width: 0, height: 0 },
	});
	expect(mocks.sources.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.open.mock.invocationCallOrder[0],
	);
	expect(mocks.open).toHaveBeenCalledWith("settings:screen");
});
it("opens settings even when the first-time capture request is rejected", async () => {
	mocks.status.mockReturnValue("not-determined");
	mocks.sources.mockRejectedValue(new Error("Denied"));
	expect(await mocks.handlers.get("open-screen-recording-preferences")!()).toEqual({
		success: true,
	});
	expect(mocks.open).toHaveBeenCalledWith("settings:screen");
});
it("does not enumerate screens for an already determined permission", async () => {
	mocks.status.mockReturnValue("denied");
	await mocks.handlers.get("open-screen-recording-preferences")!();
	expect(mocks.sources).not.toHaveBeenCalled();
	expect(mocks.open).toHaveBeenCalledWith("settings:screen");
});
it("leaves native macOS permission controls unused on other platforms", async () => {
	Object.defineProperty(process, "platform", { value: "win32" });
	expect(await mocks.handlers.get("open-screen-recording-preferences")!()).toEqual({
		success: true,
	});
	expect(mocks.sources).not.toHaveBeenCalled();
	expect(mocks.open).not.toHaveBeenCalled();
	expect(mocks.accessory).not.toHaveBeenCalled();
});

it("presents the native accessory after opening Settings with the originating sender", async () => {
	const sender = {};
	await mocks.handlers.get("open-accessibility-preferences")!({ sender });
	expect(mocks.accessory).toHaveBeenCalledWith("accessibility", sender, false);
	expect(mocks.open.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.accessory.mock.invocationCallOrder[0],
	);
});

it("keeps ordinary System Settings usable if its accessory cannot start", async () => {
	const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
	mocks.accessory.mockRejectedValueOnce(new Error("helper missing"));
	expect(await mocks.handlers.get("open-accessibility-preferences")!()).toEqual({
		success: true,
	});
	expect(mocks.open).toHaveBeenCalledWith("settings:accessibility");
	warning.mockRestore();
});

it.each([
	"screen",
	"accessibility",
])("development %s preview opens real Settings and requests a persistent native accessory", async (permission) => {
	mocks.app.isPackaged = false;
	mocks.status.mockReturnValue("not-determined");
	const sender = {};
	const channel =
		permission === "screen"
			? "open-screen-recording-preferences"
			: "open-accessibility-preferences";
	await mocks.handlers.get(channel)!({ sender }, true);
	expect(mocks.open).toHaveBeenCalledWith(`settings:${permission}`);
	expect(mocks.accessory).toHaveBeenCalledWith(permission, sender, true);
	expect(mocks.sources).not.toHaveBeenCalled();
});

it("packaged apps cannot bypass granted-permission suppression with the dev preview flag", async () => {
	const sender = {};
	await mocks.handlers.get("open-accessibility-preferences")!({ sender }, true);
	expect(mocks.accessory).toHaveBeenCalledWith("accessibility", sender, false);
});
