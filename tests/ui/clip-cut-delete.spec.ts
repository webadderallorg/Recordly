import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test.use({ channel: process.env.RECORDLY_TEST_BROWSER_CHANNEL === "chrome" ? "chrome" : undefined });

test("two cuts select the middle clip for deletion", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(1, { timeout: 20_000 });
	const firstClip = await clips.first().boundingBox();
	const timeline = page.locator(".select-none.bg-editor-bg.relative.cursor-pointer.group.flex.flex-col").last();
	const canvas = await timeline.boundingBox();
	if (!firstClip || !canvas) throw new Error("Timeline is not visible");

	await page.mouse.click(firstClip.x + firstClip.width * 0.25, canvas.y + 6);
	await page.getByRole("button", { name: /Split Clip/ }).click();
	await expect(clips).toHaveCount(2);
	await page.mouse.click(firstClip.x + firstClip.width * 0.5, canvas.y + 6);
	await page.getByRole("button", { name: /Split Clip/ }).click();
	await expect(clips).toHaveCount(3);

	await page.keyboard.press("Delete");
	await expect(clips).toHaveCount(2);
	const firstEnd = Number(await clips.nth(0).getAttribute("data-end-ms"));
	const lastStart = Number(await clips.nth(1).getAttribute("data-start-ms"));
	expect(lastStart).toBe(firstEnd);
	const lastClip = await clips.nth(1).boundingBox();
	if (!lastClip) throw new Error("Retained clip is not visible");
	await page.mouse.click(lastClip.x + Math.min(8, lastClip.width / 4), canvas.y + 6);
	await expect
		.poll(() =>
			page.locator('video[src*="filmstrip.mp4"]').evaluate((video: HTMLVideoElement) => video.currentTime),
		)
		.toBeGreaterThan((firstEnd + 500) / 1_000);
});
