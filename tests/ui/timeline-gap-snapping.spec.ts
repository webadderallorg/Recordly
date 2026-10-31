import { expect, test, type Page, type Locator } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function prepare(page: Page) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips.first()).toHaveAttribute("data-end-ms", "6000", { timeout: 20000 });
	await expect(clips.first().locator("img").first()).toBeVisible({ timeout: 20000 });
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(row.x + row.width / 2, row.y - 8);
	await expect(page.getByTestId("playhead-cap")).toHaveAttribute("aria-label", "Playhead 3.0s");
	await page.getByRole("button", { name: "Split Clip (C)", exact: true }).click();
	await expect(clips).toHaveCount(2);
	return { clips, row };
}
async function resizeEnd(page: Page, block: Locator, x: number) {
	const box = (await block.boundingBox())!;
	await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(x - 2, box.y + box.height / 2, { steps: 12 });
	await page.mouse.up();
}

test("zoom ends snap to clip cuts, release, and can span the gutter", async ({ page }) => {
	const { clips } = await prepare(page);
	const first = (await clips.first().locator(".timeline-block").boundingBox())!;
	const second = (await clips.nth(1).locator(".timeline-block").boundingBox())!;
	const zoomRow = (await page.locator('[data-timeline-row="row-zoom"]').boundingBox())!;
	await page.mouse.click(first.x + first.width / 3, zoomRow.y + 24);
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(1);
	await resizeEnd(page, zoom, first.x + first.width - 4);
	await expect(zoom).toHaveAttribute("data-end-ms", "3000");
	let box = (await zoom.boundingBox())!;
	expect(box.x + box.width).toBeCloseTo(first.x + first.width, 0);
	await resizeEnd(page, zoom, first.x + first.width - 30);
	await expect
		.poll(async () => Number(await zoom.getAttribute("data-end-ms")))
		.toBeLessThan(2900);
	await resizeEnd(page, zoom, second.x + second.width / 2);
	await expect
		.poll(async () => Number(await zoom.getAttribute("data-end-ms")))
		.toBeGreaterThan(4000);
	box = (await zoom.boundingBox())!;
	const gapX = (first.x + first.width + second.x) / 2;
	const hit = await page.evaluate(
		({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-variant="zoom"]') !== null,
		{ x: gapX, y: box.y + box.height / 2 },
	);
	expect(hit).toBe(true);
	await expect(zoom).toHaveCSS("clip-path", "none");
	await page.screenshot({ path: "test-results/gap-snapping.png" });
});

test("caption lands exactly where its mapped hover preview appears", async ({ page }) => {
	const { clips } = await prepare(page);
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	const show = page.getByRole("switch", { name: "Show", exact: true });
	await page
		.locator('[data-slot="switch"]')
		.filter({ has: show })
		.locator('[data-slot="switch-control"]')
		.click();
	const first = (await clips.first().locator(".timeline-block").boundingBox())!;
	const target = (await page.locator("[data-caption-add-target]").first().boundingBox())!;
	const x = first.x + first.width * 0.8,
		y = target.y + 8;
	await page.mouse.move(x, y);
	const preview = page.getByTestId("timeline-add-preview").locator(":scope > div");
	await expect(preview).toBeVisible();
	const expected = (await preview.boundingBox())!;
	await page.mouse.click(x, y);
	const caption = page.locator('[data-variant="caption"]');
	await expect(caption).toHaveCount(1);
	expect((await caption.boundingBox())!.x).toBeCloseTo(expected.x, 0);
});

test("dragging a zoom soft-snaps its end to the cut without changing duration", async ({
	page,
}) => {
	const { clips } = await prepare(page);
	const first = (await clips.first().locator(".timeline-block").boundingBox())!;
	const row = (await page.locator('[data-timeline-row="row-zoom"]').boundingBox())!;
	await page.mouse.click(first.x + first.width / 3, row.y + 24);
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(1);
	const start = Number(await zoom.getAttribute("data-start-ms"));
	const end = Number(await zoom.getAttribute("data-end-ms"));
	const box = (await zoom.boundingBox())!;
	const delta = first.width * ((3000 - (end - start) - start) / 3000) - 4;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 12 });
	await page.mouse.up();
	await expect(zoom).toHaveAttribute("data-end-ms", "3000");
	await expect(zoom).toHaveAttribute("data-start-ms", String(3000 - (end - start)));
	const placed = (await zoom.boundingBox())!;
	expect(placed.x + placed.width).toBeCloseTo(first.x + first.width, 0);
	await page.keyboard.press("Meta+z");
	await expect(zoom).toHaveAttribute("data-start-ms", String(start));
	await expect(zoom).toHaveAttribute("data-end-ms", String(end));
});
