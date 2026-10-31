import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	status: vi.fn(),
	sources: vi.fn(),
	open: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (key: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(key, handler),
	},
	desktopCapturer: { getSources: mocks.sources },
	systemPreferences: { getMediaAccessStatus: mocks.status },
	shell: { openExternal: mocks.open },
}));
vi.mock("../utils", () => ({ getMacPrivacySettingsUrl: (pane: string) => `settings:${pane}` }));
import { registerPermissionHandlers } from "./permissions";
const platform = process.platform;
afterEach(() => Object.defineProperty(process, "platform", { value: platform }));
beforeEach(() => {
	vi.resetAllMocks();
	Object.defineProperty(process, "platform", { value: "darwin" });
	mocks.handlers.clear();
	registerPermissionHandlers();
});
it("does not prompt or open settings merely by registering permission handlers", () => {
	expect(mocks.sources).not.toHaveBeenCalled();
	expect(mocks.open).not.toHaveBeenCalled();
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
});
