import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
	app: { isPackaged: false, isReady: () => true, focus: vi.fn() },
	ipcMain: { on: vi.fn(), handle: vi.fn() },
	screen: {
		getPrimaryDisplay: () => {
			const bounds = { x: 0, y: 0, width: 1440, height: 1000 };
			return { workArea: bounds, bounds };
		},
		getDisplayMatching: () => ({ bounds: { x: 1440, y: 0, width: 1280, height: 800 } }),
	},
}));
const windows: FakeWindow[] = [];
class FakeWindow extends EventEmitter {
	static getAllWindows() {
		return windows;
	}
	destroyed = false;
	url = "";
	webContents = Object.assign(new EventEmitter(), {
		isDestroyed: () => this.destroyed,
		getURL: () => this.url,
	});
	loadURL = vi.fn(async (url: string) => {
		this.url = url;
	});
	setBounds = vi.fn();
	getBounds = () => ({ x: 1600, y: 10, width: 500, height: 500 });
	show = vi.fn();
	focus = vi.fn();
	moveTop = vi.fn();
	setMenu = vi.fn();
	isMinimized = () => false;
	isVisible = () => this.show.mock.calls.length > 0;
	isDestroyed = () => this.destroyed;
	close = vi.fn(() => {
		this.destroyed = true;
		this.emit("closed");
	});
	destroy = this.close;
	constructor(_options?: unknown) {
		super();
		windows.push(this);
	}
}
vi.mock("electron", () => ({ ...electron, BrowserWindow: FakeWindow }));
vi.mock("node:module", () => ({ createRequire: () => () => electron }));
vi.mock("./appPaths", () => ({ USER_DATA_PATH: "/tmp/recordly-onboarding-test" }));
vi.mock("./desktopPresence", () => ({ registerDesktopPresenceWindow: vi.fn() }));
vi.mock("./ipc/state", () => ({}));
vi.mock("./onboardingIntro", () => ({
	startOnboardingIntro: vi.fn(
		(_bounds: unknown, _preload: unknown, load: (intro: FakeWindow) => void) => {
			const intro = new FakeWindow();
			load(intro);
			return intro;
		},
	),
}));
vi.mock("./ipc/recording/nativeCaptureCommand", () => ({ waitForNativeCaptureCommand: vi.fn() }));
vi.mock("./rendererServer", () => ({ getPackagedRendererBaseUrl: () => "http://localhost:9999" }));

beforeEach(() => {
	vi.resetModules();
	windows.length = 0;
	electron.app.isPackaged = false;
	vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5173");
});

it("replays only the reveal, keeps existing windows open, and lets it play again", async () => {
	const { getOnboardingWindow, replayOnboardingIntro } = await import("./windows");
	const editor = new FakeWindow();
	const hud = new FakeWindow();
	const replay = () =>
		replayOnboardingIntro(editor as unknown as import("electron").BrowserWindow);
	if (process.platform !== "darwin" && process.platform !== "win32") {
		expect(replay()).toBe(false);
		return;
	}
	const { startOnboardingIntro } = await import("./onboardingIntro");
	expect(replay()).toBe(true);
	const intro = windows.at(-1)!;
	expect(intro.loadURL).toHaveBeenCalledWith("http://localhost:5173?windowType=onboarding-intro");
	expect(startOnboardingIntro).toHaveBeenLastCalledWith(
		{ x: 1440, y: 0, width: 1280, height: 800 },
		expect.any(String),
		expect.any(Function),
	);
	expect(replay()).toBe(true);
	expect(windows.at(-1)).toBe(intro);
	expect(getOnboardingWindow()).toBeNull();
	expect(editor.close).not.toHaveBeenCalled();
	expect(hud.close).not.toHaveBeenCalled();
	intro.destroy();
	expect(replay()).toBe(true);
	expect(windows.at(-1)).not.toBe(intro);
	editor.close();
	expect(windows.at(-1)?.isDestroyed()).toBe(true);
});

it("closes every other app window and loads the dev preview", async () => {
	const { focusOnboardingWindow, showOnboardingWindow } = await import("./windows");
	const editor = new FakeWindow();
	const hud = new FakeWindow();
	const selector = new FakeWindow();
	const onboarding = showOnboardingWindow({ preview: true }) as unknown as FakeWindow;
	for (const other of [editor, hud, selector]) expect(other.close).toHaveBeenCalledOnce();
	expect(onboarding.isDestroyed()).toBe(false);
	expect(onboarding.loadURL).toHaveBeenCalledWith(
		"http://localhost:5173?windowType=onboarding&onboardingPreview=1",
	);
	if (process.platform === "darwin" || process.platform === "win32") {
		expect(windows.at(-1)?.loadURL).toHaveBeenCalledWith(
			"http://localhost:5173?windowType=onboarding-intro",
		);
		focusOnboardingWindow();
		expect(onboarding.show).not.toHaveBeenCalled();
	}
});

it("restarts an existing onboarding preview and closes newly opened windows", async () => {
	const { showOnboardingWindow } = await import("./windows");
	const onboarding = showOnboardingWindow() as unknown as FakeWindow;
	const other = new FakeWindow();
	expect(showOnboardingWindow({ preview: true })).toBe(onboarding);
	expect(other.close).toHaveBeenCalledOnce();
	expect(onboarding.loadURL).toHaveBeenLastCalledWith(
		"http://localhost:5173?windowType=onboarding&onboardingPreview=1",
	);
	expect(onboarding.show).toHaveBeenCalled();
});

it("does not enable preview in packaged apps", async () => {
	electron.app.isPackaged = true;
	const { showOnboardingWindow } = await import("./windows");
	const onboarding = showOnboardingWindow({ preview: true }) as unknown as FakeWindow;
	expect(onboarding.loadURL).toHaveBeenCalledWith("http://localhost:5173?windowType=onboarding");
});

it("keeps explicit real authentication distinct from the optional development tour", async () => {
	const { showOnboardingWindow } = await import("./windows");
	const onboarding = showOnboardingWindow({ preview: true }) as unknown as FakeWindow;
	expect(showOnboardingWindow({ preview: false })).toBe(onboarding);
	expect(onboarding.loadURL).toHaveBeenLastCalledWith(
		"http://localhost:5173?windowType=onboarding&onboardingPreview=0",
	);
});

it.each([
	undefined,
	{ preview: false },
	{ preview: true },
])("foregrounds packaged onboarding without reloading existing progress for %j", async (options) => {
	electron.app.isPackaged = true;
	const { showOnboardingWindow } = await import("./windows");
	const onboarding = showOnboardingWindow() as unknown as FakeWindow;
	const other = new FakeWindow();
	expect(showOnboardingWindow(options)).toBe(onboarding);
	expect(onboarding.loadURL).toHaveBeenCalledTimes(1);
	expect(onboarding.show).toHaveBeenCalled();
	expect(onboarding.focus).toHaveBeenCalled();
	expect(other.close).toHaveBeenCalledOnce();
});

it("loads the reveal before showing real packaged first-run onboarding", async () => {
	if (process.platform !== "darwin" && process.platform !== "win32") return;
	electron.app.isPackaged = true;
	vi.stubEnv("VITE_DEV_SERVER_URL", undefined);
	const { focusOnboardingWindow, showOnboardingWindow } = await import("./windows");
	const onboarding = showOnboardingWindow({ intro: true }) as unknown as FakeWindow;
	const intro = windows.at(-1)!;
	expect(intro).not.toBe(onboarding);
	expect(intro.loadURL).toHaveBeenCalledWith(
		"http://localhost:9999/?windowType=onboarding-intro",
	);
	expect(onboarding.loadURL).toHaveBeenCalledWith("http://localhost:9999/?windowType=onboarding");
	focusOnboardingWindow();
	expect(onboarding.show).not.toHaveBeenCalled();
	intro.webContents.emit("did-finish-load");
	onboarding.webContents.emit("did-finish-load");
});
