import { expect, test } from "@playwright/test";
import type {} from "./preview-performance";
import { installDesktopBridge } from "./bridge";

test.use({ deviceScaleFactor: 2 });

test("mute, parent rerenders and repeated export/remount cycles keep a valid drawn preview", async ({
	page,
}) => {
	test.setTimeout(60000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/preview-performance.html");
	await expect
		.poll(() =>
			page.evaluate(() => Boolean(window.performancePreview?.api?.videoSprite?.visible)),
		)
		.toBe(true);
	const invertedShadow = await page.evaluate(() => window.performancePreview.invertedShadow);
	expect(invertedShadow.preserved).toBeGreaterThan(100);
	expect(invertedShadow.altered).toBe(0);
	expect(invertedShadow.invertedBody).toBeGreaterThan(100);
	await page.getByRole("button", { name: "Toggle cursor", exact: true }).click();
	for (let cycle = 0; cycle < 3; cycle++) {
		await page.getByRole("button", { name: "Run export cycle", exact: true }).click();
		await expect(page.locator("[data-export-status]")).toHaveText("done", { timeout: 30000 });
		await page.evaluate(async () => {
			for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
			const probe = window.performancePreview;
			Object.assign(window, {
				initialPreview: {
					app: probe.api!.app,
					sprite: probe.api!.videoSprite,
					texture: probe.api!.videoSprite!.texture,
					renders: probe.renders,
				},
			});
		});
		const drawnFrame = await page.locator("canvas").first().screenshot();
		for (const action of [
			"Toggle mute",
			"Parent rerender",
			"Toggle clip mute",
			"Toggle mute",
			"Parent rerender",
			"Toggle clip mute",
		]) {
			await page.getByRole("button", { name: action, exact: true }).click();
			const state = await page.evaluate(async () => {
				for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
				const probe = window.performancePreview;
				const initial = (
					window as unknown as {
						initialPreview: {
							app: unknown;
							sprite: unknown;
							texture: unknown;
							renders: number;
						};
					}
				).initialPreview;
				return {
					appRetained: probe.api!.app === initial.app,
					spriteRetained: probe.api!.videoSprite === initial.sprite,
					textureRetained: probe.api!.videoSprite!.texture === initial.texture,
					visible: probe.api!.videoSprite!.visible,
					textureAlive:
						!probe.api!.videoSprite!.texture.destroyed &&
						!probe.api!.videoSprite!.texture.source.destroyed,
					renders: probe.renders - initial.renders,
				};
			});
			expect(state).toEqual({
				appRetained: true,
				spriteRetained: true,
				textureRetained: true,
				visible: true,
				textureAlive: true,
				renders: 0,
			});
			expect((await page.locator("canvas").first().screenshot()).equals(drawnFrame)).toBe(
				true,
			);
		}
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect
			.poll(() =>
				page.evaluate(() => Boolean(window.performancePreview?.api?.app?.ticker.started)),
			)
			.toBe(true);
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		await expect
			.poll(() =>
				page.evaluate(() => Boolean(window.performancePreview?.api?.app?.ticker.started)),
			)
			.toBe(false);
		if (cycle < 2) {
			await page.evaluate(() =>
				Object.assign(window, { oldPreviewApp: window.performancePreview.api!.app }),
			);
			await page.getByRole("button", { name: "Remount preview", exact: true }).click();
			await expect
				.poll(() =>
					page.evaluate(
						() =>
							Boolean(window.performancePreview?.api?.videoSprite?.visible) &&
							window.performancePreview.api!.app !==
								(window as unknown as { oldPreviewApp: unknown }).oldPreviewApp,
					),
				)
				.toBe(true);
		}
	}
	expect(errors).toEqual([]);
});
