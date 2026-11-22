import { expect, test } from "@playwright/test";

test("settings values follow the thumb while dragging and hide on release", async ({ page }) => {
	await page.goto("/tests/ui/controls.html");
	const slider = page.getByRole("slider", { name: "Padding", exact: true });
	await expect(slider).toBeVisible();
	const control = slider.locator("xpath=ancestor::*[@data-slot='slider']");
	await expect(control.locator("output")).toHaveCount(0);
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	const track = await control.locator("[data-slot='slider-track']").boundingBox();
	expect(track).not.toBeNull();
	// Start via the track, then move between equally wide two-digit values.
	await page.mouse.move(track!.x + track!.width * 0.4, track!.y + track!.height / 2);
	await page.mouse.down();
	const tooltip = page.getByRole("tooltip");
	for (const percent of [0.4, 0.6, 0.8]) {
		await page.mouse.move(track!.x + track!.width * percent, track!.y + track!.height / 2, {
			steps: 5,
		});
		await expect(tooltip).toHaveText(`${Math.round(Number(await slider.inputValue()))}px`);
		await expect(tooltip).not.toHaveAttribute("data-entering");
		await expect
			.poll(async () => {
				const bubble = await tooltip.boundingBox();
				const thumb = await control.locator("[data-slot='slider-thumb']").boundingBox();
				return Math.abs(bubble!.x + bubble!.width / 2 - thumb!.x - thumb!.width / 2);
			})
			.toBeLessThan(2);
		const bubble = await tooltip.boundingBox();
		expect(bubble!.y + bubble!.height).toBeLessThan(track!.y);
	}
	await page.screenshot({ path: test.info().outputPath("slider-drag-tooltip.png") });
	await page.mouse.up();
	await expect(tooltip).toHaveCount(0);

	// Keyboard editing keeps a formatted value available too.
	await slider.focus();
	await page.keyboard.press("ArrowRight");
	await expect(tooltip).toHaveText(`${await slider.inputValue()}px`);
	await page.getByRole("button", { name: "Toggle theme", exact: true }).focus();
	await expect(tooltip).toHaveCount(0);
});

test("dragging follows small pointer movements while retaining setting increments", async ({
	page,
}) => {
	await page.goto("/tests/ui/controls.html");
	const slider = page.getByRole("slider", { name: "Padding", exact: true });
	const thumb = slider.locator("xpath=ancestor::*[@data-slot='slider-thumb']");
	await expect(slider).toHaveValue("20");
	const bounds = await thumb.boundingBox();
	expect(bounds).not.toBeNull();
	const x = bounds!.x + bounds!.width / 2;
	const y = bounds!.y + bounds!.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 1, y);
	await expect.poll(async () => (await thumb.boundingBox())!.x).toBeGreaterThan(bounds!.x + 0.25);
	// The setting and readable tooltip retain whole pixels even between steps.
	await expect(page.getByTestId("state")).toContainText('"value":20,');
	await expect(page.getByRole("tooltip")).toHaveText("20px");
	const finePosition = (await thumb.boundingBox())!.x;
	await page.mouse.move(x + 2, y);
	await expect
		.poll(async () => (await thumb.boundingBox())!.x)
		.toBeGreaterThan(finePosition + 0.25);
	const bubble = await page.getByRole("tooltip").boundingBox();
	const movedThumb = await thumb.boundingBox();
	expect(
		Math.abs(bubble!.x + bubble!.width / 2 - movedThumb!.x - movedThumb!.width / 2),
	).toBeLessThan(2);
	await page.mouse.up();
	await expect(slider).toHaveValue("20");
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await slider.focus();
	await page.keyboard.press("ArrowRight");
	await expect(slider).toHaveValue("21");
	await page.keyboard.press("End");
	await expect(slider).toHaveValue("100");
	await page.keyboard.press("Home");
	await expect(slider).toHaveValue("0");
});
