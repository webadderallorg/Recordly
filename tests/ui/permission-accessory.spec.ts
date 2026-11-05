import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const colorScheme of ["light", "dark"] as const) {
	for (const permission of ["screen", "accessibility"] as const) {
		test(`permission accessory uses Recordly components and the ${permission} label (${colorScheme})`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 368, height: 264 });
			await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
			await installDesktopBridge(page);
			await installDesktopBridgeOverrides(page, () => {
				window.electronAPI.startPermissionAccessoryDrag = async () => {
					document.documentElement.dataset.nativeDrag = "requested";
					return { success: true };
				};
				window.electronAPI.closePermissionAccessory = async () => {
					document.documentElement.dataset.accessoryClosed = "true";
					return { success: true };
				};
			});
			await page.goto(`/?windowType=permission-accessory&permission=${permission}`);
			const name = permission === "screen" ? "Screen Recording" : "Accessibility";
			await expect(
				page.getByRole("heading", { name: "Drag to System Settings", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: `Drag Recordly ${name} to System Settings`, exact: true }),
			).toBeVisible();
			await expect(page.getByText("Electron", { exact: true })).toHaveCount(0);
			await expect(page.getByAltText("Recordly")).toBeVisible();
			expect(
				await page
					.locator(".card")
					.evaluate((element) => element.scrollHeight - element.clientHeight),
			).toBeLessThanOrEqual(1);
			await page.locator("[data-permission-drag]").dispatchEvent("dragstart");
			await expect(page.locator("html")).toHaveAttribute("data-native-drag", "requested");
			await page.screenshot({ path: test.info().outputPath("accessory.png") });
			await page.getByRole("button", { name: "Back", exact: true }).click();
			await expect(page.locator("html")).toHaveAttribute("data-accessory-closed", "true");
		});
	}
}

test("sign-in restores the divider between social providers and email", async ({ page }) => {
	await page.setViewportSize({ width: 760, height: 760 });
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.goto("/?windowType=onboarding&onboardingPreview=1");
	const divider = page.locator("[data-signin-divider]");
	await expect(divider).toBeVisible();
	await expect(divider).toHaveText("or");
	await expect(divider.getByRole("separator")).toHaveCount(2);
});
