import { test, expect } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
for (const width of [1440, 760, 420, 320]) {
	test(`Appearance controls remain compact and accessible at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Appearance", exact: true })
			.click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await expect(settings).not.toHaveAttribute("data-entering");
		for (const theme of ["Light", "Dark"]) {
			await settings.getByText(theme, { exact: true }).click();
			const picker = settings.getByRole("radiogroup", { name: "Appearance", exact: true });
			await expect(picker.getByRole("radio")).toHaveCount(3);
			await expect(picker.getByRole("radio", { name: theme, exact: true })).toBeChecked();
			await expect(picker.locator(".theme-preview")).toHaveCount(0);
			const dimensions = await picker.boundingBox();
			expect(dimensions!.height).toBeLessThanOrEqual(40);
			const panel = settings.getByRole("tabpanel");
			expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
			await settings
				.locator(".theme-appearance-picker")
				.screenshot({
					path: `test-results/appearance-proportions-${width}-${theme}.png`,
					animations: "disabled",
				});
		}
	});
}
