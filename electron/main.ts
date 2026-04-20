import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, desktopCapturer, ipcMain, session, systemPreferences } from "electron";
import { showCursor } from "./cursorHider";
import { registerExtensionIpcHandlers } from "./extensions/extensionIpc";
import {
	cleanupNativeVideoExportSessions,
	getSelectedSourceId,
	killWindowsCaptureProcess,
	registerIpcHandlers,
} from "./ipc/handlers";
import {
	configureGpuAccelerationSwitches,
	ensureRecordingsDir,
	logSmokeExportGpuDiagnostics,
} from "./mainBootstrapHelpers";
import { mainRuntimeState } from "./mainRuntimeState";
import {
	initializeMainUpdateIntegration,
	registerUpdateIpcHandlers,
	runManualUpdateCheck,
	setupMainAutoUpdates,
} from "./mainUpdateIntegration";
import {
	createEditorWindowWrapper,
	createSourceSelectorWindowWrapper,
	createTray,
	createWindow,
	focusOrCreateMainWindow,
	initializeMainWindowControls,
	reassertHudOverlayMouseState,
	restoreWindowSafely,
	setupApplicationMenu,
	syncDockIcon,
	updateTrayMenu,
} from "./mainWindowControls";
import { ensureMediaServer } from "./mediaServer";
import { ensurePackagedRendererServer } from "./rendererServer";
import {
	createEditorWindow,
	createHudOverlayWindow,
	createSourceSelectorWindow,
	getHudOverlayWindow,
	isHudOverlayMousePassthroughSupported,
} from "./windows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_SMOKE_EXPORT = process.env.RECORDLY_SMOKE_EXPORT === "1";

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-gpu-rasterization");

configureGpuAccelerationSwitches();

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
	app.quit();
}

initializeMainWindowControls({
	rendererDist: RENDERER_DIST,
	createHudOverlayWindow,
	createEditorWindow,
	createSourceSelectorWindow,
	getHudOverlayWindow,
	isHudOverlayMousePassthroughSupported,
	onCheckForUpdates: runManualUpdateCheck,
});

initializeMainUpdateIntegration({
	rendererDist: RENDERER_DIST,
	focusOrCreateMainWindow,
	reassertHudOverlayMouseState,
});

app.on("before-quit", () => {
	killWindowsCaptureProcess();
	showCursor();
	cleanupNativeVideoExportSessions();
});

app.on("window-all-closed", () => {
	if (IS_SMOKE_EXPORT || process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	focusOrCreateMainWindow();
});

app.on("second-instance", () => {
	focusOrCreateMainWindow();
});

app.whenReady().then(async () => {
	if (process.platform === "win32") {
		app.setAppUserModelId("dev.recordly.app");
	}

	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = ["media", "audioCapture", "microphone", "camera", "videoCapture"];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = ["media", "audioCapture", "microphone", "camera", "videoCapture"];
		callback(allowed.includes(permission));
	});

	session.defaultSession.setDevicePermissionHandler(() => true);

	if (process.platform === "darwin") {
		const cameraStatus = systemPreferences.getMediaAccessStatus("camera");
		if (cameraStatus !== "granted") {
			await systemPreferences.askForMediaAccess("camera");
		}

		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
		}
	} else if (process.platform === "win32") {
		const cameraStatus = systemPreferences.getMediaAccessStatus("camera");
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (cameraStatus !== "granted") {
			console.warn(
				`[permissions] Camera access is "${cameraStatus}" — webcam may not work. Check Windows Settings > Privacy > Camera.`,
			);
		}
		if (micStatus !== "granted") {
			console.warn(
				`[permissions] Microphone access is "${micStatus}" — mic recording may not work. Check Windows Settings > Privacy > Microphone.`,
			);
		}
	}

	ipcMain.on("hud-overlay-close", () => {
		app.quit();
	});

	registerUpdateIpcHandlers();
	syncDockIcon();
	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	await ensureRecordingsDir();

	if (!VITE_DEV_SERVER_URL) {
		try {
			await ensurePackagedRendererServer(RENDERER_DIST);
		} catch (error) {
			console.warn("[renderer-server] Failed to start packaged renderer server:", error);
		}
	}

	try {
		await ensureMediaServer();
	} catch (error) {
		console.warn("[media-server] Failed to start media server:", error);
	}

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		() => mainRuntimeState.mainWindow,
		() => mainRuntimeState.sourceSelectorWindow,
		(recording: boolean, sourceName: string) => {
			mainRuntimeState.selectedSourceName = sourceName;
			if (!mainRuntimeState.tray) {
				createTray();
			}
			updateTrayMenu(recording);
			if (recording) {
				reassertHudOverlayMouseState();
			}
			if (!recording) {
				restoreWindowSafely(mainRuntimeState.mainWindow);
			}
		},
	);

	registerExtensionIpcHandlers();

	if (IS_SMOKE_EXPORT) {
		await logSmokeExportGpuDiagnostics(IS_SMOKE_EXPORT);
		console.log(
			`[smoke-export] Starting editor smoke export for ${process.env.RECORDLY_SMOKE_EXPORT_INPUT ?? "<missing input>"}`,
		);
		createEditorWindowWrapper();
		return;
	}

	createWindow();
	setupMainAutoUpdates();

	session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
		try {
			const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
			const sourceId = getSelectedSourceId();
			const source = sourceId
				? (sources.find((candidate) => candidate.id === sourceId) ?? sources[0])
				: sources[0];
			if (source) {
				callback({ video: { id: source.id, name: source.name } });
			} else {
				callback({});
			}
		} catch (error) {
			console.error("setDisplayMediaRequestHandler error:", error);
			callback({});
		}
	});
});
