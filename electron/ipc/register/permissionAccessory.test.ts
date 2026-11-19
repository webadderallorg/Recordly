import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = await vi.hoisted(async () => {
	const { EventEmitter } = await import("node:events");
	return {
		spawn: vi.fn(),
		binary: vi.fn(),
		screen: vi.fn(),
		accessibility: vi.fn(),
		app: Object.assign(new EventEmitter(), { isPackaged: true, getPath: vi.fn() }),
		window: Object.assign(new EventEmitter(), {
			isDestroyed: vi.fn(() => false),
			hide: vi.fn(),
			destroy: vi.fn(),
			showInactive: vi.fn(),
			setBounds: vi.fn(),
			setVisibleOnAllWorkspaces: vi.fn(),
			loadURL: vi.fn(async () => undefined),
			webContents: Object.assign(new EventEmitter(), {
				setWindowOpenHandler: vi.fn(),
				startDrag: vi.fn(),
			}),
		}),
		icon: { isEmpty: () => false, resize: vi.fn(() => "recordly-drag-icon") },
		owner: Object.assign(new EventEmitter(), {
			isDestroyed: vi.fn(),
			show: vi.fn(),
			focus: vi.fn(),
		}),
	};
});
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../paths/binaries", () => ({ ensurePermissionDragHelperBinary: mocks.binary }));
vi.mock("../../rendererServer", () => ({
	getPackagedRendererBaseUrl: () => "http://127.0.0.1:5173/",
}));
vi.mock("electron", () => ({
	app: Object.assign(mocks.app, { getAppPath: () => "/workspace/recordly" }),
	BrowserWindow: Object.assign(
		vi.fn(function () {
			return mocks.window;
		}),
		{ fromWebContents: () => mocks.owner },
	),
	nativeImage: { createFromPath: () => mocks.icon },
	systemPreferences: {
		getMediaAccessStatus: mocks.screen,
		isTrustedAccessibilityClient: mocks.accessibility,
	},
}));

import { BrowserWindow, type WebContents } from "electron";
import {
	closePermissionAccessory,
	dismissPermissionAccessory,
	runningApplicationBundle,
	showPermissionAccessory,
	startPermissionAccessoryDrag,
} from "./permissionAccessory";

const platform = process.platform;
let child: EventEmitter & {
	stdin: PassThrough;
	stdout: PassThrough;
	stderr: PassThrough;
	kill: ReturnType<typeof vi.fn>;
};
let sender: WebContents;
beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	Object.defineProperty(process, "platform", { value: "darwin" });
	mocks.app.isPackaged = true;
	mocks.app.getPath.mockReturnValue("/Applications/Recordly.app/Contents/MacOS/Recordly");
	mocks.owner.isDestroyed.mockReturnValue(false);
	mocks.screen.mockReturnValue("denied");
	mocks.accessibility.mockReturnValue(false);
	mocks.binary.mockResolvedValue("/bundled/recordly-permission-drag-helper");
	child = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn(),
	});
	mocks.spawn.mockReturnValue(child);
	sender = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
	}) as unknown as WebContents;
});
afterEach(() => {
	closePermissionAccessory();
	child.emit("exit", 0);
	vi.useRealTimers();
	Object.defineProperty(process, "platform", { value: platform });
});

async function launch() {
	const pending = showPermissionAccessory("accessibility", sender);
	await vi.advanceTimersByTimeAsync(0);
	child.stdout.write("rea");
	child.stdout.write("dy\n");
	await pending;
}

it("only derives a top-level app from its Contents/MacOS executable", () => {
	expect(runningApplicationBundle("/Applications/My Recorder.app/Contents/MacOS/Recordly")).toBe(
		"/Applications/My Recorder.app",
	);
	expect(runningApplicationBundle("/tmp/Recordly")).toBeUndefined();
	expect(
		runningApplicationBundle("/Applications/Recordly.app/elsewhere/Recordly"),
	).toBeUndefined();
});

it("does not show a helper for other platforms or already granted access", async () => {
	Object.defineProperty(process, "platform", { value: "win32" });
	await showPermissionAccessory("screen", sender);
	Object.defineProperty(process, "platform", { value: "darwin" });
	mocks.screen.mockReturnValue("granted");
	await showPermissionAccessory("screen", sender);
	expect(mocks.spawn).not.toHaveBeenCalled();
	expect(mocks.binary).not.toHaveBeenCalled();
});

it("drags the running Electron app when permissions are requested in development", async () => {
	mocks.app.isPackaged = false;
	mocks.app.getPath.mockReturnValue(
		"/workspace/recordly/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
	);
	await launch();
	expect(mocks.spawn).toHaveBeenCalledWith(
		"/bundled/recordly-permission-drag-helper",
		[
			"--app-bundle",
			"/workspace/recordly/node_modules/electron/dist/Electron.app",
			"--permission",
			"accessibility",
			"--parent-pid",
			String(process.pid),
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
});

it("drags the main-process bundle, and a successful drop alone never completes permission setup", async () => {
	await launch();
	expect(mocks.spawn).toHaveBeenCalledWith(
		"/bundled/recordly-permission-drag-helper",
		[
			"--app-bundle",
			"/Applications/Recordly.app",
			"--permission",
			"accessibility",
			"--parent-pid",
			String(process.pid),
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	child.stdout.write("dropped\n");
	await vi.advanceTimersByTimeAsync(1000);
	expect(child.stdin.writableEnded).toBe(false);
	expect(mocks.owner.focus).not.toHaveBeenCalled();
	mocks.accessibility.mockReturnValue(true);
	await vi.advanceTimersByTimeAsync(500);
	expect(child.stdin.read()?.toString()).toBe("close\n");
	expect(mocks.owner.focus).toHaveBeenCalledOnce();
	// A stalled helper is killed once; polling stops after the verified grant.
	await vi.advanceTimersByTimeAsync(2000);
	expect(child.kill).toHaveBeenCalledOnce();
	expect(mocks.owner.focus).toHaveBeenCalledOnce();
});

it("Back restores the originating window, and exit removes all lifecycle listeners", async () => {
	await launch();
	child.stdout.write("back\n");
	expect(mocks.owner.focus).toHaveBeenCalledOnce();
	child.emit("exit", 0);
	expect(mocks.owner.listenerCount("closed")).toBe(0);
	expect(sender.listenerCount("destroyed")).toBe(0);
	expect(mocks.app.listenerCount("before-quit")).toBe(0);
	await vi.advanceTimersByTimeAsync(10_000);
	expect(child.kill).not.toHaveBeenCalled();
});

it("closes when its originating window closes without reopening it", async () => {
	await launch();
	mocks.owner.isDestroyed.mockReturnValue(true);
	mocks.owner.emit("closed");
	expect(child.stdin.writableEnded).toBe(true);
	expect(mocks.owner.show).not.toHaveBeenCalled();
});

it("a cancelled pending helper build cannot open a stale accessory", async () => {
	let compiled!: (value: string) => void;
	mocks.binary.mockReturnValue(
		new Promise<string>((resolve) => {
			compiled = resolve;
		}),
	);
	const pending = showPermissionAccessory("screen", sender);
	closePermissionAccessory();
	compiled("/bundled/helper");
	await pending;
	expect(mocks.spawn).not.toHaveBeenCalled();
});

it("reports startup failure and removes polling and listeners", async () => {
	const pending = showPermissionAccessory("screen", sender);
	const result = expect(pending).rejects.toThrow("native helper failed");
	await vi.advanceTimersByTimeAsync(0);
	child.stderr.write("native helper failed");
	child.emit("exit", 2);
	await result;
	expect(mocks.owner.listenerCount("closed")).toBe(0);
	await vi.advanceTimersByTimeAsync(10_000);
	expect(child.kill).not.toHaveBeenCalled();
});

it("keeps the real native accessory open for a dev preview of previously granted permissions", async () => {
	mocks.app.isPackaged = false;
	mocks.screen.mockReturnValue("granted");
	const pending = showPermissionAccessory("screen", sender, true);
	await vi.advanceTimersByTimeAsync(0);
	child.stdout.write("ready\n");
	await pending;
	await vi.advanceTimersByTimeAsync(2000);
	expect(mocks.spawn).toHaveBeenCalledOnce();
	expect(child.stdin.writableEnded).toBe(false);
	expect(mocks.owner.focus).not.toHaveBeenCalled();
	child.stdout.write("back\n");
	expect(mocks.owner.focus).toHaveBeenCalledOnce();
});

it("ignores the preview override for a packaged app with granted permissions", async () => {
	mocks.screen.mockReturnValue("granted");
	await showPermissionAccessory("screen", sender, true);
	expect(mocks.spawn).not.toHaveBeenCalled();
});

it("shows the HeroUI window only after it paints and follows validated Settings frames", async () => {
	await launch();
	expect(mocks.window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
		visibleOnFullScreen: true,
		skipTransformProcessType: true,
	});
	expect(BrowserWindow).toHaveBeenCalledWith(
		expect.objectContaining({
			focusable: false,
			webPreferences: {
				preload: "/workspace/recordly/dist-electron/preload.js",
				contextIsolation: true,
				nodeIntegration: false,
			},
		}),
	);
	expect(mocks.window.loadURL).toHaveBeenCalledWith(
		"http://127.0.0.1:5173/?windowType=permission-accessory&permission=accessibility",
	);
	child.stdout.write('{"visible":true,"x":120,"y":400,"width":368,"height":264}\n');
	expect(mocks.window.showInactive).not.toHaveBeenCalled();
	mocks.window.emit("ready-to-show");
	expect(mocks.window.showInactive).toHaveBeenCalledOnce();
	expect(mocks.window.setBounds).toHaveBeenCalledWith({
		x: 120,
		y: 400,
		width: 368,
		height: 264,
	});
	child.stdout.write('{"visible":false}\n');
	expect(mocks.window.hide).toHaveBeenCalledOnce();
});

it("only drags the running app from the accessory, using Recordly artwork", async () => {
	await launch();
	expect(startPermissionAccessoryDrag(sender)).toEqual({ success: false });
	expect(
		startPermissionAccessoryDrag(mocks.window.webContents as unknown as WebContents),
	).toEqual({ success: true });
	expect(mocks.window.webContents.startDrag).toHaveBeenCalledWith({
		file: "/Applications/Recordly.app",
		icon: "recordly-drag-icon",
	});
	expect(dismissPermissionAccessory(sender)).toEqual({ success: false });
	expect(dismissPermissionAccessory(mocks.window.webContents as unknown as WebContents)).toEqual({
		success: true,
	});
	expect(mocks.owner.focus).toHaveBeenCalledOnce();
});
