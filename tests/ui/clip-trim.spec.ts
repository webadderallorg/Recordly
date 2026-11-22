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
	const cap = page.getByTestId("playhead-cap");
	await cap.hover();
	const start = (await cap.boundingBox())!;
	const y = start.y + start.height / 2;
	await page.mouse.move(start.x + start.width / 2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * fraction, y, { steps: 6 });
	await page.mouse.up();
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
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(clip(page)).toHaveAttribute("data-end-ms", "6000");

	const endCut = await seekTo(page, 0.5);
	await page.keyboard.press("w");
	await expect(clip(page)).toHaveAttribute("data-end-ms", String(endCut));
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(clip(page)).toHaveAttribute("data-end-ms", "6000");
	const buttonCut = await seekTo(page, 0.5);
	await page.getByRole("button", { name: "Trim End to Playhead (W)", exact: true }).click();
	await expect(clip(page)).toHaveAttribute("data-end-ms", String(buttonCut));
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

test("a narrow clip still moves when its longer neighbor is selected", async ({ page }) => {
	const cut = await seekTo(page, 0.002);
	await page.getByRole("button", { name: /^Split Clip \(/ }).click();
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(2);
	await clips.last().click();
	await expect(clips.last()).toHaveAttribute("data-selected", "true");
	const first = (await clips.first().boundingBox())!;
	const second = (await clips.last().boundingBox())!;
	expect(first.width).toBeLessThanOrEqual(8);

	const y = first.y + first.height / 2;
	await page.mouse.move(first.x + first.width / 2, y);
	await page.mouse.down();
	await page.mouse.move(second.x + second.width - 8, y, { steps: 16 });
	await page.mouse.up();

	await expect(clips.first()).toHaveAttribute("data-end-ms", String(6000 - cut));
	await expect(clips.last()).toHaveAttribute("data-end-ms", "6000");
});

test("trim actions fit in the compact clip menu", async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 650 });
	const cut = await seekTo(page, 0.5);
	await page.getByRole("button", { name: "Clip", exact: true }).click();
	await expect(page.getByRole("menuitem", { name: /^Split Clip/ })).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Trim Start to Playhead (Q)" })).toBeVisible();
	await page.getByRole("menuitem", { name: "Trim End to Playhead (W)" }).click();
	await expect(clip(page)).toHaveAttribute("data-end-ms", String(cut));
});
