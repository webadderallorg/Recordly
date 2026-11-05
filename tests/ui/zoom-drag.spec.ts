import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("zoom follows the pointer forward and backward without accumulating preview offsets", async ({
	page,
}) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clip = page.locator('[data-variant="clip"]');
	await expect(clip).toHaveAttribute("data-end-ms", "6000", { timeout: 30000 });
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(1);
	const row = (await page.locator('[data-timeline-row="row-zoom"]').boundingBox())!;
	const original = (await zoom.boundingBox())!;
	const start = Number(await zoom.getAttribute("data-start-ms"));
	const duration = Number(await zoom.getAttribute("data-stored-end-ms")) - start;
	const x = original.x + original.width / 2;
	const y = original.y + original.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	for (const offset of [60, 120, 240, 180, 90]) {
		await page.mouse.move(x + offset, y, { steps: 12 });
		await expect
			.poll(async () => (await zoom.boundingBox())!.x)
			.toBeCloseTo(original.x + offset, 0);
	}
	await page.mouse.up();
	const expectedStart = Math.round(start + (90 / row.width) * 6000);
	await expect(zoom).toHaveAttribute("data-start-ms", String(expectedStart));
	expect(Number(await zoom.getAttribute("data-stored-end-ms")) - expectedStart).toBe(duration);
	await page.keyboard.press("Meta+z");
	await expect(zoom).toHaveAttribute("data-start-ms", String(start));
	// Cancelling and picking up again must reset the origin without saving an edit.
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 60, y, { steps: 12 });
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(zoom).toHaveAttribute("data-start-ms", String(start));
	await expect.poll(async () => (await zoom.boundingBox())!.x).toBeCloseTo(original.x, 0);
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 120, y + 15, { steps: 12 });
	await expect.poll(async () => (await zoom.boundingBox())!.x).toBeCloseTo(original.x + 120, 0);
	await expect.poll(async () => (await zoom.boundingBox())!.y).toBeCloseTo(original.y + 15, 0);
	await page.mouse.up();
	const repeatedStart = Math.round(start + (120 / row.width) * 6000);
	await expect(zoom).toHaveAttribute("data-start-ms", String(repeatedStart));
	expect(Number(await zoom.getAttribute("data-stored-end-ms")) - repeatedStart).toBe(duration);
});

test("dragging a zoom snaps across a split clip gutter without changing duration", async ({
	page,
}) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveAttribute("data-end-ms", "6000", { timeout: 30000 });
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(1);
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(row.x + row.width / 2, row.y - 8);
	await page.getByRole("button", { name: /^Split Clip \(/ }).click();
	await expect(clips).toHaveCount(2);
	const first = (await clips.first().boundingBox())!;
	const original = (await zoom.boundingBox())!;
	const start = Number(await zoom.getAttribute("data-start-ms"));
	const end = Number(await zoom.getAttribute("data-end-ms"));
	const duration = Number(await zoom.getAttribute("data-stored-end-ms")) - start;
	const delta = first.width * ((3000 - (end - start) - start) / 3000) - 4;
	await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		original.x + original.width / 2 + delta,
		original.y + original.height / 2,
		{ steps: 16 },
	);
	await page.mouse.up();
	await expect(zoom).toHaveAttribute("data-end-ms", "3000");
	const placedStart = Number(await zoom.getAttribute("data-start-ms"));
	expect(Number(await zoom.getAttribute("data-stored-end-ms")) - placedStart).toBe(duration);
});
