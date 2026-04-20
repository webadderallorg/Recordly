import path from "node:path";
import { BrowserWindow } from "electron";
import { getPackagedRendererBaseUrl } from "./rendererServer";
import {
	PRELOAD_PATH,
	RENDERER_DIST,
	VITE_DEV_SERVER_URL,
	WINDOW_ICON_PATH,
	getScreen,
	loadRendererWindow,
} from "./windowShared";

let countdownWindow: BrowserWindow | null = null;

function getEditorWindowQuery(): Record<string, string> {
	const query: Record<string, string> = { windowType: "editor" };

	if (process.env.RECORDLY_SMOKE_EXPORT !== "1") {
		return query;
	}

	query.smokeExport = "1";
	const mappings: Array<[string, string]> = [
		["RECORDLY_SMOKE_EXPORT_INPUT", "smokeInput"],
		["RECORDLY_SMOKE_EXPORT_OUTPUT", "smokeOutput"],
		["RECORDLY_SMOKE_EXPORT_ENCODING_MODE", "smokeEncodingMode"],
		["RECORDLY_SMOKE_EXPORT_SHADOW_INTENSITY", "smokeShadowIntensity"],
		["RECORDLY_SMOKE_EXPORT_WEBCAM_INPUT", "smokeWebcamInput"],
		["RECORDLY_SMOKE_EXPORT_WEBCAM_SHADOW", "smokeWebcamShadow"],
		["RECORDLY_SMOKE_EXPORT_WEBCAM_SIZE", "smokeWebcamSize"],
		["RECORDLY_SMOKE_EXPORT_PIPELINE", "smokePipelineModel"],
		["RECORDLY_SMOKE_EXPORT_BACKEND", "smokeBackendPreference"],
		["RECORDLY_SMOKE_EXPORT_MAX_ENCODE_QUEUE", "smokeMaxEncodeQueue"],
		["RECORDLY_SMOKE_EXPORT_MAX_DECODE_QUEUE", "smokeMaxDecodeQueue"],
		["RECORDLY_SMOKE_EXPORT_MAX_PENDING_FRAMES", "smokeMaxPendingFrames"],
	];

	for (const [envKey, queryKey] of mappings) {
		const value = process.env[envKey];
		if (value) {
			query[queryKey] = value;
		}
	}

	if (process.env.RECORDLY_SMOKE_EXPORT_USE_NATIVE === "1") {
		query.smokeUseNativeExport = "1";
	}

	return query;
}

function loadPackagedEditorWindow(window: BrowserWindow) {
	const query = getEditorWindowQuery();
	const queryString = new URLSearchParams(query).toString();
	const indexHtmlPath = path.join(RENDERER_DIST, "index.html");
	const packagedRendererBaseUrl = getPackagedRendererBaseUrl();
	const webContents = window.webContents;

	const loadFromFile = () => {
		if (!window.isDestroyed()) {
			console.log("[editor-window] load-file", indexHtmlPath);
			void window.loadFile(indexHtmlPath, { query });
		}
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
		if (!webContents.isDestroyed()) {
			webContents.removeListener("did-fail-load", handleDidFailLoad);
			webContents.removeListener("did-finish-load", handleDidFinishLoad);
		}
	};

	const fallbackToFile = (reason: string, details?: Record<string, unknown>) => {
		if (settled || window.isDestroyed()) {
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
		if (isMainFrame && validatedURL === targetUrl) {
			fallbackToFile("did-fail-load", { errorCode, errorDescription, validatedURL });
		}
	};

	const handleDidFinishLoad = () => {
		if (webContents.getURL() === targetUrl) {
			settled = true;
			detachLoadListeners();
		}
	};

	webContents.on("did-fail-load", handleDidFailLoad);
	webContents.on("did-finish-load", handleDidFinishLoad);
	window.once("closed", clearTimeoutIfNeeded);

	console.log("[editor-window] load-url", targetUrl);
	void window.loadURL(targetUrl).catch((error) => {
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
	const window = new BrowserWindow({
		width: initialWidth,
		height: initialHeight,
		...(!isMac && { x: workArea.x, y: workArea.y }),
		minWidth: 800,
		minHeight: 600,
		...(process.platform !== "darwin" && { icon: WINDOW_ICON_PATH }),
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
			preload: PRELOAD_PATH,
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	window.once("ready-to-show", () => {
		console.log("[editor-window] ready-to-show");
		window.show();
	});

	window.webContents.on("did-finish-load", () => {
		console.log("[editor-window] did-finish-load", window.webContents.getURL());
		window.webContents.send("main-process-message", new Date().toLocaleString());
	});

	window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
		console.error("[editor-window] did-fail-load", { errorCode, errorDescription, validatedURL });
	});

	window.webContents.on("render-process-gone", (_event, details) => {
		console.error("[editor-window] render-process-gone", details);
	});

	window.on("show", () => {
		console.log("[editor-window] show");
	});

	window.on("focus", () => {
		console.log("[editor-window] focus");
	});

	if (VITE_DEV_SERVER_URL) {
		const query = new URLSearchParams(getEditorWindowQuery());
		void window.loadURL(`${VITE_DEV_SERVER_URL}?${query.toString()}`);
	} else {
		loadPackagedEditorWindow(window);
	}

	return window;
}

export function createSourceSelectorWindow(): BrowserWindow {
	const { width, height } = getScreen().getPrimaryDisplay().workAreaSize;
	const window = new BrowserWindow({
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
		...(process.platform !== "darwin" && { icon: WINDOW_ICON_PATH }),
		backgroundColor: "#00000000",
		webPreferences: {
			preload: PRELOAD_PATH,
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	window.webContents.on("did-finish-load", () => {
		setTimeout(() => {
			if (!window.isDestroyed()) {
				window.show();
			}
		}, 100);
	});

	loadRendererWindow(window, "source-selector");
	return window;
}

export function createCountdownWindow(): BrowserWindow {
	const { width, height } = getScreen().getPrimaryDisplay().workAreaSize;
	const windowSize = 200;
	const window = new BrowserWindow({
		width: windowSize,
		height: windowSize,
		x: Math.floor((width - windowSize) / 2),
		y: Math.floor((height - windowSize) / 2),
		frame: false,
		transparent: true,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		focusable: true,
		show: false,
		webPreferences: {
			preload: PRELOAD_PATH,
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	countdownWindow = window;
	window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

	window.webContents.on("did-finish-load", () => {
		if (!window.isDestroyed()) {
			window.show();
		}
	});

	window.on("closed", () => {
		if (countdownWindow === window) {
			countdownWindow = null;
		}
	});

	loadRendererWindow(window, "countdown");
	return window;
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