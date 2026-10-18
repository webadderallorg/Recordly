import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openRecordingSettings(page: Page) {
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Projects dashboard", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page.getByRole("row", { name: "Recording", exact: true }).click();
	return page.getByRole("region", { name: "Recording settings", exact: true });
}

test("remote visible mode preserves protection preference and shortcut conflicts are visible", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getHudOverlayCaptureProtection = async () => ({
			success: true,
			enabled: true,
		});
	});
	await page.goto("/?windowType=editor");
	let settings = await openRecordingSettings(page);
	const hidden = settings.getByRole("switch", { name: "Hide HUD from recordings" });
	const remote = settings.getByRole("switch", { name: "Remote visible mode" });
	await expect(hidden).toBeChecked();
	await remote.press("Space");
	await expect(remote).toBeChecked();
	await expect(hidden).toBeDisabled();
	await expect(hidden).toBeChecked();
	await settings.getByRole("textbox", { name: "Start / stop recording" }).fill("F9");
	await settings.getByRole("button", { name: "Save shortcuts" }).click();
	await expect(settings.getByRole("alert")).toHaveText("F9 is already in use.");
	await page.reload();
	settings = await openRecordingSettings(page);
	await expect(settings.getByRole("switch", { name: "Remote visible mode" })).toBeChecked();
	await expect(settings.getByRole("textbox", { name: "Start / stop recording" })).toHaveValue(
		"F9",
	);
	await settings.getByRole("switch", { name: "Remote visible mode" }).press("Space");
	await expect(settings.getByRole("switch", { name: "Hide HUD from recordings" })).toBeEnabled();
	await expect(settings.getByRole("switch", { name: "Hide HUD from recordings" })).toBeChecked();
	await settings.getByRole("button", { name: "Reset shortcuts" }).click();
	await expect(settings.getByRole("textbox", { name: "Choose recording source" })).toHaveValue(
		"CommandOrControl+Shift+2",
	);
	await expect(settings.getByRole("textbox", { name: "Start / stop recording" })).toHaveValue(
		"CommandOrControl+Alt+R",
	);
	await page.screenshot({ path: "test-results/remote-recording-settings.png", fullPage: true });
});

test("HUD shortcut events start, pause, resume and stop through existing capture callbacks", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		const increment = (name: string) => {
			const data = document.documentElement.dataset;
			data[name] = String(Number(data[name] ?? 0) + 1);
		};
		Object.assign(window.electronAPI, {
			pickCaptureTarget: async () => {
				increment("pickerOpens");
				return { success: false, canceled: true };
			},
			getCountdownDelay: async () => ({ success: true, delay: 0 }),
			getRecordingPreferences: async () => ({
				success: true,
				microphoneEnabled: false,
				systemAudioEnabled: false,
				webcamEnabled: false,
			}),
			startNativeScreenRecording: async () => {
				increment("captureStarts");
				return { success: true };
			},
			pauseNativeScreenRecording: async () => {
				increment("capturePauses");
				return { success: true };
			},
			resumeNativeScreenRecording: async () => {
				increment("captureResumes");
				return { success: true };
			},
			stopNativeScreenRecording: async () => {
				increment("captureStops");
				return { success: false, error: "test ends before media finalization" };
			},
		});
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
	const command = (action: string) =>
		page.evaluate((action) => {
			window.dispatchEvent(new CustomEvent("test-recording-shortcut", { detail: action }));
		}, action);
	await command("togglePause");
	await expect(page.locator("html")).not.toHaveAttribute("data-capture-pauses");
	await command("toggleRecording");
	await expect(page.locator("html")).toHaveAttribute("data-capture-starts", "1");
	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
	await command("openCapturePicker");
	await expect(page.locator("html")).not.toHaveAttribute("data-picker-opens");
	await command("togglePause");
	await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
	await command("togglePause");
	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
	await command("toggleRecording");
	await expect(page.locator("html")).toHaveAttribute("data-capture-stops", "1");
});

test("source shortcut reuses the source button, coalesces repeated input, and does not record", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.pickCaptureTarget = async () => {
			const data = document.documentElement.dataset;
			data.pickerOpens = String(Number(data.pickerOpens ?? 0) + 1);
			await new Promise<void>((resolve) =>
				window.addEventListener("test-complete-picker", () => resolve(), { once: true }),
			);
			return {
				success: true,
				source: {
					id: "screen:2:0",
					name: "External display",
					display_id: "2",
					thumbnail: "",
				},
			};
		};
		window.electronAPI.startNativeScreenRecording = async () => {
			throw new Error("Selecting must not start capture");
		};
	});
	await page.goto("/?windowType=hud-overlay");
	const sourceButton = page.getByRole("button", { name: "Choose recording source", exact: true });
	await expect(sourceButton).toBeEnabled();
	await page.evaluate(() =>
		window.dispatchEvent(
			new CustomEvent("test-recording-shortcut", { detail: "openCapturePicker" }),
		),
	);
	await expect(page.locator("html")).toHaveAttribute("data-picker-opens", "1");
	await page.evaluate(() => {
		window.dispatchEvent(
			new CustomEvent("test-recording-shortcut", { detail: "openCapturePicker" }),
		);
		window.dispatchEvent(
			new CustomEvent("test-recording-shortcut", { detail: "toggleRecording" }),
		);
		window.dispatchEvent(new Event("test-complete-picker"));
	});
	await expect(sourceButton).toContainText("External display");
	await expect(page.locator("html")).toHaveAttribute("data-picker-opens", "1");
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
});
