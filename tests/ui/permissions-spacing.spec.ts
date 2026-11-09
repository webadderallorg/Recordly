import { expect } from "@playwright/test";
import { productionTest as test } from "./production";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const colorScheme of ["light", "dark"] as const) {
	for (const side of [600, 760]) {
		test(`permissions give spare height to the demo and keep controls together (${colorScheme}, ${side}px)`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: side, height: side });
			await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
			await installDesktopBridge(page);
			await installDesktopBridgeOverrides(page, () => {
				window.electronAPI.getAppSetting = (key) =>
					key === "recordly.onboarding.v1.seen" ||
					key === "recordly.onboarding.permissionsRequested"
						? true
						: null;
			});
			await page.goto("/?windowType=onboarding");
			const dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
			await expect(dialog.getByText("Allowed", { exact: true })).toHaveCount(2);
			const action = dialog.getByRole("button", { name: "Start recording", exact: true });
			await expect(action).toBeEnabled();
			await expect(action).toBeInViewport({ ratio: 1 });
			await expect(
				dialog.getByRole("heading", { name: "Allow Recordly to record", exact: true }),
			).toBeInViewport({ ratio: 1 });
			const banner = (await dialog.locator("[data-onboarding-artwork]").boundingBox())!;
			// Spare height belongs to the demo, keeping the permission rows near the footer.
			expect(banner.height).toBeGreaterThan(180);
			const primary = (await action.boundingBox())!;
			expect(primary.height).toBe(44);
			for (const status of await dialog.getByRole("status", { name: /: Allowed$/ }).all())
				expect((await status.boundingBox())!.height).toBe(44);
			const list = (await dialog.locator(".onboarding-permission-list").boundingBox())!;
			const actionGap = primary.y - list.y - list.height;
			expect(actionGap).toBeGreaterThanOrEqual(8);
			expect(actionGap).toBeLessThanOrEqual(32);
			expect(side - primary.y - primary.height).toBeGreaterThanOrEqual(8);
			expect(side - primary.y - primary.height).toBeLessThanOrEqual(16);
			expect(
				await dialog
					.locator("[data-onboarding-body]")
					.evaluate((element) => element.scrollHeight - element.clientHeight),
			).toBeLessThanOrEqual(1);
			await dialog.screenshot({
				path: `test-results/permissions-spacing-${colorScheme}-${side}.png`,
				animations: "disabled",
			});
		});
	}
}

test("permissions keep the footer reachable when the banner must shrink", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 540 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.onboarding.v1.seen" ||
			key === "recordly.onboarding.permissionsRequested";
		window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
			success: true,
			status: "denied",
		});
		window.electronAPI.getAccessibilityPermissionStatus = async () => ({
			success: true,
			trusted: false,
		});
	});
	await page.goto("/?windowType=onboarding");
	const dialog = page.getByRole("dialog", { name: "Permissions", exact: true });
	await expect(
		dialog.getByRole("button", { name: "Start recording", exact: true }),
	).toBeInViewport({ ratio: 1 });
	for (const name of ["Allow Screen Recording", "Allow Accessibility"]) {
		const action = dialog.getByRole("button", { name, exact: true });
		await action.scrollIntoViewIfNeeded();
		// Scroll positions can round a fraction of a CSS pixel at the clipped edge.
		await expect(action).toBeInViewport({ ratio: 0.99 });
	}
	await dialog.screenshot({ path: "test-results/permissions-spacing-narrow.png" });
});
