import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
import type {} from "./preview-performance";

test.use({ deviceScaleFactor: 2 });

test("a shrunken recording texture and a return to the editor restore the paused frame", async ({
	page,
}) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/preview-performance.html");
	await expect
		.poll(
			() =>
				page.evaluate(() => Boolean(window.performancePreview?.api?.videoSprite?.visible)),
			{ timeout: 30000 },
		)
		.toBe(true);

	for (const action of ["damaged texture", "return to editor"] as const) {
		const frameBefore = await page.evaluateHandle((action) => {
			const api = window.performancePreview.api!;
			const video = api.video!;
			const texture = api.videoSprite!.texture;
			const frame = {
				video,
				texture,
				time: video.currentTime,
				revision: api.composedFrame!.revision,
			};
			if (action === "damaged texture") {
				texture.frame.width = texture.frame.height = 1;
				api.seekTimeline(frame.time);
			} else {
				document.dispatchEvent(new Event("visibilitychange"));
			}
			return frame;
		}, action);
		await expect
			.poll(() =>
				frameBefore.evaluate(({ video, texture, time, revision }) => {
					const api = window.performancePreview.api!;
					const sprite = api.videoSprite!;
					return (
						texture.destroyed &&
						sprite.visible &&
						sprite.texture.width === video.videoWidth &&
						sprite.texture.height === video.videoHeight &&
						api.composedFrame!.revision > revision &&
						api.video === video &&
						video.paused &&
						video.currentTime === time
					);
				}),
			)
			.toBe(true);
		await frameBefore.dispose();
	}
});

test("mute, parent rerenders and repeated export/remount cycles keep a valid drawn preview", async ({
	page,
}) => {
	test.setTimeout(120000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/preview-performance.html");
	await expect
		.poll(
			() =>
				page.evaluate(() => Boolean(window.performancePreview?.api?.videoSprite?.visible)),
			{ timeout: 30000 },
		)
		.toBe(true);
	const invertedShadow = await page.evaluate(() => window.performancePreview.invertedShadow);
	expect(invertedShadow.preserved).toBeGreaterThan(100);
	expect(invertedShadow.altered).toBe(0);
	expect(invertedShadow.invertedBody).toBeGreaterThan(100);
	await page.getByRole("button", { name: "Toggle cursor", exact: true }).click();
	for (let cycle = 0; cycle < 3; cycle++) {
		const frameBeforeExport = await page.evaluateHandle(() => {
			const { app, video, videoSprite, composedFrame } = window.performancePreview.api!;
			return {
				app,
				video,
				texture: videoSprite!.texture,
				time: video!.currentTime,
				composedFrame,
			};
		});
		await page.getByRole("button", { name: "Run export cycle", exact: true }).click();
		await expect(page.locator("[data-export-status]")).toHaveText("done", { timeout: 30000 });
		await expect
			.poll(() =>
				frameBeforeExport.evaluate((before) => {
					const { app, video, videoSprite, composedFrame } =
						window.performancePreview.api!;
					return {
						samePreview: app === before.app && video === before.video,
						sameTime: video!.currentTime === before.time && video!.paused,
						repainted: composedFrame !== before.composedFrame && videoSprite!.visible,
						regenerated: before.texture.destroyed && !videoSprite!.texture.destroyed,
					};
				}),
			)
			.toEqual({ samePreview: true, sameTime: true, repainted: true, regenerated: true });
		await frameBeforeExport.dispose();
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
				.poll(
					() =>
						page.evaluate(
							() =>
								Boolean(window.performancePreview?.api?.videoSprite?.visible) &&
								window.performancePreview.api!.app !==
									(window as unknown as { oldPreviewApp: unknown }).oldPreviewApp,
						),
					{ timeout: 30000 },
				)
				.toBe(true);
		}
	}
	expect(errors).toEqual([]);
});
