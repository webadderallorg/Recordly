import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const theme of ["light", "dark"]) {
	test(`Cloud content scrolls without a persistent scrollbar in ${theme} mode`, async ({ page }) => {
		await installDesktopBridge(page);
		await page.addInitScript((theme) => localStorage.setItem("recordly.theme", theme), theme);
		await page.setViewportSize({ width: 1000, height: 700 });
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: /^Upgrade(?:,|$)/ }).first().click();
		const modal = page.getByRole("dialog", { name: "Recordly Cloud", exact: true });
		await expect(modal).toBeVisible();
		const body = modal.locator(".pricing-body");
		await expect(body).toHaveCSS("scrollbar-width", "none");
		await expect(body).toHaveCSS("scrollbar-gutter", "auto");
		expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
		await body.hover();
		await page.mouse.wheel(0, 500);
		await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
		await expect(modal.getByRole("button", { name: "Close", exact: true })).toBeVisible();
		await modal.screenshot({ path: test.info().outputPath(`plus-${theme}.png`) });
		await modal.getByRole("button", { name: "Close", exact: true }).click();
		await expect(modal).toBeHidden();

		// The editor's custom scrollbar utility must follow the same app policy.
		const inspector = page.locator(".custom-scrollbar").filter({ visible: true }).first();
		await expect(inspector).toHaveCSS("scrollbar-width", "none");
		await expect(inspector).toHaveCSS("scrollbar-gutter", "auto");
	});
}
