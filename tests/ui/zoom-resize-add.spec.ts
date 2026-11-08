import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const edge of ["start", "end"] as const) {
	test(`shortening the ${edge} edge cannot add a second zoom`, async ({ page }) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto("/tests/ui/zoom-bounds.html");
		const zooms = page.locator('[data-variant="zoom"]');
		await expect(zooms).toHaveCount(1);
		const zoom = zooms.first();
		const box = (await zoom.boundingBox())!;
		const x = edge === "start" ? box.x + 2 : box.x + box.width - 2;
		const y = box.y + box.height / 2;
		const dx = edge === "start" ? 70 : -70;
		const row = (await page.locator('[data-timeline-row="row-zoom"]').boundingBox())!;
		await page.mouse.move(x, y);
		await page.mouse.down();
		for (const delta of [15, 30, 45, 60, 70]) {
			await page.mouse.move(x + Math.sign(dx) * delta, y, { steps: 4 });
			await expect(zooms).toHaveCount(1);
			await expect(page.getByTestId("timeline-add-preview")).toHaveCount(0);
		}
		await page.mouse.move(x + dx, row.y + 1, { steps: 3 });
		await page.mouse.up();
		await expect(zooms).toHaveCount(1);
		await page.mouse.move(x + dx - 10, row.y + 1);
		await expect(zooms).toHaveCount(1);
	});
}

test("a resize released beyond its minimum must not turn into an empty-lane add", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/zoom-bounds.html");
	await page.getByRole("button", { name: "Add after", exact: true }).click();
	await page.getByRole("button", { name: "Move neighbor away", exact: true }).click();
	const zooms = page.locator('[data-variant="zoom"]');
	const after = zooms.filter({ hasText: "1.5" });
	const box = (await after.boundingBox())!;
	const row = (await page.locator('[data-timeline-row="row-zoom"]').boundingBox())!;
	const clip = (await page.locator('[data-variant="clip"]').boundingBox())!;
	const original = await page.locator("main").getAttribute("data-regions");
	const x = box.x + box.width - 2;
	await page.mouse.move(x, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(clip.x + clip.width * 0.4, row.y + 1, { steps: 25 });
	await expect(page.getByTestId("timeline-add-preview")).toHaveCount(0);
	await page.mouse.up();
	await expect(zooms).toHaveCount(2);
	await expect(page.getByTestId("timeline-add-preview")).toHaveCount(0);
	await page.getByRole("button", { name: "Undo edit", exact: true }).click();
	await expect(page.locator("main")).toHaveAttribute("data-regions", original!);
	// A subsequent deliberate click on empty space must still add normally.
	await page.mouse.click(clip.x + clip.width * 0.4, row.y + row.height / 2);
	await expect(zooms).toHaveCount(3);
});
