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
	await expect(apply).toBeVisible({ timeout: 20000 });
});

test("dismissing the inline auto-zoom prompt restores manual hover placement", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	await expect(apply).toBeVisible({ timeout: 20000 });
	const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
	const applyBounds = (await apply.boundingBox())!;
	const dismissBounds = (await dismiss.boundingBox())!;
	// The minus stays inside the one Apply button silhouette, without an outer pill.
	expect(dismissBounds.x).toBeGreaterThanOrEqual(applyBounds.x);
	expect(dismissBounds.x + dismissBounds.width).toBeLessThanOrEqual(
		applyBounds.x + applyBounds.width + 1,
	);
	expect(
		Math.abs(
			applyBounds.y + applyBounds.height / 2 - dismissBounds.y - dismissBounds.height / 2,
		),
	).toBeLessThan(1);
	const row = page.locator('[data-timeline-row="row-zoom"]');
	const bounds = (await row.boundingBox())!;
	const x = bounds.x + bounds.width * 0.25;
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await expect(row.getByTestId("timeline-add-preview")).toHaveCount(0);
	await dismiss.click();
	await expect(apply).toHaveCount(0);
	await page.mouse.move(x, y);
	await expect(row.getByTestId("timeline-add-preview")).toBeVisible();
	await page.mouse.click(x, y);
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(1);
	await zoom.click();
	await page.keyboard.press("Backspace");
	await expect(zoom).toHaveCount(0);
	await expect(apply).toHaveCount(0);
	await page.mouse.move(x + 20, y);
	await expect(row.getByTestId("timeline-add-preview")).toBeVisible();
});

test("removing the last zoom shows the apply prompt unless explicitly dismissed", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const apply = page.getByRole("button", { name: "Apply auto zooms", exact: true });
	await expect(apply).toBeVisible({ timeout: 20000 });
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(1);
	await expect(apply).toHaveCount(0);
	await zoom.click();
	await page.keyboard.press("Backspace");
	await expect(zoom).toHaveCount(0);
	await expect(apply).toBeVisible({ timeout: 20000 });
});
