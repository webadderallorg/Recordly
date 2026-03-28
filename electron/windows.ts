import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";

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

const HUD_OVERLAY_SETTINGS_FILE = path.join(app.getPath("userData"), "hud-overlay-settings.json");
const HUD_BOTTOM_CLEARANCE_CM = 3.5;
const DIP_PER_INCH = 96;
const CM_PER_INCH = 2.54;
const HUD_EDGE_MARGIN_DIP = 16;
const HUD_SHADOW_BLEED_DIP = 36;
const HUD_MIN_WINDOW_WIDTH = 560;
const HUD_COMPACT_HEIGHT = 96;
const HUD_MIN_EXPANDED_HEIGHT = 520 + HUD_SHADOW_BLEED_DIP;
const UPDATE_TOAST_WINDOW_WIDTH = 420;
const UPDATE_TOAST_WINDOW_HEIGHT = 196;
const UPDATE_TOAST_GAP_DIP = 16;

let hudOverlayExpanded = false;
let hudOverlayCompactWidth = HUD_MIN_WINDOW_WIDTH;
let hudOverlayCompactHeight = HUD_COMPACT_HEIGHT;
let hudOverlayExpandedHeight = HUD_MIN_EXPANDED_HEIGHT;

function isHudOverlayCaptureProtectionSupported(): boolean {
	return process.platform !== "linux";
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
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

function getHudOverlayBounds(expanded: boolean) {
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { bounds, workArea } = primaryDisplay;
	const maxWindowWidth = Math.max(HUD_MIN_WINDOW_WIDTH, workArea.width - HUD_EDGE_MARGIN_DIP * 2);
	const windowWidth = Math.min(
		maxWindowWidth,
		Math.max(HUD_MIN_WINDOW_WIDTH, Math.round(hudOverlayCompactWidth)),
	);
	const maxWindowHeight = Math.max(HUD_COMPACT_HEIGHT, workArea.height - HUD_EDGE_MARGIN_DIP * 2);
	const desiredHeight = expanded
		? Math.max(HUD_MIN_EXPANDED_HEIGHT, Math.round(hudOverlayExpandedHeight))
		: Math.max(HUD_COMPACT_HEIGHT, Math.round(hudOverlayCompactHeight));
	const windowHeight = Math.min(maxWindowHeight, desiredHeight);
	const bottomClearanceDip = Math.round((HUD_BOTTOM_CLEARANCE_CM / CM_PER_INCH) * DIP_PER_INCH);
	const screenBottom = bounds.y + bounds.height;
	const workAreaBottom = workArea.y + workArea.height;
	const preferredBottom = screenBottom - bottomClearanceDip;
	const maximumSafeBottom = workAreaBottom - HUD_EDGE_MARGIN_DIP;
	const windowBottom = Math.min(preferredBottom, maximumSafeBottom);

	const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
	const y = Math.max(workArea.y + HUD_EDGE_MARGIN_DIP, Math.floor(windowBottom - windowHeight));

	return {
		x,
		y,
		width: windowWidth,
		height: windowHeight,
	};
}

function applyHudOverlayBounds(expanded: boolean) {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}

	hudOverlayExpanded = expanded;

	hudOverlayWindow.setBounds(getHudOverlayBounds(expanded), false);
	positionUpdateToastWindow();
	if (!hudOverlayWindow.isVisible()) {
		return;
	}
	hudOverlayWindow.moveTop();
}

ipcMain.on("hud-overlay-hide", () => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.minimize();
	}
});

ipcMain.on("set-hud-overlay-expanded", (_event, expanded: boolean) => {
	applyHudOverlayBounds(Boolean(expanded));
});

ipcMain.on("set-hud-overlay-compact-width", (_event, width: number) => {
	if (!Number.isFinite(width)) {
		return;
	}

	const primaryDisplay = getScreen().getPrimaryDisplay();
	const maxWindowWidth = Math.max(
		HUD_MIN_WINDOW_WIDTH,
		primaryDisplay.workArea.width - HUD_EDGE_MARGIN_DIP * 2,
	);
	const nextWidth = Math.min(maxWindowWidth, Math.max(HUD_MIN_WINDOW_WIDTH, Math.round(width)));

	if (nextWidth === hudOverlayCompactWidth) {
		return;
	}

	hudOverlayCompactWidth = nextWidth;
	applyHudOverlayBounds(hudOverlayExpanded);
});

ipcMain.on("set-hud-overlay-measured-height", (_event, height: number, expanded: boolean) => {
	if (!Number.isFinite(height)) {
		return;
	}

	const primaryDisplay = getScreen().getPrimaryDisplay();
	const maxWindowHeight = Math.max(
		HUD_COMPACT_HEIGHT,
		primaryDisplay.workArea.height - HUD_EDGE_MARGIN_DIP * 2,
	);
	const nextHeight = Math.min(maxWindowHeight, Math.max(HUD_COMPACT_HEIGHT, Math.round(height)));

	if (expanded) {
		if (nextHeight === hudOverlayExpandedHeight) {
			return;
		}
		hudOverlayExpandedHeight = Math.max(HUD_MIN_EXPANDED_HEIGHT, nextHeight);
	} else {
		if (nextHeight === hudOverlayCompactHeight) {
			return;
		}
		hudOverlayCompactHeight = nextHeight;
	}

	applyHudOverlayBounds(hudOverlayExpanded);
});

ipcMain.handle("get-hud-overlay-capture-protection", () => {
	const enabled = loadHudOverlayCaptureProtectionSetting();

	return {
		success: true,
		enabled,
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
	const initialBounds = getHudOverlayBounds(false);

	const win = new BrowserWindow({
		width: initialBounds.width,
		height: initialBounds.height,
		minWidth: HUD_MIN_WINDOW_WIDTH,
		minHeight: HUD_COMPACT_HEIGHT,
		maxHeight: Math.max(
			HUD_COMPACT_HEIGHT,
			getScreen().getPrimaryDisplay().workArea.height - HUD_EDGE_MARGIN_DIP * 2,
		),
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		transparent: true,
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

	if (isHudOverlayCaptureProtectionSupported()) {
		win.setContentProtection(hudOverlayHiddenFromCapture);
	}

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
				positionUpdateToastWindow();
			}
		}, 100);
	});

	hudOverlayWindow = win;

	win.on("move", () => {
		positionUpdateToastWindow();
	});

	win.on("show", () => {
		positionUpdateToastWindow();
	});

	win.on("closed", () => {
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

function getUpdateToastBounds() {
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { workArea } = primaryDisplay;
	const anchorWindow = getHudOverlayWindow();

	if (anchorWindow) {
		const anchorBounds = anchorWindow.getBounds();
		return {
			x: Math.round(anchorBounds.x + (anchorBounds.width - UPDATE_TOAST_WINDOW_WIDTH) / 2),
			y: Math.max(
				workArea.y + HUD_EDGE_MARGIN_DIP,
				anchorBounds.y - UPDATE_TOAST_WINDOW_HEIGHT - UPDATE_TOAST_GAP_DIP,
			),
			width: UPDATE_TOAST_WINDOW_WIDTH,
			height: UPDATE_TOAST_WINDOW_HEIGHT,
		};
	}

	return {
		x: Math.round(workArea.x + (workArea.width - UPDATE_TOAST_WINDOW_WIDTH) / 2),
		y: Math.round(workArea.y + (workArea.height - UPDATE_TOAST_WINDOW_HEIGHT) / 2),
		width: UPDATE_TOAST_WINDOW_WIDTH,
		height: UPDATE_TOAST_WINDOW_HEIGHT,
	};
}

export function positionUpdateToastWindow(): void {
	if (!updateToastWindow || updateToastWindow.isDestroyed()) {
		return;
	}

	updateToastWindow.setBounds(getUpdateToastBounds(), false);
	if (updateToastWindow.isVisible()) {
		updateToastWindow.moveTop();
	}
}

export function createUpdateToastWindow(): BrowserWindow {
	const bounds = getUpdateToastBounds();
	const win = new BrowserWindow({
		width: bounds.width,
		height: bounds.height,
		x: bounds.x,
		y: bounds.y,
		frame: false,
		transparent: true,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		focusable: true,
		show: false,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	win.setBackgroundColor("#00000000");

	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

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

	updateToastWindow = win;
	return win;
}

export function getUpdateToastWindow(): BrowserWindow | null {
	return updateToastWindow && !updateToastWindow.isDestroyed() ? updateToastWindow : null;
}

export function closeUpdateToastWindow(): void {
	if (updateToastWindow && !updateToastWindow.isDestroyed()) {
		updateToastWindow.close();
	}
}

export function createEditorWindow(): BrowserWindow {
	const isMac = process.platform === "darwin";
	const { width, height } = getScreen().getPrimaryDisplay().workAreaSize;

	const win = new BrowserWindow({
		width: Math.round(width * 0.85),
		height: Math.round(height * 0.85),
		minWidth: 800,
		minHeight: 600,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		...(isMac && {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 12, y: 12 },
		}),
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
		win.show();
	});

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=editor");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "editor" },
		});
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
			win.show();
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
