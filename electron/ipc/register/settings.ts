import { createCountdownController } from "../../countdownController";
import fs from "node:fs/promises";
import { app, BrowserWindow, ipcMain } from "electron";
import { hasAppSetting, readAppSettingsStore, writeAppSettingsStore } from "../../appSettingsStore";
import { hideCursor } from "../../cursorHider";
import { createCountdownWindow } from "../../windows";
import { COUNTDOWN_SETTINGS_FILE, RECORDINGS_SETTINGS_FILE, SHORTCUTS_FILE } from "../constants";
import {
	createRecordingPreferencesStore,
	type RecordingPreferencesPatch,
} from "../settings/recordingPreferencesStore";
import {
	countdownInProgress,
	countdownRemaining,
	setCountdownInProgress,
	setCountdownRemaining,
} from "../state";
import { parseJsonWithByteOrderMark } from "../utils";

const BROWSER_MICROPHONE_PROFILE_ENV = "RECORDLY_BROWSER_MIC_PROFILE";
const DEFAULT_BROWSER_MICROPHONE_PROFILE = "no-agc";
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

export function registerSettingsHandlers() {
	ipcMain.handle(
		"get-window-fullscreen",
		(event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false,
	);
	ipcMain.handle("app:getVersion", () => {
		return app.getVersion();
	});

	ipcMain.handle("get-window-chrome", (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		return {
			trafficLightsVisible:
				process.platform === "darwin" &&
				!!win &&
				!win.isFullScreen() &&
				!win.isSimpleFullScreen(),
		};
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

	const countdown = createCountdownController(createCountdownWindow, (remaining) => {
		setCountdownRemaining(remaining);
		setCountdownInProgress(remaining !== null);
	});
	ipcMain.handle("start-countdown", (_, seconds: number) => countdown.start(seconds));
	ipcMain.handle("cancel-countdown", () => countdown.cancel());

	ipcMain.handle("get-active-countdown", () => {
		return {
			success: true,
			seconds: countdownInProgress ? countdownRemaining : null,
		};
	});
}
