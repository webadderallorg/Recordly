import fs from "node:fs/promises";
import { app, ipcMain, screen } from "electron";
import { hasAppSetting, readAppSettingsStore, writeAppSettingsStore } from "../../appSettingsStore";
import { hideCursor } from "../../cursorHider";
import { closeCountdownWindow, createCountdownWindow, getCountdownWindow } from "../../windows";
import { COUNTDOWN_SETTINGS_FILE, RECORDINGS_SETTINGS_FILE, SHORTCUTS_FILE } from "../constants";
import {
	createRecordingPreferencesStore,
	type RecordingPreferencesPatch,
} from "../settings/recordingPreferencesStore";
import {
	countdownCancelled,
	countdownInProgress,
	countdownRemaining,
	countdownTimer,
	setCountdownCancelled,
	setCountdownInProgress,
	setCountdownRemaining,
	setCountdownTimer,
} from "../state";
import { parseJsonWithByteOrderMark } from "../utils";
import { createScreenPermissionWaitController } from "../screenPermissionWait";

const BROWSER_MICROPHONE_PROFILE_ENV = "RECORDLY_BROWSER_MIC_PROFILE";
const DEFAULT_BROWSER_MICROPHONE_PROFILE = "processed";
const recordingPreferencesStore = createRecordingPreferencesStore(RECORDINGS_SETTINGS_FILE);
const BROWSER_MICROPHONE_PROFILES = new Set([
	"processed",
	"no-agc",
	"no-echo",
	"no-noise-suppression",
	"raw",
]);

function getBrowserMicrophoneProfileFromEnv() {
	const requested = process.env[BROWSER_MICROPHONE_PROFILE_ENV]?.trim() || null;
	const normalized = requested?.toLowerCase() ?? DEFAULT_BROWSER_MICROPHONE_PROFILE;
	return {
		browserMicrophoneProfile: BROWSER_MICROPHONE_PROFILES.has(normalized)
			? normalized
			: DEFAULT_BROWSER_MICROPHONE_PROFILE,
		requestedBrowserMicrophoneProfile: requested,
	};
}

function sendAwaitingScreenPermission(win: Electron.BrowserWindow, awaiting: boolean) {
	if (!win.isDestroyed()) {
		win.webContents.send("awaiting-screen-permission-changed", awaiting);
	}
}

// The awaiting layout (glass panel with spinner + labels) is taller than the
// 200×200 countdown circle; the window is resized per state and recentered on
// the primary display's work area.
const COUNTDOWN_WINDOW_SIZE = { width: 200, height: 200 } as const;
const AWAITING_WINDOW_SIZE = { width: 320, height: 320 } as const;

function setCountdownWindowGeometry(awaiting: boolean) {
	const win = getCountdownWindow();
	if (!win || win.isDestroyed()) {
		return;
	}
	const size = awaiting ? AWAITING_WINDOW_SIZE : COUNTDOWN_WINDOW_SIZE;
	const { workArea } = screen.getPrimaryDisplay();
	win.setBounds({
		x: Math.floor(workArea.x + (workArea.width - size.width) / 2),
		y: Math.floor(workArea.y + (workArea.height - size.height) / 2),
		width: size.width,
		height: size.height,
	});
}

// Linux portal permission wait: drives the countdown overlay window between
// "waiting for the user to accept the portal dialog" and the countdown that
// follows once capture frames actually flow.
const screenPermissionWait = createScreenPermissionWaitController({
	onWaitStarted: () => {
		const win = getCountdownWindow() ?? createCountdownWindow();
		setCountdownWindowGeometry(true);
		if (win.webContents.isLoadingMainFrame()) {
			win.webContents.once("did-finish-load", () => {
				if (screenPermissionWait.isPending()) {
					sendAwaitingScreenPermission(win, true);
				}
			});
		} else {
			sendAwaitingScreenPermission(win, true);
		}
	},
	onWaitEnded: (granted) => {
		if (granted) {
			// Keep the overlay alive: start-countdown reuses this window and
			// flips it from the spinner state to the countdown number.
			const win = getCountdownWindow();
			if (win) {
				sendAwaitingScreenPermission(win, false);
			}
			setCountdownWindowGeometry(false);
		} else {
			closeCountdownWindow();
		}
	},
});

export function registerSettingsHandlers() {
	ipcMain.handle("app:getVersion", () => {
		return app.getVersion();
	});

	ipcMain.handle("get-platform", () => {
		return process.platform;
	});

	ipcMain.on("app-settings:get", (event, key: unknown) => {
		try {
			if (typeof key !== "string" || key.length === 0) {
				event.returnValue = { success: false, value: null };
				return;
			}

			const store = readAppSettingsStore();
			event.returnValue = {
				success: true,
				value: hasAppSetting(store, key) ? store[key] : null,
			};
		} catch (error) {
			console.error("Failed to read app setting:", error);
			event.returnValue = { success: false, value: null };
		}
	});

	ipcMain.on("app-settings:set", (event, key: unknown, value: unknown) => {
		try {
			if (typeof key !== "string" || key.length === 0) {
				event.returnValue = { success: false };
				return;
			}

			const store = readAppSettingsStore();
			store[key] = value;
			writeAppSettingsStore(store);
			event.returnValue = { success: true };
		} catch (error) {
			console.error("Failed to save app setting:", error);
			event.returnValue = { success: false };
		}
	});

	// ---------------------------------------------------------------------------
	// Cursor hiding for the browser-capture fallback.
	// The IPC promise resolves only after the cursor hide attempt completes.
	// ---------------------------------------------------------------------------
	ipcMain.handle("hide-cursor", () => {
		if (process.platform !== "win32") {
			return { success: true };
		}

		return { success: hideCursor() };
	});

	ipcMain.handle("get-shortcuts", async () => {
		try {
			const data = await fs.readFile(SHORTCUTS_FILE, "utf-8");
			return parseJsonWithByteOrderMark(data);
		} catch {
			return null;
		}
	});

	ipcMain.handle("save-shortcuts", async (_, shortcuts: unknown) => {
		try {
			await fs.writeFile(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), "utf-8");
			return { success: true };
		} catch (error) {
			console.error("Failed to save shortcuts:", error);
			return { success: false, error: String(error) };
		}
	});

	// ---------------------------------------------------------------------------
	// Countdown timer before recording
	// ---------------------------------------------------------------------------
	ipcMain.handle("get-recording-preferences", async () => {
		try {
			const parsed = await recordingPreferencesStore.read();
			return {
				success: true,
				microphoneEnabled: parsed.microphoneEnabled === true,
				microphoneDeviceId:
					typeof parsed.microphoneDeviceId === "string"
						? parsed.microphoneDeviceId
						: undefined,
				systemAudioEnabled: parsed.systemAudioEnabled === true,
				webcamEnabled: parsed.webcamEnabled === true,
				webcamDeviceId:
					typeof parsed.webcamDeviceId === "string" ? parsed.webcamDeviceId : undefined,
			};
		} catch {
			return {
				success: true,
				microphoneEnabled: false,
				microphoneDeviceId: undefined,
				systemAudioEnabled: false,
				webcamEnabled: false,
				webcamDeviceId: undefined,
			};
		}
	});

	ipcMain.handle("get-recording-audio-lab-config", () => {
		return getBrowserMicrophoneProfileFromEnv();
	});

	ipcMain.handle("set-recording-preferences", async (_, prefs: RecordingPreferencesPatch) => {
		try {
			await recordingPreferencesStore.update(prefs);
			return { success: true };
		} catch (error) {
			console.error("Failed to save recording preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-countdown-delay", async () => {
		try {
			const content = await fs.readFile(COUNTDOWN_SETTINGS_FILE, "utf-8");
			const parsed = parseJsonWithByteOrderMark<{ delay?: number }>(content);
			return { success: true, delay: parsed.delay ?? 3 };
		} catch {
			return { success: true, delay: 3 };
		}
	});

	ipcMain.handle("set-countdown-delay", async (_, delay: number) => {
		try {
			await fs.writeFile(
				COUNTDOWN_SETTINGS_FILE,
				JSON.stringify({ delay }, null, 2),
				"utf-8",
			);
			return { success: true };
		} catch (error) {
			console.error("Failed to save countdown delay:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("start-countdown", async (_, seconds: number) => {
		if (countdownInProgress) {
			return { success: false, error: "Countdown already in progress" };
		}

		// A post-grant overlay cancel (click / Esc between the permission
		// grant and this call) must suppress the countdown entirely.
		if (screenPermissionWait.consumeCountdownStartGate()) {
			return { success: false, cancelled: true };
		}

		setCountdownInProgress(true);
		setCountdownCancelled(false);
		setCountdownRemaining(seconds);

		// Reuse a live countdown window when one exists: the Linux portal
		// permission wait keeps the overlay open (spinner state) right before
		// the countdown starts, and recreating the window would flash.
		const countdownWin = getCountdownWindow() ?? createCountdownWindow();

		if (countdownWin.webContents.isLoadingMainFrame()) {
			await new Promise<void>((resolve) => {
				countdownWin.webContents.once("did-finish-load", () => {
					resolve();
				});
			});
		}

		return new Promise<{ success: boolean; cancelled?: boolean }>((resolve) => {
			let remaining = seconds;
			setCountdownRemaining(remaining);

			countdownWin.webContents.send("countdown-tick", remaining);

			setCountdownTimer(
				setInterval(() => {
					if (countdownCancelled) {
						if (countdownTimer) {
							clearInterval(countdownTimer);
							setCountdownTimer(null);
						}
						closeCountdownWindow();
						setCountdownInProgress(false);
						setCountdownRemaining(null);
						resolve({ success: false, cancelled: true });
						return;
					}

					remaining--;
					setCountdownRemaining(remaining);

					if (remaining <= 0) {
						if (countdownTimer) {
							clearInterval(countdownTimer);
							setCountdownTimer(null);
						}
						closeCountdownWindow();
						setCountdownInProgress(false);
						setCountdownRemaining(null);
						resolve({ success: true });
					} else {
						const win = getCountdownWindow();
						if (win && !win.isDestroyed()) {
							win.webContents.send("countdown-tick", remaining);
						}
					}
				}, 1000),
			);
		});
	});

	ipcMain.handle("cancel-countdown", () => {
		// Also aborts a pending screen-permission wait (overlay click / Esc
		// while the portal dialog is open).
		screenPermissionWait.cancel();
		setCountdownCancelled(true);
		setCountdownInProgress(false);
		setCountdownRemaining(null);
		if (countdownTimer) {
			clearInterval(countdownTimer);
			setCountdownTimer(null);
		}
		closeCountdownWindow();
		return { success: true };
	});

	ipcMain.handle("get-active-countdown", () => {
		return {
			success: true,
			seconds: countdownInProgress ? countdownRemaining : null,
		};
	});

	ipcMain.handle("get-awaiting-screen-permission", () => {
		return { success: true, awaiting: screenPermissionWait.isAwaitingOverlay() };
	});

	ipcMain.handle("begin-screen-permission-wait", () => {
		const wait = screenPermissionWait.begin();
		if (!wait) {
			return { success: false, cancelled: true, error: "Permission wait already in progress" };
		}
		return wait;
	});

	ipcMain.handle("end-screen-permission-wait", (_, granted: boolean) => {
		return { success: screenPermissionWait.end(granted === true) };
	});
}
