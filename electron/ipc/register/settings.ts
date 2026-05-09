import fs from "node:fs/promises";
import { app, globalShortcut, ipcMain } from "electron";
import { hideCursor } from "../../cursorHider";
import {
	closeCountdownWindow,
	createCountdownWindow,
	getCountdownWindow,
	getHudOverlayWindow,
} from "../../windows";
import {
	isLaunchShortcutAction,
	type LaunchShortcutAction,
	type ShortcutBinding,
} from "../shortcutTypes";
import {
	COUNTDOWN_SETTINGS_FILE,
	RECORDINGS_SETTINGS_FILE,
	SHORTCUTS_FILE,
} from "../constants";
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

const BROWSER_MICROPHONE_PROFILE_ENV = "RECORDLY_BROWSER_MIC_PROFILE";
const DEFAULT_BROWSER_MICROPHONE_PROFILE = "no-agc";
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

let launchShortcutRegisteredAccelerators: string[] = [];
const ELECTRON_KEY_MAP: Record<string, string> = {
	arrowup: "Up",
	arrowdown: "Down",
	arrowleft: "Left",
	arrowright: "Right",
	escape: "Escape",
	backspace: "Backspace",
	delete: "Delete",
	enter: "Enter",
	tab: "Tab",
};

function toElectronAccelerator(binding: ShortcutBinding): string | null {
	const rawKey = binding.key;
	if (rawKey === " ") {
		const parts: string[] = [];
		if (binding.ctrl) parts.push("CommandOrControl");
		if (binding.shift) parts.push("Shift");
		if (binding.alt) parts.push("Alt");
		parts.push("Space");
		return parts.join("+");
	}

	const key = rawKey?.trim().toLowerCase();
	if (!key) return null;
	let mappedKey: string;
	if (ELECTRON_KEY_MAP[key]) {
		mappedKey = ELECTRON_KEY_MAP[key];
	} else if (key.length === 1) {
		mappedKey = key.toUpperCase();
	} else {
		mappedKey = key.charAt(0).toUpperCase() + key.slice(1);
	}
	const parts: string[] = [];
	if (binding.ctrl) parts.push("CommandOrControl");
	if (binding.shift) parts.push("Shift");
	if (binding.alt) parts.push("Alt");
	parts.push(mappedKey);
	return parts.join("+");
}

function unregisterLaunchGlobalShortcuts() {
	for (const accelerator of launchShortcutRegisteredAccelerators) {
		globalShortcut.unregister(accelerator);
	}
	launchShortcutRegisteredAccelerators = [];
}

function notifyLaunchShortcutTriggered(action: LaunchShortcutAction) {
	const hud = getHudOverlayWindow();
	if (!hud || hud.isDestroyed()) {
		return;
	}
	hud.webContents.send("launch-shortcut-triggered", action);
}

export function registerSettingsHandlers() {
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });

  // ---------------------------------------------------------------------------
  // Cursor hiding for the browser-capture fallback.
  // The IPC promise resolves only after the cursor hide attempt completes.
  // ---------------------------------------------------------------------------
  ipcMain.handle('hide-cursor', () => {
    if (process.platform !== 'win32') {
      return { success: true }
    }

    return { success: hideCursor() }
  })

  ipcMain.handle('get-shortcuts', async () => {
    try {
      const data = await fs.readFile(SHORTCUTS_FILE, 'utf-8');
      return parseJsonWithByteOrderMark(data);
    } catch {
      return null;
    }
  });

  ipcMain.handle('save-shortcuts', async (_, shortcuts: unknown) => {
    try {
      await fs.writeFile(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Failed to save shortcuts:', error);
      return { success: false, error: String(error) };
    }
  });

	ipcMain.handle("register-launch-global-shortcuts", async (_, config: unknown) => {
		try {
			unregisterLaunchGlobalShortcuts();
			if (!config || typeof config !== "object") {
				return { success: true };
			}

			const failedRegistrations: Array<{ action: LaunchShortcutAction; accelerator: string }> = [];
			const entries = Object.entries(config as Record<string, ShortcutBinding>);
			for (const [action, binding] of entries) {
				if (!isLaunchShortcutAction(action)) {
					console.warn("Ignoring unknown launch shortcut action in config:", action);
					continue;
				}
				const accelerator = toElectronAccelerator(binding);
				if (!accelerator) continue;
				const registered = globalShortcut.register(accelerator, () => {
					notifyLaunchShortcutTriggered(action);
				});
				if (registered) {
					launchShortcutRegisteredAccelerators.push(accelerator);
				} else {
					const failedRegistration = {
						action,
						accelerator,
					};
					failedRegistrations.push(failedRegistration);
					console.warn("Failed to register launch global shortcut:", failedRegistration);
				}
			}
			return { success: true, failedRegistrations };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("unregister-launch-global-shortcuts", async () => {
		try {
			unregisterLaunchGlobalShortcuts();
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

  // ---------------------------------------------------------------------------
  // Countdown timer before recording
  // ---------------------------------------------------------------------------
    ipcMain.handle('get-recording-preferences', async () => {
      try {
        const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, 'utf-8')
        const parsed = parseJsonWithByteOrderMark<Record<string, unknown>>(content)
        return {
          success: true,
          microphoneEnabled: parsed.microphoneEnabled === true,
          microphoneDeviceId: typeof parsed.microphoneDeviceId === 'string' ? parsed.microphoneDeviceId : undefined,
          systemAudioEnabled: parsed.systemAudioEnabled === true,
        }
      } catch {
        return { success: true, microphoneEnabled: false, microphoneDeviceId: undefined, systemAudioEnabled: false }
      }
    })

    ipcMain.handle('get-recording-audio-lab-config', () => {
      return getBrowserMicrophoneProfileFromEnv()
    })

    ipcMain.handle('set-recording-preferences', async (_, prefs: { microphoneEnabled?: boolean; microphoneDeviceId?: string; systemAudioEnabled?: boolean }) => {
      try {
        let existing: Record<string, unknown> = {}
        try {
          const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, 'utf-8')
          existing = parseJsonWithByteOrderMark<Record<string, unknown>>(content)
        } catch {
          // file doesn't exist yet
        }
        const merged = { ...existing, ...prefs }
        await fs.writeFile(RECORDINGS_SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8')
        return { success: true }
      } catch (error) {
        console.error('Failed to save recording preferences:', error)
        return { success: false, error: String(error) }
      }
    })

  ipcMain.handle('get-countdown-delay', async () => {
    try {
      const content = await fs.readFile(COUNTDOWN_SETTINGS_FILE, 'utf-8')
      const parsed = parseJsonWithByteOrderMark<{ delay?: number }>(content)
      return { success: true, delay: parsed.delay ?? 3 }
    } catch {
      return { success: true, delay: 3 }
    }
  })

  ipcMain.handle('set-countdown-delay', async (_, delay: number) => {
    try {
      await fs.writeFile(COUNTDOWN_SETTINGS_FILE, JSON.stringify({ delay }, null, 2), 'utf-8')
      return { success: true }
    } catch (error) {
      console.error('Failed to save countdown delay:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('start-countdown', async (_, seconds: number) => {
    if (countdownInProgress) {
      return { success: false, error: 'Countdown already in progress' }
    }

    setCountdownInProgress(true)
    setCountdownCancelled(false)
    setCountdownRemaining(seconds)

    const countdownWin = createCountdownWindow()

    if (countdownWin.webContents.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        countdownWin.webContents.once('did-finish-load', () => {
          resolve()
        })
      })
    }

    return new Promise<{ success: boolean; cancelled?: boolean }>((resolve) => {
      let remaining = seconds
      setCountdownRemaining(remaining)

      countdownWin.webContents.send('countdown-tick', remaining)

      setCountdownTimer(setInterval(() => {
        if (countdownCancelled) {
          if (countdownTimer) {
            clearInterval(countdownTimer)
            setCountdownTimer(null)
          }
          closeCountdownWindow()
          setCountdownInProgress(false)
          setCountdownRemaining(null)
          resolve({ success: false, cancelled: true })
          return
        }

        remaining--
        setCountdownRemaining(remaining)

        if (remaining <= 0) {
          if (countdownTimer) {
            clearInterval(countdownTimer)
            setCountdownTimer(null)
          }
          closeCountdownWindow()
          setCountdownInProgress(false)
          setCountdownRemaining(null)
          resolve({ success: true })
        } else {
          const win = getCountdownWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('countdown-tick', remaining)
          }
        }
      }, 1000))
    })
  })

  ipcMain.handle('cancel-countdown', () => {
    setCountdownCancelled(true)
    setCountdownInProgress(false)
    setCountdownRemaining(null)
    if (countdownTimer) {
      clearInterval(countdownTimer)
      setCountdownTimer(null)
    }
    closeCountdownWindow()
    return { success: true }
  })

  ipcMain.handle('get-active-countdown', () => {
    return {
      success: true,
      seconds: countdownInProgress ? countdownRemaining : null,
    }
  })
}
