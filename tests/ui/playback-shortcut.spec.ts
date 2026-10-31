import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("Space toggles once per press, including on the focused playback button", async ({ page }) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, {
		timeout: 20000,
	});
	const play = page.getByRole("button", { name: "Play", exact: true });
	const pause = page.getByRole("button", { name: "Pause", exact: true });
	await expect(play).toBeVisible();
	await expect(page.locator('[data-variant="clip"]')).toBeVisible();
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, {
		timeout: 20000,
	});
	await expect
		.poll(() =>
			page
				.locator('video[aria-hidden="true"]')
				.evaluate((video: HTMLVideoElement) => video.readyState),
		)
		.toBeGreaterThanOrEqual(2);
	await play.focus();
	await page.keyboard.down("Space");
	await expect(pause).toBeVisible();
	await page.keyboard.up("Space");
	await expect(pause).toBeVisible();
	await page.keyboard.down("Space");
	await expect(play).toBeVisible();
	// Repeated keydowns from holding the key must not toggle again.
	await page.keyboard.down("Space");
	await page.keyboard.down("Space");
	await expect(play).toBeVisible();
	await page.keyboard.up("Space");
	await expect(play).toBeVisible();
	// A fresh press still works immediately, without a debounce delay.
	await page.keyboard.press("Space");
	await expect(pause).toBeVisible();
	await page.keyboard.press("Space");
	await expect(play).toBeVisible();
	await page.getByTestId("timeline-scroll").focus();
	await page.keyboard.press("Space");
	await expect(pause).toBeVisible();
	await page.keyboard.press("Space");
	await expect(play).toBeVisible();
});
