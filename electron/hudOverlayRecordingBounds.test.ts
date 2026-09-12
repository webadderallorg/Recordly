import { beforeEach, describe, expect, it, vi } from "vitest";

// A recording-sized work area keeps the expected bounds easy to read: the
// compact fallback window is 860x160 anchored to the bottom centre, while the
// passthrough overlay covers the whole work area.
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };

const setBounds = vi.fn();

const electronScreen = {
	getPrimaryDisplay: () => ({ workArea: WORK_AREA }),
	getDisplayMatching: () => ({ workArea: WORK_AREA }),
	getCursorScreenPoint: () => ({ x: 0, y: 0 }),
	on: vi.fn(),
	off: vi.fn(),
	removeListener: vi.fn(),
};

// windows.ts reaches the screen module through createRequire("electron"), which
// bypasses vi.mock("electron"), so the CJS require has to be mocked as well.
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
		webContents = { send: vi.fn(), on: vi.fn(), setWindowOpenHandler: vi.fn() };
		isDestroyed = () => false;
		isVisible = () => true;
		getBounds = () => WORK_AREA;
		setBounds = setBounds;
		setIgnoreMouseEvents = vi.fn();
		setContentProtection = vi.fn();
		setAlwaysOnTop = vi.fn();
		showInactive = vi.fn();
		show = vi.fn();
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

describe("HUD overlay bounds while recording", () => {
	beforeEach(() => {
		vi.resetModules();
		setBounds.mockClear();
	});

	// Regression guard for the overlay swallowing clicks during a recording.
	// getHudOverlayBounds() used to pass
	// `isHudOverlayMousePassthroughSupported() && !hudOverlayRecordingActive`,
	// so starting a recording dropped the HUD to the opaque 860x160 fallback
	// window. Every click inside that region hit the overlay instead of the app
	// being recorded, and the HUD's own Stop button became unreachable once the
	// renderer asked for passthrough.
	// Linux has no mouse passthrough, so the compact fallback window is the
	// expected behaviour there and this guard does not apply.
	it.skipIf(process.platform === "linux")(
		"keeps the full work area on passthrough platforms once recording starts",
		async () => {
			const windows = await import("./windows");

			windows.createHudOverlayWindow();
			setBounds.mockClear();

			windows.setHudOverlayRecordingActive(true);

			expect(setBounds).toHaveBeenCalled();
			const appliedBounds = setBounds.mock.calls.at(-1)?.[0];
			expect(appliedBounds).toEqual(WORK_AREA);
		},
	);
});
