import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest } from "./production";

productionTest(
	"permission indicators follow grants and revocations without a manual check",
	async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getAppSetting = (key) =>
				key === "recordly.onboarding.permissionsRequested" ||
				key === "recordly.onboarding.v1.seen";
			window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
				success: true,
				status: localStorage.getItem("screen-allowed") === "true" ? "granted" : "denied",
			});
			window.electronAPI.getAccessibilityPermissionStatus = async () => ({
				success: true,
				trusted: localStorage.getItem("accessibility-allowed") === "true",
			});
		});
		await page.goto("/?windowType=onboarding");
		const panel = page.getByRole("dialog", { name: "Permissions", exact: true });
		const start = panel.getByRole("button", { name: "Start recording", exact: true });
		await expect(start).toBeDisabled();
		await expect(
			panel.getByRole("button", { name: "Allow Screen Recording", exact: true }),
		).toBeVisible();
		await expect(panel.getByRole("button", { name: "Check again", exact: true })).toHaveCount(
			0,
		);
		await expect(
			panel.getByText("Permission changes may require restarting Recordly."),
		).toHaveCount(0);
		await page.evaluate(() => {
			localStorage.setItem("screen-allowed", "true");
			localStorage.setItem("accessibility-allowed", "true");
		});
		await expect(panel.getByRole("status", { name: /Allowed/ })).toHaveCount(2);
		await expect(start).toBeEnabled();
		await page.evaluate(() => localStorage.setItem("screen-allowed", "false"));
		await expect(
			panel.getByRole("button", { name: "Allow Screen Recording", exact: true }),
		).toBeVisible();
		await expect(
			panel.getByRole("status", { name: "Accessibility: Allowed", exact: true }),
		).toBeVisible();
		await expect(start).toBeDisabled();
		await page.evaluate(() => localStorage.setItem("accessibility-allowed", "false"));
		await expect(
			panel.getByRole("button", { name: "Allow Accessibility", exact: true }),
		).toBeVisible();
		await expect(panel.getByRole("status", { name: /Allowed/ })).toHaveCount(0);
		await panel.screenshot({ path: test.info().outputPath("permissions-auto-refresh.png") });
	},
);

test("permission polling stops when leaving the panel and resumes on return", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let checks = 0;
		window.electronAPI.getScreenRecordingPermissionStatus = async () => {
			document.documentElement.dataset.permissionChecks = String(++checks);
			return { success: true, status: "denied" };
		};
	});
	await page.clock.install();
	await page.goto("/?windowType=onboarding&onboardingPreview=1");
	const panel = page.getByRole("dialog", { name: "Welcome to Recordly", exact: true });
	await panel.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		panel.getByRole("button", { name: "Allow Screen Recording", exact: true }),
	).toBeVisible();
	const checks = () => page.locator("html").getAttribute("data-permission-checks");
	const first = Number(await checks());
	await page.clock.runFor(3100);
	await expect.poll(async () => Number(await checks())).toBeGreaterThan(first);
	await panel.getByRole("button", { name: "Back to account", exact: true }).click();
	await expect(panel.locator(".onboarding-permissions")).toHaveCount(0);
	const stopped = await checks();
	await page.clock.runFor(3300);
	expect(await checks()).toBe(stopped);
	await panel.getByRole("button", { name: "Continue", exact: true }).click();
	await expect.poll(async () => Number(await checks())).toBeGreaterThan(Number(stopped));
});
