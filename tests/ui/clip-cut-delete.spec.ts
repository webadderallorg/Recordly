import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test.use({ channel: process.env.RECORDLY_TEST_BROWSER_CHANNEL === "chrome" ? "chrome" : undefined });

test("two cuts select the middle clip for deletion", async ({ page }) => {
	test.setTimeout(45_000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(1, { timeout: 20_000 });
	const firstClip = await clips.first().boundingBox();
	const timeline = page.locator(".select-none.bg-editor-bg.relative.cursor-pointer.group.flex.flex-col").last();
	const canvas = await timeline.boundingBox();
	if (!firstClip || !canvas) throw new Error("Timeline is not visible");

	await page.mouse.click(firstClip.x + firstClip.width * 0.2, canvas.y + 6);
	await page.getByRole("button", { name: /Split Clip/ }).click();
	await expect(clips).toHaveCount(2);
	await page.mouse.click(firstClip.x + firstClip.width * 0.65, canvas.y + 6);
	await page.getByRole("button", { name: /Split Clip/ }).click();
	await expect(clips).toHaveCount(3);
	const beforeDelete = await clips.evaluateAll((elements) =>
		elements.map((element) => ({
			start: Number(element.getAttribute("data-start-ms")),
			end: Number(element.getAttribute("data-end-ms")),
		})),
	);
	const [firstBefore, middleBefore, lastBefore] = beforeDelete;

	await page.keyboard.press("Delete");
	await expect(clips).toHaveCount(2);
	await expect(clips.first()).toHaveAttribute("data-start-ms", String(firstBefore.start));
	await expect(clips.first()).toHaveAttribute("data-end-ms", String(firstBefore.end));
	await expect(clips.last()).toHaveAttribute("data-start-ms", String(firstBefore.end));
	await expect(clips.last()).toHaveAttribute(
		"data-end-ms",
		String(firstBefore.end + lastBefore.end - lastBefore.start),
	);
	expect(middleBefore.end - middleBefore.start).toBeGreaterThan(0);
	const lastClip = await clips.nth(1).boundingBox();
	if (!lastClip) throw new Error("Retained clip is not visible");
	await page.mouse.click(lastClip.x + Math.min(8, lastClip.width / 4), canvas.y + 6);
	const video = page.locator('video[src*="filmstrip.mp4"]');
	await expect
		.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
		.toBeGreaterThan(middleBefore.end / 1000);
	const timeBeforePlay = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
		.toBeGreaterThan(timeBeforePlay + 0.1);
});
