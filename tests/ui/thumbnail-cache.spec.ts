import { expect, test } from "@playwright/test";

test("recording rows reuse their previews on remount and invalidate changed recordings", async ({
	page,
}) => {
	test.setTimeout(60000);
	await page.goto("/tests/ui/thumbnail-cache.html");
	const image = page.getByRole("img", { name: "Preview of Clip" });
	await expect(image).toBeVisible({ timeout: 20000 });
	await expect
		.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
		.toBeGreaterThan(0);
	await expect(page.locator("html")).toHaveAttribute("data-requests", "1");
	await page.getByRole("button", { name: "Toggle row" }).click();
	await expect(image).toHaveCount(0);
	await page.getByRole("button", { name: "Toggle row" }).click();
	await expect(image).toBeVisible();
	await expect(page.getByLabel("Loading preview image")).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-requests", "1");
	await page.getByRole("button", { name: "Change recording" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-requests", "2");
	await expect(image).toBeVisible();
});

test("wallpapers display ready cached thumbnails without waiting for a slow image", async ({
	page,
}) => {
	test.setTimeout(60000);
	await page.goto("/tests/ui/thumbnail-cache.html?wallpapers");
	const ready = page
		.getByRole("button", { name: "Windows 11 Bloom", exact: true })
		.locator("img");
	await expect(ready).toHaveAttribute("src", /^data:image\/jpeg;base64,/, { timeout: 20000 });
	await expect
		.poll(() => ready.evaluate((element: HTMLImageElement) => element.naturalWidth))
		.toBeGreaterThan(0);
	await expect(
		page.getByRole("button", { name: "Golden Gate Day", exact: true }).locator("img"),
	).not.toHaveAttribute("src");
});
