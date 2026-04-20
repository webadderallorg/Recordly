import fs from "node:fs";
import os from "node:os";
import { BrowserWindow, ipcMain } from "electron";
import { USER_DATA_PATH } from "./appPaths";
import { PRELOAD_PATH, getScreen, loadRendererWindow } from "./windowShared";
let hudOverlayWindow: BrowserWindow | null = null;
let hudOverlayHiddenFromCapture = true;
let hudOverlayCaptureProtectionLoaded = false;
let updateToastWindow: BrowserWindow | null = null;
const HUD_OVERLAY_SETTINGS_FILE = `${USER_DATA_PATH}/hud-overlay-settings.json`;
const HUD_BOTTOM_CLEARANCE_CM = 3.5;
const DIP_PER_INCH = 96;
const CM_PER_INCH = 2.54;
const HUD_EDGE_MARGIN_DIP = 16;
const HUD_SHADOW_BLEED_DIP = 36;
const HUD_MIN_WINDOW_WIDTH = 560;
const HUD_COMPACT_HEIGHT = 96;
const HUD_MIN_EXPANDED_HEIGHT = 520 + HUD_SHADOW_BLEED_DIP;
const UPDATE_TOAST_WIDTH = 420;
const UPDATE_TOAST_HEIGHT = 212;
const UPDATE_TOAST_GAP_DIP = 18;

let hudOverlayExpanded = false;
let hudOverlayCompactWidth = HUD_MIN_WINDOW_WIDTH;
let hudOverlayCompactHeight = HUD_COMPACT_HEIGHT;
let hudOverlayExpandedHeight = HUD_MIN_EXPANDED_HEIGHT;
let hudUserPosition: { x: number; y: number } | null = null;
let hudDragOffset: { x: number; y: number } | null = null;
let hudDragLastCursor: { x: number; y: number } | null = null;
let hudDragFixedSize: { width: number; height: number } | null = null;

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
	return build === null || build >= 22000;
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

export function getHudOverlayWindow(): BrowserWindow | null {
	return hudOverlayWindow && !hudOverlayWindow.isDestroyed() ? hudOverlayWindow : null;
}

function getHudOverlayDisplay() {
	const hudWindow = getHudOverlayWindow();
	return hudWindow
		? getScreen().getDisplayMatching(hudWindow.getBounds())
		: getScreen().getPrimaryDisplay();
}

function getHudOverlayBounds(expanded: boolean) {
	const { bounds, workArea } = getHudOverlayDisplay();
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

	return { x, y, width: windowWidth, height: windowHeight };
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

		return { x, y, width: UPDATE_TOAST_WIDTH, height: UPDATE_TOAST_HEIGHT };
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

function reapplyHudOverlayMousePassthrough(window: BrowserWindow) {
	if (process.platform !== "win32" || !isHudOverlayMousePassthroughSupported()) {
		return;
	}

	window.setIgnoreMouseEvents(false);
	setTimeout(() => {
		if (!window.isDestroyed()) {
			window.setIgnoreMouseEvents(true, { forward: true });
		}
	}, 50);
}

function applyHudOverlayBounds(expanded: boolean) {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}

	hudOverlayExpanded = expanded;
	const computed = getHudOverlayBounds(expanded);

	if (hudUserPosition) {
		const { workArea } = getHudOverlayDisplay();
		const x = Math.max(
			workArea.x,
			Math.min(hudUserPosition.x, workArea.x + workArea.width - computed.width),
		);
		const y = Math.max(
			workArea.y,
			Math.min(hudUserPosition.y, workArea.y + workArea.height - computed.height),
		);
		hudOverlayWindow.setBounds({ x, y, width: computed.width, height: computed.height }, false);
	} else {
		hudOverlayWindow.setBounds(computed, false);
	}

	positionUpdateToastWindow();
	if (hudOverlayWindow.isVisible()) {
		hudOverlayWindow.moveTop();
	}
}

ipcMain.on("hud-overlay-set-ignore-mouse", (_event, ignore: boolean) => {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}

	if (!isHudOverlayMousePassthroughSupported()) {
		hudOverlayWindow.setIgnoreMouseEvents(false);
		return;
	}

	if (ignore) {
		hudOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
		return;
	}

	hudOverlayWindow.setIgnoreMouseEvents(false);
});

ipcMain.on("hud-overlay-drag", (_event, phase: string, screenX: number, screenY: number) => {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}

	if (phase === "start") {
		const bounds = hudOverlayWindow.getBounds();
		hudDragOffset = { x: screenX - bounds.x, y: screenY - bounds.y };
		hudDragLastCursor = { x: screenX, y: screenY };
		hudDragFixedSize = { width: bounds.width, height: bounds.height };
		return;
	}

	if (phase === "move" && hudDragOffset) {
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
			{ x: targetX, y: targetY, width: fixedWidth, height: fixedHeight },
			false,
		);
		return;
	}

	if (phase === "end") {
		const finalBounds = hudOverlayWindow.getBounds();
		hudUserPosition = { x: finalBounds.x, y: finalBounds.y };
		hudDragOffset = null;
		hudDragLastCursor = null;
		hudDragFixedSize = null;
	}
});

ipcMain.on("hud-overlay-hide", () => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) hudOverlayWindow.minimize();
});

ipcMain.on("set-hud-overlay-expanded", (_event, expanded: boolean) => applyHudOverlayBounds(Boolean(expanded)));

ipcMain.on("set-hud-overlay-compact-width", (_event, width: number) => {
	if (!Number.isFinite(width)) {
		return;
	}

	const maxWindowWidth = Math.max(
		HUD_MIN_WINDOW_WIDTH,
		getHudOverlayDisplay().workArea.width - HUD_EDGE_MARGIN_DIP * 2,
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

	const maxWindowHeight = Math.max(
		HUD_COMPACT_HEIGHT,
		getHudOverlayDisplay().workArea.height - HUD_EDGE_MARGIN_DIP * 2,
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

ipcMain.handle("get-hud-overlay-capture-protection", () => ({ success: true, enabled: loadHudOverlayCaptureProtectionSetting() }));

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

	return { success: true, enabled: hudOverlayHiddenFromCapture };
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
			getHudOverlayDisplay().workArea.height - HUD_EDGE_MARGIN_DIP * 2,
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
			preload: PRELOAD_PATH,
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	if (isHudOverlayCaptureProtectionSupported()) {
		win.setContentProtection(hudOverlayHiddenFromCapture);
	}

	if (isHudOverlayMousePassthroughSupported()) {
		win.setIgnoreMouseEvents(true, { forward: true });
	}

	if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
		win.on("focus", () => {
			if (!win.isDestroyed()) {
				reapplyHudOverlayMousePassthrough(win);
			}
		});
	}

	win.webContents.on("did-finish-load", () => {
		win.webContents.send("main-process-message", new Date().toLocaleString());
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
				win.moveTop();
				reapplyHudOverlayMousePassthrough(win);
			}
		}, 100);
	});

	win.once("ready-to-show", () => {
		setTimeout(() => {
			if (!win.isDestroyed() && !win.isVisible()) {
				win.show();
				win.moveTop();
			}
		}, 500);
	});

	hudOverlayWindow = win;
	const screen = getScreen();
	const handleDisplayRemoved = () => {
		hudUserPosition = null;
	};
	const handleDisplayMetricsChanged = () => {
		if (hudUserPosition) {
			const displays = screen.getAllDisplays();
			const onScreen = displays.some(
				(display) =>
					hudUserPosition!.x >= display.workArea.x &&
					hudUserPosition!.x < display.workArea.x + display.workArea.width &&
					hudUserPosition!.y >= display.workArea.y &&
					hudUserPosition!.y < display.workArea.y + display.workArea.height,
			);
			if (!onScreen) {
				hudUserPosition = null;
			}
		}

		applyHudOverlayBounds(hudOverlayExpanded);
	};

	screen.on("display-removed", handleDisplayRemoved);
	screen.on("display-metrics-changed", handleDisplayMetricsChanged);

	win.on("closed", () => {
		screen.removeListener("display-removed", handleDisplayRemoved);
		screen.removeListener("display-metrics-changed", handleDisplayMetricsChanged);
		if (hudOverlayWindow === win) {
			hudOverlayWindow = null;
		}
	});

	loadRendererWindow(win, "hud-overlay");
	return win;
}

export function createUpdateToastWindow(): BrowserWindow {
	const initialBounds = getUpdateToastBounds();
	const parentWindow = process.platform === "darwin" && hudOverlayWindow && !hudOverlayWindow.isDestroyed() ? hudOverlayWindow : undefined;
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
			preload: PRELOAD_PATH,
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	if (process.platform === "darwin") win.setAlwaysOnTop(true, "status");

	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	updateToastWindow = win;

	win.on("closed", () => {
		if (updateToastWindow === win) {
			updateToastWindow = null;
		}
	});

	loadRendererWindow(win, "update-toast");
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
		} else win.showInactive();
	} else {
		win.moveTop();
	}

	return win;
}

export function hideUpdateToastWindow(): void {
	if (updateToastWindow && !updateToastWindow.isDestroyed()) updateToastWindow.hide();
}