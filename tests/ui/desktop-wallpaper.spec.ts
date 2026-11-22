import { expect, test } from "@playwright/test";

test("desktop image is the first choice after add, selected by default, with the updated catalog", async ({
	page,
}) => {
	await page.goto("/tests/ui/desktop-wallpaper.html");
	const tiles = page
		.locator('[data-background-panel="image"]')
		.locator(".wallpaper-tile, .wallpaper-upload-tile");
	await expect(tiles.nth(1)).toHaveAttribute("aria-label", "Desktop wallpaper");
	await expect(tiles.nth(1)).toBeDisabled();
	await page.getByRole("button", { name: "Make desktop available", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Desktop wallpaper", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(tiles.nth(0)).toHaveAttribute("aria-label", "Add wallpaper");
	await expect(tiles.nth(1)).toHaveAttribute("aria-label", "Desktop wallpaper");
	await expect(tiles.nth(1)).toBeEnabled();
	await expect(tiles.nth(1)).toHaveText("");
	await expect(tiles.nth(2)).toHaveAttribute("aria-label", "Custom wallpaper 1");
	await expect(
		page.getByRole("button", { name: "macOS Hello Black", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Midnight 8", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Iridescent 9", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "macOS Hello Black", exact: true }).click();
	await expect(page.getByTestId("selected-wallpaper")).toHaveText(
		"/wallpapers/macos-hello-black.jpg",
	);
});

test("desktop image stays visible and selectable without a tag while its thumbnail is pending", async ({
	page,
}) => {
	await page.goto("/tests/ui/desktop-wallpaper.html?pending-thumbnail");
	await page.getByRole("button", { name: "Make desktop available", exact: true }).click();
	const desktop = page.getByRole("button", { name: "Desktop wallpaper", exact: true });
	await expect(desktop).toBeEnabled();
	await expect(desktop).toHaveText("");
	await expect
		.poll(() =>
			desktop
				.locator("img")
				.evaluateAll((images) =>
					images.some((image) => (image as HTMLImageElement).naturalWidth > 0),
				),
		)
		.toBe(true);
	const selected = await page.getByTestId("selected-wallpaper").innerText();
	await page.getByRole("button", { name: "macOS Hello Black", exact: true }).click();
	await desktop.click();
	await expect(page.getByTestId("selected-wallpaper")).toHaveText(selected);
	await expect(desktop).toHaveAttribute("aria-pressed", "true");
});

for (const [mode, expected] of [
	["restore", "/wallpapers/tahoe-light.jpg"],
	["explicit", "#112233"],
]) {
	test(`late desktop lookup preserves ${mode} selection`, async ({ page }) => {
		await page.goto(`/tests/ui/desktop-wallpaper.html?${mode}`);
		await page.getByRole("button", { name: "Make desktop available", exact: true }).click();
		await expect(page.getByTestId("selected-wallpaper")).toHaveText(expected);
	});
}

test("manual selection wins over the pending desktop response", async ({ page }) => {
	await page.goto("/tests/ui/desktop-wallpaper.html");
	await page
		.getByRole("button", { name: "Choose a color before desktop loads", exact: true })
		.click();
	await page.getByRole("button", { name: "Make desktop available", exact: true }).click();
	await expect(page.getByTestId("selected-wallpaper")).toHaveText("#abcdef");
});

test("unavailable desktop keeps a working fallback", async ({ page }) => {
	await page.goto("/tests/ui/desktop-wallpaper.html");
	await page.getByRole("button", { name: "Desktop unavailable", exact: true }).click();
	await expect(page.getByTestId("selected-wallpaper")).toHaveText("/wallpapers/tahoe-light.jpg");
	await expect(
		page.getByRole("button", { name: "Desktop wallpaper", exact: true }),
	).toHaveAttribute("aria-label", "Desktop wallpaper");
	await expect(
		page.getByRole("button", { name: "Desktop wallpaper", exact: true }),
	).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "macOS Hello Black", exact: true }),
	).toBeVisible();
});

test("desktop tile recovers from a transient lookup failure without reopening the editor", async ({
	page,
}) => {
	await page.goto("/tests/ui/desktop-wallpaper.html?retry-desktop");
	const desktop = page.getByRole("button", { name: "Desktop wallpaper", exact: true });
	await expect(desktop).toBeDisabled();
	await page.getByRole("button", { name: "Make desktop available", exact: true }).click();
	await expect(desktop).toBeEnabled({ timeout: 10000 });
	await expect
		.poll(() =>
			desktop
				.locator("img")
				.evaluateAll((images) =>
					images.some((image) => (image as HTMLImageElement).naturalWidth > 0),
				),
		)
		.toBe(true);
	await desktop.click();
	await expect(desktop).toHaveAttribute("aria-pressed", "true");
});
