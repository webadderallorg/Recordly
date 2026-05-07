import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { USER_DATA_PATH } from "./appPaths";
import { getPackagedRendererBaseUrl } from "./rendererServer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const WINDOW_ICON_PATH = path.join(
	process.env.VITE_PUBLIC || RENDERER_DIST,
	"app-icons",
	"recordly-512.png",
);

let hudOverlayWindow: BrowserWindow | null = null;
let hudOverlayHiddenFromCapture = true;
let hudOverlayCaptureProtectionLoaded = false;
let countdownWindow: BrowserWindow | null = null;
let updateToastWindow: BrowserWindow | null = null;

const HUD_OVERLAY_SETTINGS_FILE = path.join(USER_DATA_PATH, "hud-overlay-settings.json");
const HUD_EDGE_MARGIN_DIP = 16;
const UPDATE_TOAST_WIDTH = 456;
const UPDATE_TOAST_HEIGHT = 252;
const UPDATE_TOAST_GAP_DIP = 18;

function getEditorWindowQuery(): Record<string, string> {
	const query: Record<string, string> = {
		windowType: "editor",
	};

	if (process.env.RECORDLY_SMOKE_EXPORT === "1") {
		query.smokeExport = "1";
		if (process.env.RECORDLY_SMOKE_EXPORT_INPUT) {
			query.smokeInput = process.env.RECORDLY_SMOKE_EXPORT_INPUT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_OUTPUT) {
			query.smokeOutput = process.env.RECORDLY_SMOKE_EXPORT_OUTPUT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_USE_NATIVE === "1") {
			query.smokeUseNativeExport = "1";
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_ENCODING_MODE) {
			query.smokeEncodingMode = process.env.RECORDLY_SMOKE_EXPORT_ENCODING_MODE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_SHADOW_INTENSITY) {
			query.smokeShadowIntensity = process.env.RECORDLY_SMOKE_EXPORT_SHADOW_INTENSITY;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_INPUT) {
			query.smokeWebcamInput = process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_INPUT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_SHADOW) {
			query.smokeWebcamShadow = process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_SHADOW;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_SIZE) {
			query.smokeWebcamSize = process.env.RECORDLY_SMOKE_EXPORT_WEBCAM_SIZE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_PIPELINE) {
			query.smokePipelineModel = process.env.RECORDLY_SMOKE_EXPORT_PIPELINE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_BACKEND) {
			query.smokeBackendPreference = process.env.RECORDLY_SMOKE_EXPORT_BACKEND;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_MAX_ENCODE_QUEUE) {
			query.smokeMaxEncodeQueue = process.env.RECORDLY_SMOKE_EXPORT_MAX_ENCODE_QUEUE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_MAX_DECODE_QUEUE) {
			query.smokeMaxDecodeQueue = process.env.RECORDLY_SMOKE_EXPORT_MAX_DECODE_QUEUE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_MAX_PENDING_FRAMES) {
			query.smokeMaxPendingFrames = process.env.RECORDLY_SMOKE_EXPORT_MAX_PENDING_FRAMES;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_PROJECT) {
			query.smokeProject = process.env.RECORDLY_SMOKE_EXPORT_PROJECT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_QUALITY) {
			query.smokeQuality = process.env.RECORDLY_SMOKE_EXPORT_QUALITY;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_FPS) {
			query.smokeFps = process.env.RECORDLY_SMOKE_EXPORT_FPS;
		}
	}

	return query;
}

function isHudOverlayCaptureProtectionSupported(): boolean {
	return process.platform !== "linux";
}

function getWindowsBuildNumber(): number | null {
	if (process.platform !== "win32") {
		return null;
	}

	const build = Number.parseInt(os.release().split(".")[2] ?? "", 10);
	return Number.isFinite(build) ? build : null;
}

export function isHudOverlayMousePassthroughSupported(): boolean {
	if (process.platform === "linux") {
		return false;
	}

	const build = getWindowsBuildNumber();
	if (build !== null && build < 22000) {
		return false;
	}

	return true;
}

function loadHudOverlayCaptureProtectionSetting(): boolean {
	if (hudOverlayCaptureProtectionLoaded) {
		return hudOverlayHiddenFromCapture;
	}

	hudOverlayCaptureProtectionLoaded = true;

	try {
		if (!fs.existsSync(HUD_OVERLAY_SETTINGS_FILE)) {
			return hudOverlayHiddenFromCapture;
		}

		const raw = fs.readFileSync(HUD_OVERLAY_SETTINGS_FILE, "utf-8");
		const parsed = JSON.parse(raw) as { hiddenFromCapture?: unknown };
		if (typeof parsed.hiddenFromCapture === "boolean") {
			hudOverlayHiddenFromCapture = parsed.hiddenFromCapture;
		}
	} catch {
		// Ignore settings read failures and fall back to defaults.
	}

	return hudOverlayHiddenFromCapture;
}

function persistHudOverlayCaptureProtectionSetting(enabled: boolean): void {
	try {
		fs.writeFileSync(
			HUD_OVERLAY_SETTINGS_FILE,
			JSON.stringify({ hiddenFromCapture: enabled }, null, 2),
			"utf-8",
		);
	} catch {
		// Ignore settings write failures and keep runtime state working.
	}
}

function getScreen() {
	if (!app.isReady()) {
		throw new Error(
			"getScreen() called before app is ready. Ensure all screen access happens after app.whenReady().",
		);
	}
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

function getHudOverlayDisplay() {
	const hudWindow = getHudOverlayWindow();
	if (hudWindow) {
		return getScreen().getDisplayMatching(hudWindow.getBounds());
	}
	return getScreen().getPrimaryDisplay();
}

function getHudOverlayBounds() {
	const { workArea } = getHudOverlayDisplay();
	return {
		x: workArea.x,
		y: workArea.y,
		width: workArea.width,
		height: workArea.height,
	};
}

function applyHudOverlayBounds() {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}
	hudOverlayWindow.setBounds(getHudOverlayBounds(), false);

	positionUpdateToastWindow();
	if (!hudOverlayWindow.isVisible()) {
		return;
	}
	hudOverlayWindow.moveTop();
}

function getUpdateToastBounds() {
	const hudWindow = getHudOverlayWindow();
	if (hudWindow) {
		const hudBounds = hudWindow.getBounds();
		const display = getScreen().getDisplayMatching(hudBounds);
		const x = Math.round(hudBounds.x + (hudBounds.width - UPDATE_TOAST_WIDTH) / 2);
		const y = Math.max(
			display.workArea.y + HUD_EDGE_MARGIN_DIP,
			hudBounds.y - UPDATE_TOAST_HEIGHT - UPDATE_TOAST_GAP_DIP,
		);

		return {
			x,
			y,
			width: UPDATE_TOAST_WIDTH,
			height: UPDATE_TOAST_HEIGHT,
		};
	}

	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { workArea } = primaryDisplay;
	return {
		x: Math.round(workArea.x + (workArea.width - UPDATE_TOAST_WIDTH) / 2),
		y: workArea.y + HUD_EDGE_MARGIN_DIP,
		width: UPDATE_TOAST_WIDTH,
		height: UPDATE_TOAST_HEIGHT,
	};
}

function positionUpdateToastWindow() {
	if (!updateToastWindow || updateToastWindow.isDestroyed()) {
		return;
	}

	updateToastWindow.setBounds(getUpdateToastBounds(), false);
	updateToastWindow.moveTop();
}

ipcMain.on("hud-overlay-set-ignore-mouse", (_event, ignore: boolean) => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		if (!isHudOverlayMousePassthroughSupported()) {
			hudOverlayWindow.setIgnoreMouseEvents(false);
			return;
		}

		if (ignore) {
			hudOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
			return;
		}

		hudOverlayWindow.setIgnoreMouseEvents(false);
	}
});

// Keep compatibility with existing drag IPC/state.
let hudUserPosition: { x: number; y: number } | null = null;
let hudDragOffset: { x: number; y: number } | null = null;
let hudDragLastCursor: { x: number; y: number } | null = null;
let hudDragFixedSize: { width: number; height: number } | null = null;

ipcMain.on("hud-overlay-drag", (_event, phase: string, screenX: number, screenY: number) => {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) return;

	// On Linux the compositor (especially Wayland) refuses programmatic window
	// placement, so BrowserWindow.setBounds() with x/y is silently ignored and
	// the HUD appears "stuck".  The renderer marks the drag handle as
	// -webkit-app-region: drag on Linux, letting the OS move the window for us.
	// The resulting position is captured by the win.on("moved", ...) listener
	// below so `hudUserPosition` stays in sync.
	if (process.platform === "linux") {
		return;
	}

	if (phase === "start") {
		const bounds = hudOverlayWindow.getBounds();
		hudDragOffset = { x: screenX - bounds.x, y: screenY - bounds.y };
		hudDragLastCursor = { x: screenX, y: screenY };
		hudDragFixedSize = { width: bounds.width, height: bounds.height };
	} else if (phase === "move" && hudDragOffset) {
		if (
			hudDragLastCursor &&
			hudDragLastCursor.x === screenX &&
			hudDragLastCursor.y === screenY
		) {
			return;
		}

		hudDragLastCursor = { x: screenX, y: screenY };
		const targetX = Math.round(screenX - hudDragOffset.x);
		const targetY = Math.round(screenY - hudDragOffset.y);
		const fixedWidth = hudDragFixedSize?.width ?? hudOverlayWindow.getBounds().width;
		const fixedHeight = hudDragFixedSize?.height ?? hudOverlayWindow.getBounds().height;
		hudOverlayWindow.setBounds(
			{
				x: targetX,
				y: targetY,
				width: fixedWidth,
				height: fixedHeight,
			},
			false,
		);
	} else if (phase === "end") {
		const finalBounds = hudOverlayWindow.getBounds();
		hudUserPosition = { x: finalBounds.x, y: finalBounds.y };

		hudDragOffset = null;
		hudDragLastCursor = null;
		hudDragFixedSize = null;
	}
});

ipcMain.on("hud-overlay-hide", () => {
	// Keep the HUD persistent: accidental hide events should not minimize it.
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		if (!hudOverlayWindow.isVisible()) {
			hudOverlayWindow.show();
		}
		hudOverlayWindow.moveTop();
	}
});

ipcMain.handle("get-hud-overlay-capture-protection", () => {
	const enabled = loadHudOverlayCaptureProtectionSetting();

	return {
		success: true,
		enabled,
	};
});

ipcMain.handle("get-hud-overlay-mouse-passthrough-supported", () => {
	return {
		success: true,
		supported: isHudOverlayMousePassthroughSupported(),
	};
});

ipcMain.handle("set-hud-overlay-capture-protection", (_event, enabled: boolean) => {
	loadHudOverlayCaptureProtectionSetting();
	hudOverlayHiddenFromCapture = Boolean(enabled);
	persistHudOverlayCaptureProtectionSetting(hudOverlayHiddenFromCapture);

	if (
		isHudOverlayCaptureProtectionSupported() &&
		hudOverlayWindow &&
		!hudOverlayWindow.isDestroyed()
	) {
		hudOverlayWindow.setContentProtection(hudOverlayHiddenFromCapture);
	}

	return {
		success: true,
		enabled: hudOverlayHiddenFromCapture,
	};
});

export function createHudOverlayWindow(): BrowserWindow {
	loadHudOverlayCaptureProtectionSetting();
	const initialBounds = getHudOverlayBounds();
	let hasShownHudWindow = false;

	const win = new BrowserWindow({
		width: initialBounds.width,
		height: initialBounds.height,
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	const showHudWindow = () => {
		if (hasShownHudWindow || win.isDestroyed()) {
			return;
		}
		hasShownHudWindow = true;
		win.show();
		win.moveTop();
		if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
			win.setIgnoreMouseEvents(false);
			setTimeout(() => {
				if (!win.isDestroyed()) {
					win.setIgnoreMouseEvents(true, { forward: true });
				}
			}, 50);
		}
	};

	if (isHudOverlayCaptureProtectionSupported()) {
		win.setContentProtection(hudOverlayHiddenFromCapture);
	}

	if (isHudOverlayMousePassthroughSupported()) {
		win.setIgnoreMouseEvents(true, { forward: true });
	}

	// On Windows 11+, focus changes (e.g. showing a native notification) can break
	// setIgnoreMouseEvents forwarding on a transparent always-on-top window, making
	// it permanently click-through without hover detection.  Re-initialise the
	// pass-through-with-forwarding state whenever the window gains focus by toggling
	// the flag off then back on so the native WS_EX_TRANSPARENT flag is fully reset.
	// On Windows 10 (build < 22000) passthrough is disabled entirely, so skip this.
	if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
		win.on("focus", () => {
			if (!win.isDestroyed()) {
				win.setIgnoreMouseEvents(false);
				setTimeout(() => {
					if (!win.isDestroyed()) {
						win.setIgnoreMouseEvents(true, { forward: true });
					}
				}, 50);
			}
		});
	}

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		// Safety fallback if renderer-ready signal never arrives.
		setTimeout(() => {
			showHudWindow();
		}, 1800);
	});

	const handleHudRendererReady = () => {
		if (!win.isDestroyed()) {
			showHudWindow();
		}
	};
	ipcMain.on("hud-overlay-renderer-ready", handleHudRendererReady);

	hudOverlayWindow = win;

	// On Linux the HUD is dragged by the OS via -webkit-app-region (Wayland
	// forbids client-side positioning). Mirror moved bounds into drag state.
	if (process.platform === "linux") {
		win.on("moved", () => {
			if (win.isDestroyed()) return;
			const { x, y } = win.getBounds();
			hudUserPosition = { x, y };
		});
	}

	// Reset the user's saved HUD position when displays change so the bar
	// doesn't end up stranded off-screen after a monitor is disconnected.
	const screen = getScreen();
	const handleDisplayRemoved = () => {
		hudUserPosition = null;
	};
	const handleDisplayMetricsChanged = () => {
		if (hudUserPosition) {
			const displays = screen.getAllDisplays();
			const onScreen = displays.some(
				(d) =>
					hudUserPosition!.x >= d.workArea.x &&
					hudUserPosition!.x < d.workArea.x + d.workArea.width &&
					hudUserPosition!.y >= d.workArea.y &&
					hudUserPosition!.y < d.workArea.y + d.workArea.height,
			);
			if (!onScreen) {
				hudUserPosition = null;
			}
		}
		applyHudOverlayBounds();
	};
	screen.on("display-removed", handleDisplayRemoved);
	screen.on("display-metrics-changed", handleDisplayMetricsChanged);

	win.on("closed", () => {
		ipcMain.removeListener("hud-overlay-renderer-ready", handleHudRendererReady);
		screen.removeListener("display-removed", handleDisplayRemoved);
		screen.removeListener("display-metrics-changed", handleDisplayMetricsChanged);
		if (hudOverlayWindow === win) {
			hudOverlayWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=hud-overlay");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "hud-overlay" },
		});
	}

	return win;
}

export function getHudOverlayWindow(): BrowserWindow | null {
	return hudOverlayWindow && !hudOverlayWindow.isDestroyed() ? hudOverlayWindow : null;
}

export function createUpdateToastWindow(): BrowserWindow {
	const initialBounds = getUpdateToastBounds();
	const parentWindow =
		process.platform === "darwin" && hudOverlayWindow && !hudOverlayWindow.isDestroyed()
			? hudOverlayWindow
			: undefined;
	const useTransparentToastWindow = process.platform !== "win32";

	const win = new BrowserWindow({
		width: initialBounds.width,
		height: initialBounds.height,
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		transparent: useTransparentToastWindow,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		focusable: true,
		...(parentWindow ? { parent: parentWindow } : {}),
		backgroundColor: useTransparentToastWindow ? "#00000000" : "#101418",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	if (process.platform === "darwin") {
		win.setAlwaysOnTop(true, "status");
	}

	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	updateToastWindow = win;

	win.on("closed", () => {
		if (updateToastWindow === win) {
			updateToastWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=update-toast");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "update-toast" },
		});
	}

	return win;
}

export function getUpdateToastWindow(): BrowserWindow | null {
	return updateToastWindow && !updateToastWindow.isDestroyed() ? updateToastWindow : null;
}

export function showUpdateToastWindow(): BrowserWindow {
	const win = getUpdateToastWindow() ?? createUpdateToastWindow();
	positionUpdateToastWindow();
	if (!win.isVisible()) {
		if (process.platform === "win32") {
			win.show();
			win.moveTop();
		} else {
			win.showInactive();
		}
	} else {
		win.moveTop();
	}

	return win;
}

export function hideUpdateToastWindow(): void {
	if (!updateToastWindow || updateToastWindow.isDestroyed()) {
		return;
	}

	updateToastWindow.hide();
}

function loadPackagedEditorWindow(win: BrowserWindow) {
	const query = getEditorWindowQuery();
	const queryString = new URLSearchParams(query).toString();
	const indexHtmlPath = path.join(RENDERER_DIST, "index.html");
	const packagedRendererBaseUrl = getPackagedRendererBaseUrl();
	const webContents = win.webContents;

	const loadFromFile = () => {
		if (win.isDestroyed()) {
			return;
		}

		console.log("[editor-window] load-file", indexHtmlPath);
		void win.loadFile(indexHtmlPath, { query });
	};

	if (!packagedRendererBaseUrl) {
		loadFromFile();
		return;
	}

	const targetUrl = `${packagedRendererBaseUrl}/?${queryString}`;
	let settled = false;
	let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
		fallbackToFile("load-timeout");
	}, 5000);

	const clearTimeoutIfNeeded = () => {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	const detachLoadListeners = () => {
		clearTimeoutIfNeeded();
		if (webContents.isDestroyed()) {
			return;
		}

		webContents.removeListener("did-fail-load", handleDidFailLoad);
		webContents.removeListener("did-finish-load", handleDidFinishLoad);
	};

	const fallbackToFile = (reason: string, details?: Record<string, unknown>) => {
		if (settled || win.isDestroyed()) {
			return;
		}

		settled = true;
		detachLoadListeners();
		console.warn("[editor-window] packaged renderer URL failed, falling back to file", {
			reason,
			targetUrl,
			...details,
		});
		loadFromFile();
	};

	const handleDidFailLoad = (
		_event: Electron.Event,
		errorCode: number,
		errorDescription: string,
		validatedURL: string,
		isMainFrame: boolean,
	) => {
		if (!isMainFrame || validatedURL !== targetUrl) {
			return;
		}

		fallbackToFile("did-fail-load", {
			errorCode,
			errorDescription,
			validatedURL,
		});
	};

	const handleDidFinishLoad = () => {
		if (webContents.getURL() !== targetUrl) {
			return;
		}

		settled = true;
		detachLoadListeners();
	};

	webContents.on("did-fail-load", handleDidFailLoad);
	webContents.on("did-finish-load", handleDidFinishLoad);
	win.once("closed", clearTimeoutIfNeeded);

	console.log("[editor-window] load-url", targetUrl);
	void win.loadURL(targetUrl).catch((error) => {
		fallbackToFile("load-url-rejected", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
}

export function createEditorWindow(): BrowserWindow {
	const isMac = process.platform === "darwin";
	const { workArea, workAreaSize } = getScreen().getPrimaryDisplay();
	const initialWidth = isMac ? Math.round(workAreaSize.width * 0.85) : workArea.width;
	const initialHeight = isMac ? Math.round(workAreaSize.height * 0.85) : workArea.height;

	const win = new BrowserWindow({
		width: initialWidth,
		height: initialHeight,
		...(!isMac && {
			x: workArea.x,
			y: workArea.y,
		}),
		minWidth: 800,
		minHeight: 600,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		...(isMac && {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 12, y: 12 },
		}),
		autoHideMenuBar: !isMac,
		transparent: false,
		resizable: true,
		alwaysOnTop: false,
		skipTaskbar: false,
		title: "Recordly",
		show: false,
		backgroundColor: "#000000",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	win.once("ready-to-show", () => {
		console.log("[editor-window] ready-to-show");
		win.show();
	});

	win.webContents.on("did-finish-load", () => {
		console.log("[editor-window] did-finish-load", win.webContents.getURL());
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		// Fallback for Linux/Wayland where `ready-to-show` may not fire reliably.
		if (!win.isDestroyed() && !win.isVisible()) {
			console.log("[editor-window] forcing show after did-finish-load");
			win.show();
		}
	});

	win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
		console.error("[editor-window] did-fail-load", {
			errorCode,
			errorDescription,
			validatedURL,
		});
	});

	win.webContents.on("render-process-gone", (_event, details) => {
		console.error("[editor-window] render-process-gone", details);
	});

	win.on("show", () => {
		console.log("[editor-window] show");
	});

	win.on("focus", () => {
		console.log("[editor-window] focus");
	});

	if (VITE_DEV_SERVER_URL) {
		const query = new URLSearchParams(getEditorWindowQuery());
		win.loadURL(`${VITE_DEV_SERVER_URL}?${query.toString()}`);
	} else {
		loadPackagedEditorWindow(win);
	}

	return win;
}

export function createSourceSelectorWindow(): BrowserWindow {
	const { width, height } = getScreen().getPrimaryDisplay().workAreaSize;

	const win = new BrowserWindow({
		width: 620,
		height: 420,
		minHeight: 350,
		maxHeight: 500,
		x: Math.round((width - 620) / 2),
		y: Math.round((height - 420) / 2),
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		transparent: true,
		show: false,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	win.webContents.on("did-finish-load", () => {
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
			}
		}, 100);
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=source-selector");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "source-selector" },
		});
	}

	return win;
}

export function createCountdownWindow(): BrowserWindow {
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { width, height } = primaryDisplay.workAreaSize;

	const windowSize = 200;
	const x = Math.floor((width - windowSize) / 2);
	const y = Math.floor((height - windowSize) / 2);

	const win = new BrowserWindow({
		width: windowSize,
		height: windowSize,
		x: x,
		y: y,
		frame: false,
		transparent: true,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		focusable: true,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	countdownWindow = win;

	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

	win.webContents.on("did-finish-load", () => {
		if (!win.isDestroyed()) {
			if (process.platform === "win32") {
				win.showInactive();
				win.moveTop();
			} else {
				win.show();
			}
		}
	});

	win.on("closed", () => {
		if (countdownWindow === win) {
			countdownWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=countdown");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "countdown" },
		});
	}

	return win;
}

export function getCountdownWindow(): BrowserWindow | null {
	return countdownWindow;
}

export function closeCountdownWindow(): void {
	if (countdownWindow && !countdownWindow.isDestroyed()) {
		countdownWindow.close();
		countdownWindow = null;
	}
}
