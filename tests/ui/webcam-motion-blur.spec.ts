import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
import type { exportChecks } from "./webcam-motion-blur";

type MotionWindow = Window & {
	cameraSamples: { time: number; width: number; blurred: boolean; density: number }[];
	exportChecks: typeof exportChecks;
};

test("preview camera blurs on shrink and grow, then clears on pause", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/webcam-motion-blur.html");
	await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
	await expect
		.poll(() =>
			page.locator("[data-webcam-overlay] video").evaluate((node) => {
				const video = node as HTMLVideoElement;
				return video.readyState >= 2 && !video.seeking;
			}),
		)
		.toBe(true);
	await page.evaluate(() => {
		const samples: { time: number; width: number; blurred: boolean; density: number }[] = [];
		Object.assign(window, { cameraSamples: samples });
		const sample = () => {
			const camera = document.querySelector<HTMLElement>("[data-webcam-overlay]");
			const blur = document.querySelector<HTMLCanvasElement>("[data-webcam-motion-blur]");
			if (camera && blur)
				samples.push({
					time: Number(document.querySelector("main")?.getAttribute("data-time")),
					width: parseFloat(camera.style.width),
					blurred: blur.style.display === "block",
					density: blur.width / parseFloat(blur.style.width),
				});
			requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect(page.locator("[data-webcam-motion-blur]")).toBeVisible({ timeout: 5000 });
	await expect
		.poll(async () => Number(await page.locator("main").getAttribute("data-time")))
		.toBeGreaterThan(1.35);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(page.locator("[data-webcam-motion-blur]")).toBeHidden();
	await expect(page.locator("[data-webcam-overlay]")).toHaveCSS("visibility", "visible");
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(() => page.locator("main").getAttribute("data-time"), { timeout: 10000 })
		.toMatch(/^[4-6]/);
	const motion = await page.evaluate(() => {
		const samples = (window as MotionWindow).cameraSamples;
		// Exclude the deliberate pause above and the first frame after resuming.
		const steadyPlayback = samples.filter((sample) => sample.time > 2 && sample.time < 4);
		return {
			shrinking: samples.some(
				(s, i) => i && s.blurred && s.width < samples[i - 1].width - 0.05,
			),
			growing: samples.some(
				(s, i) => i && s.blurred && s.width > samples[i - 1].width + 0.05,
			),
			stableRenderer: steadyPlayback.length > 10 && steadyPlayback.every((s) => s.blurred),
			highDensity: steadyPlayback.every(
				(s) => s.density >= Math.max(2, Math.min(3, devicePixelRatio)),
			),
		};
	});
	expect(motion).toEqual({
		shrinking: true,
		growing: true,
		stableRenderer: true,
		highDensity: true,
	});
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(page.locator("[data-webcam-motion-blur]")).toBeHidden();
	await expect(page.locator("[data-webcam-overlay]")).toHaveCSS("visibility", "visible");
	expect(errors).toEqual([]);
});

test("both exporters blur camera edges in both directions and clear at rest", async ({
	page,
}, testInfo) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/webcam-motion-blur.html");
	const results = await page.evaluate(() => (window as MotionWindow).exportChecks());

	for (const result of results) {
		// A squircle exposes this shoulder; the default circle must clip it.
		expect(result.circleShoulder).toEqual(
			result.name === "modern" ? [34, 34, 34, 255] : [0, 0, 0, 0],
		);
		expect(result.circleCenter[3]).toBe(255);
		expect(result.shrinking, `${result.name}: shrinking shutter`).toBeGreaterThan(
			result.still + 200,
		);
		expect(result.growing, `${result.name}: growing shutter`).toBeGreaterThan(
			result.still + 200,
		);
		expect(result.stopped, `${result.name}: clears blur immediately at rest`).toBeLessThan(
			result.shrinking / 2,
		);
		expect(
			result.settled,
			`${result.name}: returns to the normal renderer after settling`,
		).toBe(result.still);
		expect(result.disabled, `${result.name}: disabled blur`).toBeLessThan(result.shrinking / 2);
	}
	await page.screenshot({ path: testInfo.outputPath("camera-blur-exports.png"), fullPage: true });
});

test("camera shadows do not jump when resize blur starts or stops", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/webcam-motion-blur.html");
	const results = await page.evaluate(() => (window as MotionWindow).exportChecks(0.2, true));
	for (const result of results) {
		// Cover the whole shadow, allowing 4/255 for the subpixel shutter displacement.
		expect(result.maxShadowDifference, `${result.name}: shadow continuity`).toBeLessThanOrEqual(
			4,
		);
		const channel = result.name === "modern" ? 0 : 3;
		expect(
			Math.abs(result.shadowMoving[channel] - result.shadowSettled[channel]),
			`${result.name}: moving ${result.shadowMoving}, settled ${result.shadowSettled}`,
		).toBeLessThanOrEqual(2);
	}
});

test("switching landscape to portrait does not stop the camera at 56 pixels mid-zoom", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/webcam-motion-blur.html");
	await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
	await page.getByRole("button", { name: "Portrait", exact: true }).click();
	const camera = page.locator("[data-webcam-overlay]");
	await expect
		.poll(() => camera.evaluate((el) => parseFloat((el as HTMLElement).style.width)))
		.toBeCloseTo(80, 0);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(() => camera.evaluate((el) => parseFloat((el as HTMLElement).style.width)), {
			timeout: 5000,
		})
		.toBeLessThan(55);
	await expect
		.poll(() => page.locator("main").getAttribute("data-time"), { timeout: 10000 })
		.toMatch(/^[4-6]/);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect
		.poll(() => camera.evaluate((el) => parseFloat((el as HTMLElement).style.width)))
		.toBeCloseTo(80, 0);
});

test("zoom steps near the blur threshold do not alternate shadow renderers", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/webcam-motion-blur.html");
	const result = await page.evaluate(() =>
		(
			window as unknown as { shadowBoundaryChecks(): { active: boolean[]; settled: boolean } }
		).shadowBoundaryChecks(),
	);
	expect(result.active).toEqual([false, true, true, true, true, true, true, true, true]);
	expect(result.settled).toBe(false);
});
