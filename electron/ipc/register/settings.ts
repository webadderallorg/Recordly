import fs from "node:fs/promises";
import { app, ipcMain } from "electron";
import { hideCursor } from "../../cursorHider";
import { closeCountdownWindow, createCountdownWindow, getCountdownWindow } from "../../windows";
import {
	SHORTCUTS_FILE,
	RECORDINGS_SETTINGS_FILE,
	COUNTDOWN_SETTINGS_FILE,
} from "../constants";
import {
	countdownTimer,
	setCountdownTimer,
	countdownCancelled,
	setCountdownCancelled,
	countdownInProgress,
	setCountdownInProgress,
	countdownRemaining,
	setCountdownRemaining,
} from "../state";

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
      return JSON.parse(data);
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

  // ---------------------------------------------------------------------------
  // Countdown timer before recording
  // ---------------------------------------------------------------------------
    ipcMain.handle('get-recording-preferences', async () => {
      try {
        const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, 'utf-8')
        const parsed = JSON.parse(content) as Record<string, unknown>
        return {
          success: true,
          microphoneEnabled: parsed.microphoneEnabled === true,
          microphonePreferenceSet: Object.prototype.hasOwnProperty.call(parsed, 'microphoneEnabled'),
          microphoneDeviceId: typeof parsed.microphoneDeviceId === 'string' ? parsed.microphoneDeviceId : undefined,
          systemAudioEnabled: parsed.systemAudioEnabled !== false,
        }
      } catch {
        return { success: true, microphoneEnabled: false, microphonePreferenceSet: false, microphoneDeviceId: undefined, systemAudioEnabled: true }
      }
    })

    ipcMain.handle('set-recording-preferences', async (_, prefs: { microphoneEnabled?: boolean; microphoneDeviceId?: string; systemAudioEnabled?: boolean }) => {
      try {
        let existing: Record<string, unknown> = {}
        try {
          const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, 'utf-8')
          existing = JSON.parse(content) as Record<string, unknown>
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
      const parsed = JSON.parse(content) as { delay?: number }
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
