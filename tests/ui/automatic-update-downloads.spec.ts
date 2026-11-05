import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openUpdates(page: Page) {
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	return settings;
}

test("automatic downloads are off initially and save either choice across reloads", async ({
	page,
}) => {
	// This scenario reloads the full editor three times, including a cold lazy import.
	test.setTimeout(90_000);
	await installDesktopBridge(page);
	let settings = await openUpdates(page);
	let toggle = settings.getByRole("switch", {
		name: "Automatically download updates",
		exact: true,
	});
	await expect(toggle).toBeEnabled();
	await expect(toggle).not.toBeChecked();
	const updates = settings.getByRole("region", { name: "App update", exact: true });
	await updates.scrollIntoViewIfNeeded();
	await expect(updates.getByRole("status")).toHaveCount(0);
	await expect(
		settings.getByText("Choose how updates download. Restart when you’re ready.", {
			exact: true,
		}),
	).not.toBeVisible();
	const version = await updates
		.getByRole("heading", { name: "Installed version", exact: true })
		.locator("..")
		.boundingBox();
	const actions = await updates
		.getByRole("button", { name: "Check for updates", exact: true })
		.locator("..")
		.boundingBox();
	expect(
		Math.abs(version!.y + version!.height / 2 - actions!.y - actions!.height / 2),
	).toBeLessThan(1);
	await settings
		.locator(".settings-row")
		.filter({
			has: page.getByRole("switch", { name: "Automatically download updates", exact: true }),
		})
		.scrollIntoViewIfNeeded();
	await settings.screenshot({ path: "output/update-flow/automatic-downloads-off.png" });
	await toggle.focus();
	await toggle.press("Space");
	await expect(toggle).toBeChecked();
	settings = await openUpdates(page);
	toggle = settings.getByRole("switch", {
		name: "Automatically download updates",
		exact: true,
	});
	await expect(toggle).toBeChecked();
	await settings
		.locator(".settings-row")
		.filter({
			has: page.getByRole("switch", { name: "Automatically download updates", exact: true }),
		})
		.locator('[data-slot="switch-control"]')
		.click();
	await expect(toggle).not.toBeChecked();
	settings = await openUpdates(page);
	await expect(
		settings.getByRole("switch", { name: "Automatically download updates", exact: true }),
	).not.toBeChecked();
});

test("a failed save keeps the previous automatic download choice", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.setAutomaticUpdateDownloadsEnabled = async () => ({
			success: false,
			enabled: false,
		});
	});
	const settings = await openUpdates(page);
	const toggle = settings.getByRole("switch", {
		name: "Automatically download updates",
		exact: true,
	});
	await expect(toggle).toBeEnabled();
	await settings
		.locator(".settings-row")
		.filter({
			has: page.getByRole("switch", { name: "Automatically download updates", exact: true }),
		})
		.locator('[data-slot="switch-control"]')
		.click();
	await expect(toggle).not.toBeChecked();
	await expect(settings.getByRole("alert")).toContainText(
		"Could not load or save automatic update downloads",
	);
});

test("failed preference loading can be retried without enabling automatic downloads", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAutomaticUpdateDownloadsEnabled = async () => {
			if (document.documentElement.dataset.preferenceLoadReady !== "true")
				throw Error("Unavailable");
			return false;
		};
	});
	const settings = await openUpdates(page);
	const toggle = settings.getByRole("switch", {
		name: "Automatically download updates",
		exact: true,
	});
	await expect(toggle).toBeDisabled();
	await page.evaluate(() => {
		document.documentElement.dataset.preferenceLoadReady = "true";
	});
	await settings.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(toggle).toBeEnabled();
	await expect(toggle).not.toBeChecked();
});

test("Settings keeps update actions available after notification dismissal and shows progress", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let summary: Awaited<ReturnType<Window["electronAPI"]["getUpdateStatusSummary"]>> = {
			status: "available",
			currentVersion: "1.4.0",
			availableVersion: "1.5.0",
		};
		window.electronAPI.getAppVersion = async () => "1.4.0";
		window.electronAPI.getUpdateStatusSummary = async () => summary;
		// The notification is dismissed; Settings must use the durable updater status.
		window.electronAPI.getCurrentUpdateToastPayload = async () => null;
		window.electronAPI.onUpdateToastStateChanged = (callback) => {
			const listener = (event: Event) => {
				summary = (event as CustomEvent).detail;
				callback(null);
			};
			window.addEventListener("test-settings-update", listener);
			return () => window.removeEventListener("test-settings-update", listener);
		};
		window.electronAPI.downloadAvailableUpdate = async (restart) => {
			document.documentElement.dataset.updateRestart = String(restart);
			window.dispatchEvent(
				new CustomEvent("test-settings-update", {
					detail: { ...summary, status: "downloading", progressPercent: 42 },
				}),
			);
			return { success: true };
		};
		window.electronAPI.installDownloadedUpdate = async () => ({
			success: false,
			code: "restart-blocked",
			message:
				"Finish recording or exporting and save your project before restarting to update.",
		});
	});
	const settings = await openUpdates(page);
	const status = settings.getByRole("region", { name: "App update", exact: true });
	await expect(status).toContainText("Recordly 1.5.0 is available.");
	await status.getByRole("button", { name: "Download update", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-update-restart", "false");
	await expect(status.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
	await settings.screenshot({ path: "output/update-flow/settings-downloading.png" });
	await page.evaluate(() =>
		window.dispatchEvent(
			new CustomEvent("test-settings-update", {
				detail: { status: "ready", currentVersion: "1.4.0", availableVersion: "1.5.0" },
			}),
		),
	);
	await expect(status).toContainText("Recordly 1.5.0 is ready to install.");
	await settings.screenshot({ path: "output/update-flow/settings-ready.png" });
	await page.setViewportSize({ width: 760, height: 720 });
	await expect(
		status.getByRole("button", { name: "Restart to update", exact: true }),
	).toBeVisible();
	expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
		true,
	);
	await settings.screenshot({ path: "output/update-flow/settings-ready-narrow.png" });
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await settings.screenshot({ path: "output/update-flow/settings-ready-dark.png" });
	await page.emulateMedia({ colorScheme: "light" });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await status.getByRole("button", { name: "Restart to update", exact: true }).click();
	await expect(
		status
			.getByRole("alert")
			.getByText(
				"Finish recording or exporting and save your project before restarting to update.",
				{ exact: true },
			),
	).toBeVisible();
	await expect(
		status.getByRole("button", { name: "Restart to update", exact: true }),
	).toBeEnabled();
	await settings.screenshot({ path: "output/update-flow/settings-ready-blocked.png" });
});
