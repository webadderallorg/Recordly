import { expect, type Locator, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

const clip = (page: Page) => page.locator('[data-variant="clip"]').first();
const spanFor = async (item: Locator) => ({
	start: Number(await item.getAttribute("data-start-ms")),
	end: Number(await item.getAttribute("data-end-ms")),
});
const playheadMs = (page: Page) =>
	page
		.locator('video[aria-hidden="true"]')
		.evaluate((video: HTMLVideoElement) => Math.round(video.currentTime * 1000));

async function seekTo(page: Page, fraction: number) {
	const box = (await clip(page).locator(".timeline-block").boundingBox())!;
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(box.x + box.width * fraction, row.y - 8);
	await expect.poll(() => playheadMs(page)).toBeGreaterThan(0);
	return playheadMs(page);
}

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(clip(page)).toHaveAttribute("data-end-ms", "6000", { timeout: 20000 });
});

test("Q and W trim the clip to the playhead and undo restores it", async ({ page }) => {
	const startCut = await seekTo(page, 1 / 3);
	await page.keyboard.press("q");
	await expect.poll(async () => (await spanFor(clip(page))).end).toBe(6000 - startCut);
	expect((await spanFor(clip(page))).start).toBe(0);
	await expect(page.getByTestId("playhead-cap")).toHaveAttribute("aria-label", "Playhead 0.0s");
	await page.keyboard.press("ControlOrMeta+z");
	await expect(clip(page)).toHaveAttribute("data-end-ms", "6000");

	const endCut = await seekTo(page, 0.5);
	await page.keyboard.press("w");
	await expect(clip(page)).toHaveAttribute("data-end-ms", String(endCut));
	await page.keyboard.press("ControlOrMeta+z");
	await expect(clip(page)).toHaveAttribute("data-end-ms", "6000");

	await page.getByRole("button", { name: "Trim End to Playhead (W)", exact: true }).click();
	await expect(clip(page)).toHaveAttribute("data-end-ms", String(endCut));
});

test("the visible grip starts a trim and an edge snaps to the playhead", async ({ page }) => {
	const cut = await seekTo(page, 0.5);
	const block = (await clip(page).locator(".timeline-block").boundingBox())!;
	const y = block.y + block.height / 2;
	const playheadX = block.x + (block.width * cut) / 6000;
	await page.mouse.move(block.x - 9, y);
	await page.mouse.down();
	await page.mouse.move(playheadX, y, { steps: 12 });
	await page.mouse.up();
	await expect.poll(async () => (await spanFor(clip(page))).end).toBe(6000 - cut);
});
