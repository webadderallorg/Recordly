import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.setTimeout(90000);

test("update available is a red header button to the right of the account in editor and Home", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const editor = page.locator(".editor-header");
	await expect(editor).toBeVisible({ timeout: 60000 });
	async function checkPlacement(header: typeof editor) {
		const account = await header
			.getByRole("button", { name: "Recordly account", exact: true })
			.boundingBox();
		const button = header.getByRole("button", { name: "Update available", exact: true });
		await expect(button).toBeVisible();
		await expect(button).toHaveClass(/button--danger/);
		const bounds = await button.boundingBox();
		const frame = await header.boundingBox();
		expect(bounds!.x).toBeGreaterThanOrEqual(account!.x + account!.width);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
		expect(frame!.height).toBe(56);
	}
	await checkPlacement(editor);
	await expect(page.locator(".app-update-banner")).toHaveCount(0);
	await page.screenshot({
		path: "output/update-flow/editor-update-available.png",
		animations: "disabled",
	});
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home).toBeVisible();
	await expect(home).not.toHaveAttribute("data-entering");
	await checkPlacement(home.locator(".app-frame-header"));
	await home
		.getByRole("button", { name: "Update available", exact: true })
		.screenshot({ path: "output/update-flow/home-update-button.png", animations: "disabled" });
	await page.screenshot({
		path: "output/update-flow/home-update-available.png",
		animations: "disabled",
	});
	await home.getByRole("button", { name: "Update available", exact: true }).click();
	const details = page.getByRole("dialog", { name: "App update", exact: true });
	await expect(details).toContainText("Recordly 1.4.1 is available.");
	await expect(
		details.getByRole("button", { name: "Download update", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(details).not.toBeVisible();
	await expect(home).toBeVisible();
});

test("update details retain background progress, an explicit restart and a blocked restart error", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let payload: Awaited<ReturnType<Window["electronAPI"]["getCurrentUpdateToastPayload"]>> = {
			version: "2.0.0",
			phase: "downloading",
			progressPercent: 42,
			detail: "Downloading",
			delayMs: 60000,
		};
		window.electronAPI.getCurrentUpdateToastPayload = async () => payload;
		window.electronAPI.onUpdateToastStateChanged = (callback) => {
			const listener = (event: Event) => {
				payload = (event as CustomEvent).detail;
				callback(payload);
			};
			window.addEventListener("test-app-update", listener);
			return () => window.removeEventListener("test-app-update", listener);
		};
		window.electronAPI.installDownloadedUpdate = async () => {
			document.documentElement.dataset.restartRequested = "true";
			return {
				success: false,
				code: "restart-blocked",
				message: "Save your project before restarting to update.",
			};
		};
		window.electronAPI.dismissUpdateToast = async () => {
			window.dispatchEvent(new CustomEvent("test-app-update", { detail: null }));
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Downloading · 42%", exact: true }).click();
	const details = page.getByRole("dialog", { name: "App update", exact: true });
	await expect(details.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
	await expect(details).toContainText("in the background");
	await expect(details.getByRole("button", { name: "Restart to update" })).toHaveCount(0);
	await page.evaluate(() =>
		window.dispatchEvent(
			new CustomEvent("test-app-update", {
				detail: { version: "2.0.0", phase: "ready", detail: "Ready", delayMs: 60000 },
			}),
		),
	);
	await expect(details).toContainText("Recordly 2.0.0 is ready");
	await expect(page.locator("html")).not.toHaveAttribute("data-restart-requested");
	await details.getByRole("button", { name: "Restart to update", exact: true }).click();
	await expect(details.getByRole("alert")).toContainText("Save your project");
	await details.getByRole("button", { name: "Later", exact: true }).click();
	await expect(details).not.toBeVisible();
	await expect(page.locator(".app-update-button")).toHaveCount(0);
});

test("no update button is shown when there is no available update", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentUpdateToastPayload = async () => null;
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator(".editor-header")).toBeVisible();
	await expect(page.locator(".app-update-button")).toHaveCount(0);
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "Projects dashboard", exact: true }),
	).toBeVisible();
	await expect(page.locator(".app-update-button")).toHaveCount(0);
});
