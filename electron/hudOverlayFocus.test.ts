import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };

const show = vi.fn();
const showInactive = vi.fn();
const loadFinishedHandlers: Array<() => void> = [];

const electronScreen = {
	getPrimaryDisplay: () => ({
		workArea: WORK_AREA,
		workAreaSize: { width: WORK_AREA.width, height: WORK_AREA.height },
		size: { width: WORK_AREA.width, height: WORK_AREA.height },
	}),
	getDisplayMatching: () => ({
		workArea: WORK_AREA,
		workAreaSize: { width: WORK_AREA.width, height: WORK_AREA.height },
		size: { width: WORK_AREA.width, height: WORK_AREA.height },
	}),
	getCursorScreenPoint: () => ({ x: 0, y: 0 }),
	on: vi.fn(),
	off: vi.fn(),
	removeListener: vi.fn(),
};

// windows.ts resolves the screen module through createRequire("electron"),
// which bypasses vi.mock("electron"), so the CJS require is mocked too.
vi.mock("node:module", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:module")>();
	return {
		...actual,
		default: actual,
		createRequire: () => (id: string) => {
			if (id === "electron") {
				return { screen: electronScreen };
			}
			return actual.createRequire(import.meta.url)(id);
		},
	};
});

vi.mock("electron", () => {
	class FakeBrowserWindow {
		webContents = {
			send: vi.fn(),
			setWindowOpenHandler: vi.fn(),
			on: (event: string, handler: () => void) => {
				if (event === "did-finish-load") {
					loadFinishedHandlers.push(handler);
				}
			},
		};
		isDestroyed = () => false;
		isVisible = () => true;
		isMinimized = () => false;
		getBounds = () => WORK_AREA;
		setBounds = vi.fn();
		setIgnoreMouseEvents = vi.fn();
		setContentProtection = vi.fn();
		setAlwaysOnTop = vi.fn();
		setVisibleOnAllWorkspaces = vi.fn();
		showInactive = showInactive;
		show = show;
		moveTop = vi.fn();
		once = vi.fn();
		on = vi.fn();
		loadURL = vi.fn();
		loadFile = vi.fn();
	}

	return {
		app: {
			getPath: () => "/tmp/recordly-test",
			isPackaged: false,
			isReady: () => true,
			whenReady: vi.fn(),
			on: vi.fn(),
		},
		BrowserWindow: FakeBrowserWindow,
		ipcMain: { on: vi.fn(), handle: vi.fn() },
		screen: electronScreen,
	};
});

// Regression guard for #846. The HUD and the countdown are always-on-top
// windows that appear as recording starts. show() activates the owning app, so
// on macOS it pulled focus off the window the user picked for window capture,
// leaving the target unclickable. Both must be presented without activating.
describe("recording overlays do not steal focus", () => {
	const realPlatform = process.platform;

	beforeEach(() => {
		vi.resetModules();
		show.mockClear();
		showInactive.mockClear();
		loadFinishedHandlers.length = 0;
		// The regression was macOS-only: Windows already took the showInactive()
		// path, so the platform has to be forced for this to be a real guard.
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", {
			value: realPlatform,
			configurable: true,
		});
	});

	it("shows the HUD overlay without activating it", async () => {
		const windows = await import("./windows");
		windows.createHudOverlayWindow();

		for (const handler of loadFinishedHandlers) {
			handler();
		}
		// The HUD defers its first show until the renderer signals readiness.
		await vi.waitFor(() => expect(showInactive).toHaveBeenCalled(), { timeout: 3000 });

		expect(show).not.toHaveBeenCalled();
	});

	// showInactive() and moveTop() are unsupported on Wayland, so Linux keeps the
	// pre-existing show() behaviour rather than gaining calls that would silently
	// do nothing there. Both windows are covered: a regression in either one
	// alone would otherwise go unnoticed.
	it("leaves the Linux countdown show() path alone", async () => {
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });

		const windows = await import("./windows");
		windows.createCountdownWindow();

		for (const handler of loadFinishedHandlers) {
			handler();
		}

		expect(show).toHaveBeenCalled();
		expect(showInactive).not.toHaveBeenCalled();
	});

	it("leaves the Linux HUD overlay show() path alone", async () => {
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });

		const windows = await import("./windows");
		windows.createHudOverlayWindow();

		for (const handler of loadFinishedHandlers) {
			handler();
		}
		// The HUD defers its first show until the renderer signals readiness.
		await vi.waitFor(() => expect(show).toHaveBeenCalled(), { timeout: 3000 });

		expect(showInactive).not.toHaveBeenCalled();
	});

	it("shows the countdown window without activating it", async () => {
		const windows = await import("./windows");
		windows.createCountdownWindow();

		expect(loadFinishedHandlers.length).toBeGreaterThan(0);
		for (const handler of loadFinishedHandlers) {
			handler();
		}

		expect(showInactive).toHaveBeenCalled();
		expect(show).not.toHaveBeenCalled();
	});
});
