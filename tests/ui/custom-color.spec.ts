import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("background colors use a tile grid and save colors through the plus tile", async ({
	page,
}, testInfo) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-background-panel="image"]')).toBeVisible({ timeout: 30000 });
	const imageSelections = await page
		.locator('[data-background-panel="image"] button[aria-pressed]')
		.count();
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	const grid = page.locator('[aria-label="Background colors"]');
	await expect(grid).toHaveCSS("display", "grid");
	await expect(grid.getByRole("button").first()).toHaveAccessibleName("Add custom color");
	await expect(page.getByRole("row", { name: "Color", exact: true })).toHaveCount(0);
	await expect(page.getByRole("row", { name: "Gradient", exact: true })).toHaveCount(0);
	await expect(grid.locator("button[aria-pressed]")).toHaveCount(imageSelections);
	await expect(grid.getByRole("button")).toHaveCount(25);
	await page.screenshot({ path: testInfo.outputPath("colors-palette.png") });
	const solid = grid.getByRole("button", { name: "Background color #FFFFFF", exact: true });
	const gradient = grid.getByRole("button", { name: "Gradient 1", exact: true });
	await solid.click();
	await expect(solid).toHaveAttribute("aria-pressed", "true");
	await gradient.click();
	await expect(gradient).toHaveAttribute("aria-pressed", "true");
	await expect(solid).toHaveAttribute("aria-pressed", "false");
	await expect(grid.locator('button[aria-pressed="true"]')).toHaveCount(1);
	await grid.getByRole("button", { name: "Add custom color" }).click();
	const dialog = page.getByRole("dialog", { name: "Custom color", exact: true });
	const hex = page.getByRole("textbox", { name: "Hex color", exact: true });
	await hex.fill("#123456");
	await hex.press("Tab");
	await page.screenshot({ path: testInfo.outputPath("add-color-picker.png") });
	await dialog.getByRole("button", { name: "Add", exact: true }).click();
	await expect(
		grid.getByRole("button", { name: "Background color #123456", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await page.screenshot({ path: testInfo.outputPath("color-grid.png") });
	await page.reload();
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	await expect(
		grid.getByRole("button", { name: "Background color #123456", exact: true }),
	).toBeVisible();
	await grid.getByRole("button", { name: "Add custom color" }).click();
	await dialog.getByRole("button", { name: "Close color picker" }).click();
	await expect(dialog).toBeHidden();
	const swatch = grid.getByRole("button", { name: "Background color #123456", exact: true });
	await swatch.hover();
	await grid.getByRole("button", { name: "Remove custom color #123456", exact: true }).click();
	await expect(swatch).toHaveCount(0);
	await page.reload();
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	await expect(swatch).toHaveCount(0);
});
