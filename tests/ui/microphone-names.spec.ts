import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("renaming a microphone survives reload, keeps its system label and selects its real ID", async ({
	page,
}, testInfo) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const inputs = [
			{ deviceId: "laptop", label: "Built-in Microphone" },
			{ deviceId: "phone", label: "iPhone Microphone" },
		];
		navigator.mediaDevices.enumerateDevices = async () =>
			inputs.map((input) => ({
				...input,
				kind: "audioinput",
				groupId: input.deviceId,
				toJSON: () => input,
			}));
		// The desktop bridge owns the persistent settings and native text dialog.
		const api = window.electronAPI;
		const getSetting = api.getAppSetting;
		api.getAppSetting = (key) =>
			key === "recordly.microphoneNames.v1"
				? JSON.parse(localStorage.getItem(key) ?? "null")
				: getSetting(key);
		api.setAppSetting = (key, value) => {
			localStorage.setItem(key, JSON.stringify(value));
			return true;
		};
		api.openMicrophoneNameDialog = async () => sessionStorage.getItem("dialog-result");
		api.setRecordingPreferences = async (value) => {
			if (value.microphoneDeviceId)
				document.documentElement.dataset.chosenMic = value.microphoneDeviceId;
			return { success: true };
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const audio = page.getByRole("button", { name: "Audio settings", exact: true });
	const menu = page.getByRole("dialog", { name: "Audio settings" });
	const edit = menu.getByRole("button", { name: "Rename iPhone Microphone" });
	await audio.click();
	await expect(edit).toBeVisible();
	await page.evaluate(() => sessionStorage.setItem("dialog-result", "DJI Mic Mini via iPhone"));
	await edit.click();
	const row = menu.getByRole("button", { name: /DJI Mic Mini via iPhone.*iPhone Microphone/ });
	await expect(row).toBeVisible();
	await page.reload();
	await audio.click();
	await expect(row).toBeVisible();
	await row.click();
	await expect(page.locator("html")).toHaveAttribute("data-chosen-mic", "phone");
	await menu.screenshot({ path: testInfo.outputPath("microphone-menu.png") });
	await page.evaluate(() => sessionStorage.removeItem("dialog-result"));
	await edit.click();
	await expect(row).toBeVisible();
	await page.evaluate(() => sessionStorage.setItem("dialog-result", ""));
	await edit.click();
	await expect(row).toHaveCount(0);
	await expect(menu.getByRole("button", { name: /^iPhone Microphone/ })).toBeVisible();
});

test("the name editor can save, cancel and restore the system name", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const api = window.electronAPI;
		api.getMicrophoneNameDialog = async () => ({
			label: "iPhone Microphone",
			name: "Wireless",
		});
		api.submitMicrophoneName = (value) => {
			document.documentElement.dataset.submitted = value;
		};
		api.windowControl = async () => {
			document.documentElement.dataset.cancelled = "true";
			return { success: true };
		};
	});
	await page.goto("/?windowType=microphone-name");
	const name = page.getByRole("textbox", { name: "Rename iPhone Microphone" });
	await expect(name).toBeFocused();
	await expect(name).toHaveValue("Wireless");
	await name.fill("Desk mic");
	await name.press("Enter");
	await expect(page.locator("html")).toHaveAttribute("data-submitted", "Desk mic");
	await name.press("Escape");
	await expect(page.locator("html")).toHaveAttribute("data-cancelled", "true");
	await page.getByRole("button", { name: "Reset" }).click();
	await expect(name).toHaveValue("");
	await page.getByRole("button", { name: "Save" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-submitted", "");
});
