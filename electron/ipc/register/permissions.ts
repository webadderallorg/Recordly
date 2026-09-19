import { app, ipcMain, shell, systemPreferences } from "electron";
import { probeInProcessKeystrokeTap, stopInProcessKeystrokeTap } from "../cursor/macKeystrokeTap";
import { getMacPrivacySettingsUrl } from "../utils";

function accessibilityClientName() {
	if (process.execPath.includes("Electron.app")) {
		return "Electron";
	}
	return app.name || "Recordly";
}

export function registerPermissionHandlers() {
	ipcMain.handle("open-external-url", async (_, url: string) => {
		try {
			// Security: only allow http/https URLs to prevent file:// or custom protocol abuse
			const parsed = new URL(url);
			if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
				return { success: false, error: `Blocked non-HTTP URL: ${parsed.protocol}` };
			}
			await shell.openExternal(url);
			return { success: true };
		} catch (error) {
			console.error("Failed to open URL:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-accessibility-permission-status", () => {
		if (process.platform !== "darwin") {
			return { success: true, trusted: true, prompted: false };
		}

		return {
			success: true,
			trusted: systemPreferences.isTrustedAccessibilityClient(false),
			prompted: false,
			clientName: accessibilityClientName(),
		};
	});

	ipcMain.handle("request-accessibility-permission", () => {
		if (process.platform !== "darwin") {
			return { success: true, trusted: true, prompted: false, clientName: accessibilityClientName() };
		}

		return {
			success: true,
			trusted: systemPreferences.isTrustedAccessibilityClient(true),
			prompted: true,
			clientName: accessibilityClientName(),
		};
	});

	ipcMain.handle("stop-keystroke-tap", () => {
		stopInProcessKeystrokeTap();
		return { success: true };
	});

	ipcMain.handle("request-keystroke-capture-permission", async () => {
		if (process.platform !== "darwin") {
			return { success: true, trusted: true, clientName: accessibilityClientName() };
		}

		const trusted = systemPreferences.isTrustedAccessibilityClient(true);
		let helperReady = false;
		try {
			const started = await probeInProcessKeystrokeTap();
			helperReady = started;
			if (!helperReady) {
				console.warn("Unable to prepare keystroke tap helper: in-process CGEventTapCreate failed");
			}
		} catch (error) {
			console.warn("Unable to prepare keystroke tap helper:", error);
		}

		return {
			success: true,
			trusted,
			tapOk: helperReady,
			clientName: accessibilityClientName(),
		};
	});

	ipcMain.handle("get-screen-recording-permission-status", () => {
		if (process.platform !== "darwin") {
			return { success: true, status: "granted" };
		}

		try {
			return {
				success: true,
				status: systemPreferences.getMediaAccessStatus("screen"),
			};
		} catch (error) {
			console.error("Failed to get screen recording permission status:", error);
			return { success: false, status: "unknown", error: String(error) };
		}
	});

	ipcMain.handle("open-screen-recording-preferences", async () => {
		if (process.platform !== "darwin") {
			return { success: true };
		}

		try {
			await shell.openExternal(getMacPrivacySettingsUrl("screen"));
			return { success: true };
		} catch (error) {
			console.error("Failed to open Screen Recording preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-accessibility-preferences", async () => {
		if (process.platform !== "darwin") {
			return { success: true };
		}

		try {
			await shell.openExternal(getMacPrivacySettingsUrl("accessibility"));
			return { success: true };
		} catch (error) {
			console.error("Failed to open Accessibility preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-input-monitoring-preferences", async () => {
		if (process.platform !== "darwin") {
			return { success: true };
		}

		try {
			await shell.openExternal(getMacPrivacySettingsUrl("input-monitoring"));
			return { success: true };
		} catch (error) {
			console.error("Failed to open Input Monitoring preferences:", error);
			return { success: false, error: String(error) };
		}
	});
}
