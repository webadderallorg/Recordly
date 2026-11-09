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
