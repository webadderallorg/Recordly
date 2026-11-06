import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
	app: { isPackaged: false, isReady: () => true, focus: vi.fn() },
	ipcMain: { on: vi.fn(), handle: vi.fn() },
	screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 1000 } }) },
}));
const windows: FakeWindow[] = [];
class FakeWindow extends EventEmitter {
	static getAllWindows() {
		return windows;
	}
	destroyed = false;
	loadURL = vi.fn();
	setBounds = vi.fn();
	show = vi.fn();
	focus = vi.fn();
	moveTop = vi.fn();
	setMenu = vi.fn();
	isMinimized = () => false;
	isDestroyed = () => this.destroyed;
	close = vi.fn(() => {
		this.destroyed = true;
		this.emit("closed");
	});
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
vi.mock("./ipc/recording/nativeCaptureCommand", () => ({ waitForNativeCaptureCommand: vi.fn() }));
vi.mock("./rendererServer", () => ({ getPackagedRendererBaseUrl: () => "http://localhost:9999" }));

beforeEach(() => {
	vi.resetModules();
	windows.length = 0;
	electron.app.isPackaged = false;
	vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5173");
});

it("closes every other app window and loads the dev preview", async () => {
	const { showOnboardingWindow } = await import("./windows");
	const editor = new FakeWindow();
	const hud = new FakeWindow();
	const selector = new FakeWindow();
	const onboarding = showOnboardingWindow({ preview: true }) as unknown as FakeWindow;
	for (const other of [editor, hud, selector]) expect(other.close).toHaveBeenCalledOnce();
	expect(onboarding.isDestroyed()).toBe(false);
	expect(onboarding.loadURL).toHaveBeenCalledWith(
		"http://localhost:5173?windowType=onboarding&onboardingPreview=1",
	);
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
