import { app, desktopCapturer, ipcMain, shell, systemPreferences } from "electron";
import { getMacPrivacySettingsUrl } from "../utils";
import { isTrustedRenderer } from "../../trustedRenderer";
import {
	dismissPermissionAccessory,
	showPermissionAccessory,
	startPermissionAccessoryDrag,
} from "./permissionAccessory";

async function presentDragAccessory(
	permission: "screen" | "accessibility",
	sender?: Electron.WebContents,
	preview = false,
) {
	try {
		await showPermissionAccessory(permission, sender, preview);
	} catch (error) {
		// System Settings is already open; keep its ordinary controls available.
		console.warn("Could not present the native permission drag accessory:", error);
	}
}

export function registerPermissionHandlers() {
	ipcMain.handle("start-permission-accessory-drag", ({ sender }) =>
		startPermissionAccessoryDrag(sender),
	);
	ipcMain.handle("close-permission-accessory", ({ sender }) =>
		dismissPermissionAccessory(sender),
	);
	ipcMain.handle("open-external-url", async (_, url: string) => {
		try {
			// Only the two displayed contact addresses may launch a mail client; other protocols stay blocked.
			const parsed = new URL(url);
			if (
				parsed.protocol !== "https:" &&
				parsed.protocol !== "http:" &&
				url !== "mailto:support@recordly.dev" &&
				url !== "mailto:youngchen3442@gmail.com"
			) {
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
		};
	});

	ipcMain.handle("request-accessibility-permission", () => {
		if (process.platform !== "darwin") {
			return { success: true, trusted: true, prompted: false };
		}

		return {
			success: true,
			trusted: systemPreferences.isTrustedAccessibilityClient(true),
			prompted: true,
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

	ipcMain.handle("get-media-permission-status", () => {
		if (process.platform !== "darwin") {
			return { success: true, microphone: "unknown", camera: "unknown" };
		}

		try {
			return {
				success: true,
				microphone: systemPreferences.getMediaAccessStatus("microphone"),
				camera: systemPreferences.getMediaAccessStatus("camera"),
			};
		} catch (error) {
			console.error("Failed to get media permission status:", error);
			return {
				success: false,
				microphone: "unknown",
				camera: "unknown",
				error: String(error),
			};
		}
	});

	ipcMain.handle("request-media-permission", async (event, device: unknown) => {
		if (!event?.sender || !isTrustedRenderer(event))
			return { success: false, error: "Untrusted media permission caller" };
		if (device !== "microphone" && device !== "camera")
			return { success: false, error: "Invalid media permission device" };
		if (process.platform !== "darwin")
			return {
				success: false,
				error: "Native media permission requests are unsupported on this platform",
			};
		try {
			const status = systemPreferences.getMediaAccessStatus(device);
			// Only a user's first-time Allow action should present a native prompt.
			const granted =
				status === "not-determined"
					? await systemPreferences.askForMediaAccess(device)
					: status === "granted";
			return { success: true, granted };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-media-permission-preferences", async (_, device: unknown) => {
		if (device !== "microphone" && device !== "camera") {
			return { success: false, error: "Invalid media permission device" };
		}
		if (process.platform !== "darwin") {
			return {
				success: false,
				error: "Media permission settings are unsupported on this platform",
			};
		}

		try {
			await shell.openExternal(getMacPrivacySettingsUrl(device));
			return { success: true };
		} catch (error) {
			console.error(`Failed to open ${device} preferences:`, error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-screen-recording-preferences", async (event, preview: unknown) => {
		if (process.platform !== "darwin") {
			return { success: true };
		}

		try {
			// First-time access must register Recordly in macOS before its settings row can be enabled.
			const testSetup = preview === true && !app.isPackaged;
			if (
				!testSetup &&
				systemPreferences.getMediaAccessStatus("screen") === "not-determined"
			) {
				try {
					await desktopCapturer.getSources({
						types: ["screen"],
						thumbnailSize: { width: 0, height: 0 },
					});
				} catch {
					// A denied prompt still needs the settings page so access can be enabled later.
				}
			}
			await shell.openExternal(getMacPrivacySettingsUrl("screen"));
			await presentDragAccessory("screen", event?.sender, testSetup);
			return { success: true };
		} catch (error) {
			console.error("Failed to open Screen Recording preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-accessibility-preferences", async (event, preview: unknown) => {
		if (process.platform !== "darwin") {
			return { success: true };
		}

		try {
			await shell.openExternal(getMacPrivacySettingsUrl("accessibility"));
			await presentDragAccessory(
				"accessibility",
				event?.sender,
				preview === true && !app.isPackaged,
			);
			return { success: true };
		} catch (error) {
			console.error("Failed to open Accessibility preferences:", error);
			return { success: false, error: String(error) };
		}
	});
}
