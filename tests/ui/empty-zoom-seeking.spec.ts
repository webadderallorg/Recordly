import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("empty zoom row seeks and scrubs without adding zooms", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	await expect(apply).toBeVisible({ timeout: 20000 });
	const row = page.locator('[data-timeline-row="row-zoom"]');
	const bounds = (await row.boundingBox())!;
	const playhead = page.getByTestId("timeline-playhead").locator(":scope > div");
	const firstX = bounds.x + bounds.width * 0.2;
	const lastX = bounds.x + bounds.width * 0.8;
	const y = bounds.y + bounds.height / 2;
	const expectPlayheadAt = async (x: number) => {
		await expect
			.poll(async () => Math.abs((await playhead.boundingBox())!.x - x))
			.toBeLessThan(2);
	};

	await page.mouse.click(firstX, y);
	await expectPlayheadAt(firstX);
	await expect(row.getByTestId("timeline-add-preview")).toHaveCount(0);
	await page.mouse.down();
	await page.mouse.move(lastX, y, { steps: 3 });
	await expectPlayheadAt(lastX);
	// A scrub keeps tracking after leaving the row and ends on mouseup.
	await page.mouse.move(firstX, bounds.y - 10, { steps: 3 });
	await page.mouse.up();
	await expectPlayheadAt(firstX);
	await page.mouse.move(lastX, y);
	await expectPlayheadAt(firstX);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);

	// The button handles its own click without moving the playhead.
	await apply.click();
	await expect(page.getByText("No cursor telemetry available", { exact: true })).toBeVisible();
	await expectPlayheadAt(firstX);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await expect(apply).toBeVisible();
});
