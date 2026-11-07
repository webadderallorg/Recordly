import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("editor sections open at the top after scrolling another section", async ({ page }) => {
	await page.setViewportSize({ width: 1200, height: 720 });
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const scroller = page.locator(".settings-panel > .custom-scrollbar").filter({ visible: true });
	// The center hits the wallpaper gallery, which intentionally contains its own wheel scrolling.
	await scroller.hover({ position: { x: 8, y: 80 } });
	await page.mouse.wheel(0, 450);
	await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(50);
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
	await expect(page.getByText("Cursor Size", { exact: true })).toBeInViewport();
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
	await expect(page.getByRole("button", { name: "Add wallpaper", exact: true })).toBeInViewport();
	// The center hits the wallpaper gallery, which intentionally contains its own wheel scrolling.
	await scroller.hover({ position: { x: 8, y: 80 } });
	await page.mouse.wheel(0, 10000);
	await expect(page.getByText("Remove background", { exact: true })).toBeInViewport();
	await page.screenshot({ path: test.info().outputPath("editor-scrolled.png") });
});

for (const width of [1200, 420]) {
	test(`settings content scrolls independently and resets on category change at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 720 });
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await expect(settings).not.toHaveAttribute("data-entering");
		const panel = settings.getByRole("tabpanel");
		const heading = settings.getByRole("heading", { name: "Settings", exact: true });
		const navigation = settings.getByRole("tablist");
		const headingBounds = await heading.boundingBox();
		const navigationBounds = await navigation.boundingBox();
		await panel.hover();
		await page.mouse.wheel(0, 10000);
		await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(50);
		await expect(settings.getByText("Experimental updates", { exact: true })).toBeInViewport();
		expect(await heading.boundingBox()).toEqual(headingBounds);
		expect(await navigation.boundingBox()).toEqual(navigationBounds);
		await settings.screenshot({ path: test.info().outputPath("general-scrolled.png") });
		await settings.getByRole("tab", { name: "Shortcuts", exact: true }).click();
		await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(0);
		await panel.hover();
		await page.mouse.wheel(0, 10000);
		await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
		await settings.getByRole("tab", { name: "General", exact: true }).click();
		await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(0);
		await expect(
			settings.getByRole("radiogroup", { name: "Appearance", exact: true }),
		).toBeInViewport();
	});
}
