import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("HUD has no update controls even when an update is available", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("group", { name: "Recording setup", exact: true })).toBeVisible();
	await expect(page.locator("[data-hud-update-pill]")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /update|restart/i })).toHaveCount(0);
});

test("separate update notification downloads without restarting and shows progress", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let payload: Awaited<ReturnType<Window["electronAPI"]["getCurrentUpdateToastPayload"]>> = {
			version: "9.9.9",
			phase: "available",
			detail: "Preview",
			delayMs: 60000,
			isPreview: true,
		};
		window.electronAPI.getCurrentUpdateToastPayload = async () => payload;
		window.electronAPI.onUpdateToastStateChanged = (callback) => {
			const listener = (event: Event) => {
				payload = (event as CustomEvent).detail;
				callback(payload);
			};
			window.addEventListener("test-update", listener);
			return () => window.removeEventListener("test-update", listener);
		};
		window.electronAPI.downloadAvailableUpdate = async (autoRestart) => {
			document.documentElement.dataset.autoRestart = String(autoRestart);
			window.dispatchEvent(
				new CustomEvent("test-update", {
					detail: { ...payload, phase: "downloading", progressPercent: 42 },
				}),
			);
			return { success: true };
		};
	});
	await page.goto("/?windowType=update-toast");
	await expect(
		page.getByRole("heading", { name: "Update available", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Download update", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-auto-restart", "false");
	await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
	await page.screenshot({ path: test.info().outputPath("notification.png") });
});

test("downloaded update notification waits for an explicit restart", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentUpdateToastPayload = async () => ({
			version: "9.9.9",
			phase: "ready",
			detail: "Ready",
			delayMs: 60000,
			isPreview: true,
		});
		window.electronAPI.installDownloadedUpdate = async () => {
			document.documentElement.dataset.restartRequested = "true";
			return { success: true };
		};
	});
	await page.goto("/?windowType=update-toast");
	await expect(
		page.getByRole("heading", { name: "Ready to restart", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Update & restart", exact: true })).toHaveCount(
		0,
	);
	await expect(page.locator("html")).not.toHaveAttribute("data-restart-requested");
	await page.getByRole("button", { name: "Restart to update", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-restart-requested", "true");
});

test("a blocked restart stays visible and can be retried from the notification", async ({
	page,
}) => {
	await page.setViewportSize({ width: 420, height: 236 });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentUpdateToastPayload = async () => ({
			version: "1.5.0",
			phase: "ready",
			detail: "Ready",
			delayMs: 10_800_000,
		});
		window.electronAPI.installDownloadedUpdate = async () => ({
			success: false,
			code: "restart-blocked",
			message:
				"Finish recording or exporting and save your project before restarting to update.",
		});
	});
	await page.goto("/?windowType=update-toast");
	await page.getByRole("button", { name: "Restart to update", exact: true }).click();
	await expect(
		page
			.getByRole("alert")
			.getByText(
				"Finish recording or exporting and save your project before restarting to update.",
				{ exact: true },
			),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Restart to update", exact: true }),
	).toBeEnabled();
	await expect(
		page.getByRole("heading", { name: "Ready to restart", exact: true }),
	).toBeVisible();
	const card = page.locator('[data-slot="card"]');
	const bounds = await card.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.y).toBeGreaterThanOrEqual(0);
	expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(236);
	await page.screenshot({ path: test.info().outputPath("notification-ready-blocked.png") });
});

for (const locale of ["de", "fr", "zh-TW"]) {
	test(`experimental notification fits its desktop window in ${locale}`, async ({ page }) => {
		await page.setViewportSize({ width: 420, height: 236 });
		await installDesktopBridge(page);
		await page.addInitScript(
			(language) => localStorage.setItem("recordly.locale", language),
			locale,
		);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getCurrentUpdateToastPayload = async () => ({
				version: "2.0.0-beta.2",
				phase: "available",
				detail: "Experimental",
				delayMs: 10_800_000,
				isExperimental: true,
			});
		});
		await page.goto("/?windowType=update-toast");
		await expect(page.getByRole("heading")).toBeVisible();
		const bounds = await page.locator('[data-slot="card"]').boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.y).toBeGreaterThanOrEqual(0);
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(236);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(420);
		await page.screenshot({ path: test.info().outputPath(`notification-${locale}.png`) });
	});
}

test("the notification can be hidden while its download request is pending", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const payload = {
			version: "1.5.0",
			phase: "available" as const,
			detail: "Available",
			delayMs: 10_800_000,
		};
		let listener: Parameters<Window["electronAPI"]["onUpdateToastStateChanged"]>[0];
		window.electronAPI.getCurrentUpdateToastPayload = async () => payload;
		window.electronAPI.onUpdateToastStateChanged = (callback) => {
			listener = callback;
			return () => undefined;
		};
		window.electronAPI.downloadAvailableUpdate = () => {
			listener({ ...payload, phase: "downloading", progressPercent: 42 });
			return new Promise(() => undefined);
		};
		window.electronAPI.dismissUpdateToast = async () => {
			document.documentElement.dataset.dismissedDuringDownload = "true";
			listener(null);
			return { success: true };
		};
	});
	await page.goto("/?windowType=update-toast");
	await page.getByRole("button", { name: "Download update", exact: true }).click();
	await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
	await page.getByRole("button", { name: "Not now", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-dismissed-during-download", "true");
});
