import { ipcMain } from "electron";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolve: vi.fn(),
	buildUrl: vi.fn(),
	remember: vi.fn(),
	replace: vi.fn(),
	resolveSession: vi.fn(),
	persistSession: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { isPackaged: false, getPath: () => "/recordly-user", getAppPath: () => "/recordly" },
	ipcMain: { handle: vi.fn() },
	BrowserWindow: { getAllWindows: () => [] },
	dialog: {},
	shell: {},
}));
vi.mock("../../mediaServer", () => ({
	getMediaServerBaseUrl: () => "http://127.0.0.1:43822",
	buildMediaUrl: mocks.buildUrl,
}));
vi.mock("../../rendererServer", () => ({
	getPackagedRendererBaseUrl: () => "http://127.0.0.1:43820",
}));
vi.mock("../project/manager", () => ({
	resolveApprovedLocalMediaPath: mocks.resolve,
	rememberApprovedLocalReadPath: mocks.remember,
	replaceApprovedSessionLocalReadPaths: mocks.replace,
}));
vi.mock("../project/session", () => ({
	resolveRecordingSession: mocks.resolveSession,
	persistRecordingSessionManifest: mocks.persistSession,
}));

import { registerProjectHandlers } from "./project";

let handlers: Map<string, Parameters<typeof ipcMain.handle>[1]>;
const frame = { url: "http://127.0.0.1:43820/?windowType=editor" };
const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as Electron.IpcMainInvokeEvent;
beforeEach(() => {
	vi.mocked(ipcMain.handle).mockClear();
	mocks.resolve.mockReset().mockResolvedValue("/approved/video.mp4");
	mocks.buildUrl.mockReset().mockReturnValue("http://127.0.0.1:43822/video?token=capability");
	mocks.remember.mockClear();
	mocks.replace.mockClear();
	mocks.resolveSession.mockReset().mockResolvedValue(null);
	mocks.persistSession.mockReset().mockResolvedValue(undefined);
	registerProjectHandlers();
	handlers = new Map(vi.mocked(ipcMain.handle).mock.calls);
});

it.each([
	true,
	false,
])("preserves project audio approvals only when keeping the project (preserve=%s)", async (preserveProjectPath) => {
	const result = await handlers.get("set-current-video-path")!(trusted, "/recording.mp4", {
		preserveProjectPath,
	});
	expect(result).toMatchObject({ success: true });
	if (preserveProjectPath) {
		expect(mocks.replace).not.toHaveBeenCalled();
		expect(mocks.remember).toHaveBeenCalledWith("/recording.mp4");
	} else {
		expect(mocks.replace).toHaveBeenCalledWith(["/recording.mp4", null]);
	}
});

it("rewrites the session manifest on open only when the capture kind changes", async () => {
	mocks.resolveSession.mockResolvedValue({
		videoPath: "/recording.mp4",
		webcamPath: null,
		timeOffsetMs: 0,
		captureSourceKind: "window",
	});
	const open = handlers.get("set-current-video-path")!;

	expect(await open(trusted, "/recording.mp4")).toMatchObject({ success: true });
	expect(await open(trusted, "/recording.mp4", { captureSourceKind: "window" })).toMatchObject({
		success: true,
	});
	expect(mocks.persistSession).not.toHaveBeenCalled();

	await open(trusted, "/recording.mp4", { captureSourceKind: "screen" });
	expect(mocks.persistSession).toHaveBeenCalledWith(
		expect.objectContaining({ captureSourceKind: "screen" }),
	);
});

it("rejects every project channel for foreign and embedded frames before performing work", async () => {
	expect(handlers.size).toBeGreaterThan(20);
	for (const foreign of [false, true]) {
		const senderFrame = { url: foreign ? "https://foreign.test/" : frame.url };
		const event = {
			sender: foreign ? { mainFrame: senderFrame } : trusted.sender,
			senderFrame,
		} as Electron.IpcMainInvokeEvent;
		for (const handler of handlers.values()) {
			expect(await handler(event, "/approved/video.mp4")).toEqual({ success: false });
		}
	}
	expect(mocks.resolve).not.toHaveBeenCalled();
	expect(mocks.buildUrl).not.toHaveBeenCalled();
});

it("mints media capabilities only for a trusted document and approved canonical path", async () => {
	const getUrl = handlers.get("get-local-media-url")!;
	expect(await getUrl(trusted, "/approved/video.mp4")).toMatchObject({ success: true });
	expect(mocks.buildUrl).toHaveBeenCalledWith("http://127.0.0.1:43822", "/approved/video.mp4");
	mocks.buildUrl.mockClear();
	mocks.resolve.mockResolvedValueOnce(null);
	expect(await getUrl(trusted, "/private/file.txt")).toEqual({ success: false });
	expect(await getUrl(trusted, {})).toEqual({ success: false });
	expect(mocks.buildUrl).not.toHaveBeenCalled();
});
