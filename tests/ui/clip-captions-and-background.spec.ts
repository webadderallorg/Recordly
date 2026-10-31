import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("split clips share one grip and captions live inside the filmstrip", async ({ page }) => {
	test.setTimeout(120000);
	page.setDefaultTimeout(10000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(1, { timeout: 20000 });
	await expect(clips.first()).toHaveAttribute("data-end-ms", "6000");
	const scroll = page.getByTestId("timeline-scroll");
	const clipRow = page.locator('[data-timeline-row="row-clip"]');
	const rowBox = (await clipRow.boundingBox())!;
	await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y - 8);
	await expect
		.poll(() => page.getByTestId("playhead-cap").getAttribute("aria-label"))
		.toBe("Playhead 3.0s");
	await page.getByRole("button", { name: "Split Clip (C)", exact: true }).click();
	await expect(clips).toHaveCount(2);
	const first = clips.nth(0),
		second = clips.nth(1);
	const left = (await first.locator(".timeline-block").boundingBox())!;
	const right = (await second.locator(".timeline-block").boundingBox())!;
	expect(right.x - left.x - left.width).toBeCloseTo(24, 0);
	const seamGrip = page.getByTestId("clip-seam-grip");
	await expect(seamGrip).toHaveCount(1);
	await expect(first.getByTitle("Resize right")).toBeHidden();
	await expect(second.getByTitle("Resize left")).toBeHidden();
	const grip = (await seamGrip.boundingBox())!;
	expect(grip.x + grip.width / 2).toBeCloseTo((left.x + left.width + right.x) / 2, 0);
	await scroll.focus();
	await expect(scroll).toHaveCSS("outline-style", "none");
	await expect(scroll).toHaveCSS("box-shadow", "none");
	// Seeking anywhere in the decorative split gutter lands on the cut and
	// draws the playhead at the next clip, never over its shared grip.
	await page.mouse.click(left.x + left.width + 3, rowBox.y - 8);
	await expect(page.getByTestId("playhead-cap")).toHaveAttribute("aria-label", "Playhead 3.0s");
	await expect
		.poll(
			async () =>
				(await page.getByTestId("timeline-playhead").locator(":scope > div").boundingBox())!
					.x,
		)
		.toBeCloseTo(right.x, 0);
	await second.click({ position: { x: 2, y: 20 } });
	const savedStart = Number(await second.getAttribute("data-start-ms"));
	expect(Number(await first.getAttribute("data-start-ms"))).toBe(0);
	expect(Number(await first.getAttribute("data-end-ms"))).toBe(savedStart);
	expect(Number(await second.getAttribute("data-end-ms"))).toBe(6000);

	// A real trim starts from the visible edge, with no gutter-size jump in timing.
	const before = (await second.boundingBox())!;
	await page.mouse.move(before.x + 2, before.y + 20);
	await page.mouse.down();
	await page.mouse.move(before.x + 32, before.y + 20, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(async () => 6000 - Number(await second.getAttribute("data-end-ms")))
		.toBeCloseTo((30 / rowBox.width) * 6000, -1);

	await expect(second).toHaveAttribute("data-start-ms", String(savedStart));
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	const showCaptions = page.getByRole("switch", { name: "Show", exact: true });
	await page
		.locator('[data-slot="switch"]')
		.filter({ has: showCaptions })
		.locator('[data-slot="switch-control"]')
		.click({ timeout: 10000 });
	await expect(showCaptions).toBeChecked();
	const strip = page.locator("[data-caption-add-target]").first();
	await strip.click({ position: { x: 100, y: 8 } });
	const caption = page.locator('[data-variant="caption"]');
	await expect(caption).toHaveCount(1);
	const text = page.getByRole("textbox", { name: "Text", exact: true });
	await text.fill("And this is what the caption looks like inside a clip");
	await text.press("Enter");
	await expect(caption).toContainText("And this is what");
	expect((await caption.textContent())!.length).toBeLessThan(35);
	const captionBox = (await caption.boundingBox())!;
	const clipBox = (await first.locator(".timeline-block").boundingBox())!;
	expect(captionBox.y).toBeGreaterThan(clipBox.y);
	expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(clipBox.y + clipBox.height);
	expect((await page.locator('[data-timeline-row="row-zoom"]').boundingBox())!.height).toBe(64);
	expect(await scroll.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
	const captionStart = Number(await caption.getAttribute("data-start-ms"));
	const captionDuration = Number(await caption.getAttribute("data-end-ms")) - captionStart;
	await page.mouse.move(
		captionBox.x + captionBox.width / 2,
		captionBox.y + captionBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		captionBox.x + captionBox.width / 2 + 24,
		captionBox.y + captionBox.height / 2,
		{ steps: 8 },
	);
	await page.mouse.up();
	await expect
		.poll(async () => Number(await caption.getAttribute("data-start-ms")) - captionStart)
		.toBeCloseTo((24 / rowBox.width) * 6000, -1);
	expect(
		Number(await caption.getAttribute("data-end-ms")) -
			Number(await caption.getAttribute("data-start-ms")),
	).toBeCloseTo(captionDuration, 0);
	await page.screenshot({ path: "test-results/embedded-captions.png", animations: "disabled" });
});

test("background swaps use the section fade without sliding or overlapping panels", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-background-panel="image"]')).toBeVisible({ timeout: 20000 });
	for (const name of ["Color", "Gradient", "Video", "Image"]) {
		await page.getByRole("row", { name, exact: true }).click();
		const panel = page.locator("[data-background-panel]");
		await expect(panel).toHaveCount(1);
		await expect(panel).toHaveAttribute("data-background-panel", name.toLowerCase());
		await expect(panel).toHaveCSS("transform", "none");
		await expect(panel).toHaveCSS("animation-name", "editor-section-enter");
	}
});
