import { expect, test } from "@playwright/test";
import { productionTest } from "./production";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const width of [390, 760]) {
	test(`dev permission preview opens real settings without simulating grants (${width}px)`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 760 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
				success: true,
				status: "denied",
			});
			window.electronAPI.getAccessibilityPermissionStatus = async () => ({
				success: true,
				trusted: false,
				prompted: false,
			});
			window.electronAPI.openScreenRecordingPreferences = async (preview) => {
				document.documentElement.dataset.screenOpened = String(preview);
				return { success: true };
			};
			window.electronAPI.openAccessibilityPreferences = async (preview) => {
				document.documentElement.dataset.accessibilityOpened = String(preview);
				return { success: true };
			};
		});
		await page.goto("/?windowType=onboarding&onboardingPreview=1");
		const onboarding = page.getByRole("dialog", { name: "Welcome to Recordly" });
		const next = onboarding.getByRole("button", { name: "Continue", exact: true });
		await expect(next).toBeVisible({ timeout: 30000 });
		const before = (await next.boundingBox())!;
		await next.click();
		const start = onboarding.getByRole("button", { name: "Start recording", exact: true });
		await expect(start).toBeDisabled();
		const after = (await start.boundingBox())!;
		expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
		expect(Math.abs(after.x + after.width - before.x - before.width)).toBeLessThanOrEqual(1);
		const controls = onboarding.locator("[data-permission-preview-controls]");
		await expect(controls.getByRole("button")).toHaveCount(1);
		await controls.getByRole("button", { name: "Simulate permissions", exact: true }).click();
		await onboarding.getByRole("button", { name: "Allow Screen Recording", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-screen-opened", "true");
		await onboarding.getByRole("button", { name: "Allow Accessibility", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-accessibility-opened", "true");
		await expect(start).toBeDisabled();
		await expect(page.getByRole("dialog")).toHaveCount(1);
		await expect(page.getByText("Drop Recordly here to add it.")).toHaveCount(0);
		await expect(onboarding.getByRole("status", { name: /Allowed/ })).toHaveCount(0);
		await onboarding.screenshot({
			path: test.info().outputPath(`native-permission-preview-${width}.png`),
		});
	});
}

test("dev simulation resets granted rows and uses their normal Allow buttons", async ({
	page,
}) => {
	await page.setViewportSize({ width: 760, height: 760 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.openScreenRecordingPreferences = async (preview) => {
			document.documentElement.dataset.screenOpened = String(preview);
			return { success: true };
		};
		window.electronAPI.openAccessibilityPreferences = async (preview) => {
			document.documentElement.dataset.accessibilityOpened = String(preview);
			return { success: true };
		};
	});
	await page.goto("/?windowType=onboarding&onboardingPreview=1");
	const onboarding = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await onboarding.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(
		onboarding.getByRole("status", { name: "Screen Recording: Allowed" }),
	).toBeVisible();
	const start = onboarding.getByRole("button", { name: "Start recording", exact: true });
	await expect(start).toBeEnabled();
	const controls = onboarding.locator("[data-permission-preview-controls]");
	await expect(controls.getByRole("button")).toHaveCount(1);
	const simulate = controls.getByRole("button", { name: "Simulate permissions", exact: true });
	await simulate.click();
	await expect(onboarding.getByRole("status", { name: /Allowed/ })).toHaveCount(0);
	await expect(start).toBeDisabled();
	// Automatic status refresh must not undo the reset before the user clicks a row.
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await page.waitForTimeout(3100);
	await expect(onboarding.getByRole("button", { name: "Allow Screen Recording", exact: true })).toBeVisible();
	await expect(onboarding.getByRole("button", { name: "Allow Accessibility", exact: true })).toBeVisible();
	await onboarding.getByRole("button", { name: "Allow Screen Recording", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-screen-opened", "true");
	await expect(onboarding.getByRole("status", { name: "Screen Recording: Allowed", exact: true })).toBeVisible();
	await expect(start).toBeDisabled();
	await onboarding.getByRole("button", { name: "Allow Accessibility", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-accessibility-opened", "true");
	await expect(start).toBeEnabled();
	await simulate.click();
	await expect(onboarding.getByRole("status", { name: /Allowed/ })).toHaveCount(0);
	await expect(start).toBeDisabled();
	await onboarding.screenshot({ path: test.info().outputPath("simulate-permissions-reset.png") });
});

productionTest("confetti falls over the full window from above", async ({ page }) => {
	await page.setViewportSize({ width: 760, height: 760 });
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.onboarding.permissionsRequested" ? true : null;
	});
	await page.goto("/?windowType=onboarding");
	const rain = page.locator("[data-permissions-confetti]");
	await expect(rain).toBeVisible({ timeout: 30000 });
	await expect(rain.locator("canvas")).toHaveJSProperty("width", 760);
	const bounds = (await rain.boundingBox())!;
	expect(bounds).toEqual({ x: 0, y: 0, width: 760, height: 760 });
	expect(
		await rain.evaluate((element) => {
			const backdrop = document.querySelector(".modal__backdrop")!;
			return (
				Number(getComputedStyle(element).zIndex) > Number(getComputedStyle(backdrop).zIndex)
			);
		}),
	).toBe(true);
	// Let the first pieces enter the frame for visual review of their direction.
	await page.waitForTimeout(500);
	await page.screenshot({ path: test.info().outputPath("confetti-rain.png") });
	await expect(rain).toHaveCount(0, { timeout: 6000 });
});
