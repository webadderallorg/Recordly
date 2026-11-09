import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
import type { featherChecks } from "./webcam-feather";
import { readPreviewFeather } from "./webcam-feather-probe";

test("both export compositors feather every webcam border and preserve the sharp center", async ({
	page,
}, testInfo) => {
	test.setTimeout(60_000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/webcam-feather.html");
	const results = await page.evaluate(() =>
		(window as Window & { featherChecks: typeof featherChecks }).featherChecks(),
	);
	for (const soft of results.filter((result) => result.frame === "soft-blur")) {
		const standard = results.find(
			(result) =>
				result.name === soft.name &&
				result.shape === soft.shape &&
				result.frame === "standard",
		)!;
		for (const edge of soft.edges) {
			expect(
				edge[0],
				`${soft.name}/${soft.shape}: border blends into the background`,
			).toBeLessThan(65);
			expect(
				edge.filter((value) => value > 40 && value < 245).length,
				`${soft.name}/${soft.shape}: gradual transition`,
			).toBeGreaterThanOrEqual(4);
			expect(edge.at(-1)).toBe(255);
		}
		expect(
			Math.max(
				...soft.center.map((value, index) => Math.abs(value - standard.center[index])),
			),
			`${soft.name}/${soft.shape}: center stays sharp`,
		).toBeLessThanOrEqual(1);
		const other = results.find(
			(result) =>
				result.name !== soft.name &&
				result.shape === soft.shape &&
				result.frame === "soft-blur",
		)!;
		expect(
			Math.max(
				...soft.edges
					.flat()
					.map((value, index) => Math.abs(value - other.edges.flat()[index])),
			),
			`${soft.shape}: export backends match`,
		).toBeLessThanOrEqual(3);
	}
	await page.screenshot({ path: testInfo.outputPath("webcam-export-edges.png"), fullPage: true });
});

test("soft webcam edges stay rendered during playback and after pausing", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/webcam-motion-blur.html");
	await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
	await page.getByRole("button", { name: "Soft frame", exact: true }).click();
	const layer = page.locator('[data-webcam-frame-style="soft-blur"]');
	await expect(layer).toBeVisible();
	const expected = { transparentEdge: true, opaqueCenter: true, gradualFade: true };
	await expect.poll(() => page.evaluate(readPreviewFeather)).toEqual(expected);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(async () => Number(await page.locator("main").getAttribute("data-time")))
		.toBeGreaterThan(1.5);
	await expect.poll(() => page.evaluate(readPreviewFeather)).toEqual(expected);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(layer).toBeVisible();
	await expect.poll(() => page.evaluate(readPreviewFeather)).toEqual(expected);
});

test("soft webcam frame remains feathered through delayed seeks and redraws after decoding", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/webcam-motion-blur.html");
	await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
	await page.getByRole("button", { name: "Soft frame", exact: true }).click();
	const layer = page.locator("[data-webcam-motion-blur]");
	await expect(layer).toBeVisible();
	const expected = { transparentEdge: true, opaqueCenter: true, gradualFade: true };
	await expect.poll(() => page.evaluate(readPreviewFeather)).toEqual(expected);
	for (const [button, target] of [
		["Seek end", 4.8],
		["Seek start", 0.2],
	] as const) {
		// Hold HAVE_METADATA until the decoder's readiness event is released.
		await page.locator("[data-webcam-overlay] video").evaluate((element) => {
			Object.defineProperty(element, "readyState", { configurable: true, get: () => 1 });
			const draw = CanvasRenderingContext2D.prototype.drawImage;
			const samples: number[] = [];
			Object.assign(window, { webcamDecodedDraws: samples });
			CanvasRenderingContext2D.prototype.drawImage = function (
				...args: Parameters<typeof draw>
			) {
				if (args[0] === element) samples.push((element as HTMLVideoElement).currentTime);
				return Reflect.apply(draw, this, args);
			};
		});
		await page.getByRole("button", { name: button, exact: true }).click();
		await expect
			.poll(async () => Number(await page.locator("main").getAttribute("data-time")))
			.toBeCloseTo(target, 1);
		const heldFrames = await page.evaluate(async () => {
			const visible: boolean[] = [];
			for (let frame = 0; frame < 12; frame++) {
				await new Promise(requestAnimationFrame);
				visible.push(
					(document.querySelector("[data-webcam-motion-blur]") as HTMLElement).style
						.display === "block",
				);
			}
			return visible;
		});
		expect(heldFrames.every(Boolean)).toBe(true);
		await expect(layer).toBeVisible();
		await expect(page.locator("[data-webcam-overlay]")).toHaveCSS("visibility", "hidden");
		await page.locator("[data-webcam-overlay] video").evaluate((element) => {
			Reflect.deleteProperty(element, "readyState");
			element.dispatchEvent(new Event("canplay"));
		});
		await expect
			.poll(() =>
				page.locator("[data-webcam-overlay] video").evaluate((element) => {
					const video = element as HTMLVideoElement;
					return video.readyState >= 2 && !video.seeking && video.currentTime;
				}),
			)
			.toBeCloseTo(target, 1);
		await expect
			.poll(() =>
				page.evaluate(
					(target) =>
						(
							window as Window & { webcamDecodedDraws: number[] }
						).webcamDecodedDraws.some((time) => Math.abs(time - target) < 0.05),
					target,
				),
			)
			.toBe(true);
		await expect.poll(() => page.evaluate(readPreviewFeather)).toEqual(expected);
	}
});
