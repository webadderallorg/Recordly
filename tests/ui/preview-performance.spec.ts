import { expect, test } from "@playwright/test";
import type {} from "./preview-performance";
import { installDesktopBridge } from "./bridge";

test.afterEach(async ({ page }, testInfo) => {
	if (testInfo.status !== testInfo.expectedStatus)
		console.log(
			"preview state",
			await page.evaluate(() => ({
				probe: !!window.performancePreview,
				api: window.performancePreview?.api
					? {
							app: !!window.performancePreview.api.app,
							sprite: !!window.performancePreview.api.videoSprite,
							visible: window.performancePreview.api.videoSprite?.visible,
							ticker: window.performancePreview.api.app?.ticker.started,
						}
					: null,
				videos: [...document.querySelectorAll("video")].map((v) => ({
					time: v.currentTime,
					seeking: v.seeking,
					ready: v.readyState,
					error: v.error?.message,
				})),
			})),
		);
});

// Wait through browser frames rather than forcing Pixi updates: a clean pause
// must remain idle on its own while edits and decoded seeks still wake it.
async function observe(page: import("@playwright/test").Page) {
	return page.evaluate(async () => {
		const probe = window.performancePreview;
		const before = probe.renders;
		for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
		return { renders: probe.renders - before, ticking: probe.api!.app!.ticker.started };
	});
}

test("paused preview sleeps, refreshes edits and seeks, and resumes continuous playback", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/preview-performance.html");
	await expect
		.poll(
			() =>
				page.evaluate(() => Boolean(window.performancePreview?.api?.videoSprite?.visible)),
			{ timeout: 60000 },
		)
		.toBe(true);
	await expect.poll(async () => (await observe(page)).renders).toBe(0);
	expect((await observe(page)).ticking).toBe(false);
	// Reproduce the previous paused policy with the same scene for comparison.
	await page.evaluate(() => window.performancePreview.api!.app!.ticker.start());
	const continuousPause = await observe(page);
	expect(continuousPause.renders).toBeGreaterThan(5);
	await page.evaluate(() => window.performancePreview.api!.app!.ticker.stop());
	const sleepingPause = await observe(page);
	expect(sleepingPause.renders).toBe(0);
	console.log("Paused render comparison over 20 browser frames:", {
		continuousPause,
		sleepingPause,
	});
	const initial = await page.evaluate(() => window.performancePreview.api!.videoSprite!.width);
	await page.getByRole("button", { name: "Change padding", exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => window.performancePreview.api!.videoSprite!.width))
		.not.toBe(initial);
	await expect.poll(async () => (await observe(page)).renders).toBe(0);
	for (const action of ["Toggle cursor", "Toggle annotation"]) {
		const count = await page.evaluate(() => window.performancePreview.renders);
		await page.getByRole("button", { name: action, exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => window.performancePreview.renders))
			.toBeGreaterThan(count);
		await expect.poll(async () => (await observe(page)).renders).toBe(0);
	}
	await expect(page.locator('[data-annotation-id="text"]')).toBeVisible();
	await page.evaluate(() => window.performancePreview.api!.seekTimeline(5.5));
	await expect(page.locator('[data-annotation-id="text"]')).toHaveCount(0);
	await expect.poll(async () => (await observe(page)).renders).toBe(0);
	await page.evaluate(() => window.performancePreview.api!.seekTimeline(1));
	await expect(page.locator('[data-annotation-id="text"]')).toBeVisible();
	const playbackStart = await page.evaluate(() => window.performancePreview.renders);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => window.performancePreview.renders), { timeout: 20000 })
		.toBeGreaterThan(playbackStart + 1);
	expect(await page.evaluate(() => window.performancePreview.api!.app!.ticker.started)).toBe(
		true,
	);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect.poll(async () => (await observe(page)).renders).toBe(0);
	expect((await observe(page)).ticking).toBe(false);
	const position = await page.evaluate(() => ({
		scale: window.performancePreview.api!.videoContainer!.parent!.parent!.scale.x,
		x: window.performancePreview.api!.videoContainer!.parent!.parent!.x,
	}));
	await observe(page);
	expect(
		await page.evaluate(() => ({
			scale: window.performancePreview.api!.videoContainer!.parent!.parent!.scale.x,
			x: window.performancePreview.api!.videoContainer!.parent!.parent!.x,
		})),
	).toEqual(position);
	await page.getByRole("button", { name: "Toggle suspension", exact: true }).click();
	await expect.poll(async () => (await observe(page)).renders).toBe(0);
	await page.getByRole("button", { name: "Toggle suspension", exact: true }).click();
	await expect.poll(async () => (await observe(page)).renders).toBe(0);
	const resumeStart = await page.evaluate(() => window.performancePreview.renders);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => window.performancePreview.renders), { timeout: 20000 })
		.toBeGreaterThan(resumeStart + 1);
});

test("caption wrapping and text measurements are reused across paused seeks", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.addInitScript(() => {
		Object.assign(window, { captionMeasurements: 0 });
		const original = CanvasRenderingContext2D.prototype.measureText;
		CanvasRenderingContext2D.prototype.measureText = function (text) {
			const probe = window as unknown as { captionMeasurements: number };
			probe.captionMeasurements++;
			return original.call(this, text);
		};
	});
	await page.goto("/tests/ui/preview-performance.html");
	await expect
		.poll(
			() =>
				page.evaluate(() => Boolean(window.performancePreview?.api?.videoSprite?.visible)),
			{ timeout: 60000 },
		)
		.toBe(true);
	await expect(page.getByText("Follow", { exact: true })).toBeVisible();
	await expect.poll(async () => (await observe(page)).renders).toBe(0);
	const before = await page.evaluate(
		() => (window as unknown as { captionMeasurements: number }).captionMeasurements,
	);
	expect(before).toBeGreaterThan(0);
	for (const time of [2.2, 4.2, 1.2]) {
		await page.evaluate((time) => window.performancePreview.api!.seekTimeline(time), time);
		await expect
			.poll(() => page.evaluate(() => window.performancePreview.api!.video!.seeking))
			.toBe(false);
		await observe(page);
	}
	expect(
		await page.evaluate(
			() => (window as unknown as { captionMeasurements: number }).captionMeasurements,
		),
	).toBe(before);
});
