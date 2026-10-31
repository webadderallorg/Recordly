import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("countdown can be cancelled from its HeroUI button", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=countdown");
	await expect(page.getByText("3", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-countdown-cancelled", "true");
});

test("update window fits the desktop toast and can be dismissed", async ({ page }) => {
	await page.setViewportSize({ width: 480, height: 220 });
	await installDesktopBridge(page);
	await page.goto("/?windowType=update-toast");
	await expect(
		page.getByRole("heading", { name: "Update available", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Update now", exact: true })).toBeInViewport();
	await page.screenshot({ path: "test-results/update-light.png", animations: "disabled" });
	await page.getByRole("button", { name: "Not now", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-update-dismissed", "true");
});

test("editor inspector and playback controls fit a smaller desktop", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("slider", { name: "Blur", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Export", exact: true })).toBeInViewport();
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeInViewport();
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("row", { name: "Motion", exact: true }).click();
	await expect(
		page.getByRole("radiogroup", { name: "Motion Presets", exact: true }),
	).toBeVisible();
	await page.getByText("Smooth", { exact: true }).click();
	await expect(page.getByRole("radio", { name: "Smooth", exact: true })).toBeChecked();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
		.toBe(true);
	await page.screenshot({ path: "test-results/editor-compact.png", animations: "disabled" });
});
