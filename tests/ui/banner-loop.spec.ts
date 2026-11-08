import { expect, test } from "@playwright/test";

test("theme-matched PNG holds for 2.5 seconds, zooms, plays the full silent video and repeats", async ({
	page,
}) => {
	test.setTimeout(45000);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.addInitScript(() => {
		const phases: { phase: string; time: number }[] = [];
		Object.assign(window, { bannerPhases: phases });
		new MutationObserver((records) => {
			for (const record of records) {
				if (
					!(record.target instanceof HTMLElement) ||
					!record.target.hasAttribute("data-recordly-demo")
				)
					continue;
				phases.push({ phase: record.target.dataset.bannerPhase!, time: performance.now() });
			}
		}).observe(document, {
			subtree: true,
			attributes: true,
			attributeFilter: ["data-banner-phase"],
		});
	});
	await page.goto("/tests/ui/banner-loop.html");
	const banner = page.locator("[data-recordly-demo]");
	const video = banner.locator("video");
	await expect(banner).toHaveAttribute("data-banner-phase", "still");
	await expect(banner.locator("img:visible")).toHaveAttribute("src", /banner-light\.png$/);
	await expect(video).toBeHidden();
	await expect(video).toHaveJSProperty("muted", true);
	await expect(video).toHaveJSProperty("loop", false);
	await expect
		.poll(() =>
			banner.locator(".recordly-banner-still").evaluate((el) => {
				return new DOMMatrixReadOnly(getComputedStyle(el).transform).a;
			}),
		)
		.toBeGreaterThan(1.01);
	await page.screenshot({ path: test.info().outputPath("light-still.png") });
	await expect(banner).toHaveAttribute("data-banner-phase", "video", { timeout: 10000 });
	await expect(video).toBeVisible();
	await expect
		.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
		.toBeGreaterThan(0.1);
	const hold = await page.evaluate(() => {
		const phases = (
			window as typeof window & { bannerPhases: { phase: string; time: number }[] }
		).bannerPhases;
		return (
			phases.find((p) => p.phase === "video")!.time -
			phases.find((p) => p.phase === "still")!.time
		);
	});
	expect(hold).toBeGreaterThanOrEqual(2450);
	await page.screenshot({ path: test.info().outputPath("video.png") });
	const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
	expect(duration).toBeGreaterThan(10);
	// Let the real video finish; an artificial ended event would miss playback failures.
	await expect(banner).toHaveAttribute("data-banner-phase", "still", {
		timeout: (duration + 3) * 1000,
	});
	await expect(video).toHaveJSProperty("paused", true);
	await expect(video).toHaveJSProperty("currentTime", 0);
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await expect(banner.locator("img:visible")).toHaveAttribute("src", /banner-dark\.png$/);
	await page.screenshot({ path: test.info().outputPath("dark-still.png") });
	await expect(banner).toHaveAttribute("data-banner-phase", "video", { timeout: 5000 });
	await expect
		.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
		.toBeGreaterThan(0.1);
});

test("reduced motion pauses a playing banner and keeps the matching still without zoom", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/tests/ui/banner-loop.html");
	const banner = page.locator("[data-recordly-demo]");
	await expect(banner).toHaveAttribute("data-banner-phase", "video", { timeout: 10000 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(banner).toHaveAttribute("data-banner-phase", "still");
	await expect(banner.locator("video")).toHaveJSProperty("paused", true);
	await expect(banner.locator(".recordly-banner-still")).toHaveCSS("animation-name", "none");
	await page.waitForTimeout(2800);
	await expect(banner).toHaveAttribute("data-banner-phase", "still");
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await expect(banner.locator("img:visible")).toHaveAttribute("src", /banner-dark\.png$/);
});

test("failed video loading retains the still", async ({ page }) => {
	await page.route("**/auth/recordly-demo.mp4*", (route) => route.abort());
	await page.goto("/tests/ui/banner-loop.html");
	const banner = page.locator("[data-recordly-demo]");
	await expect(banner).toHaveAttribute("data-banner-phase", "still");
	await page.waitForTimeout(2800);
	await expect(banner).toHaveAttribute("data-banner-phase", "still");
	await expect(banner.locator("img:visible")).toBeVisible();
	await expect(banner.locator("video")).toBeHidden();
});
