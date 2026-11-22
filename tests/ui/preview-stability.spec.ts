import { expect, test } from "@playwright/test";
import type { WebGLRenderer } from "pixi.js";
import { installDesktopBridge } from "./bridge";
import type {} from "./preview-performance";

test.use({ deviceScaleFactor: 2 });

test("export recovery redraws the recording when the paused decoder becomes ready again", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/preview-performance.html");
	await expect
		.poll(() => page.evaluate(() => !!window.performancePreview?.api?.composedFrame), {
			timeout: 30_000,
		})
		.toBe(true);

	const frame = await page.evaluateHandle(async () => {
		const api = window.performancePreview.api!;
		const app = api.app!;
		const sprite = api.videoSprite!;
		const video = api.video!;
		const canvas = app.canvas as HTMLCanvasElement;
		const gl = canvas.getContext("webgl2")!;
		const center = () => {
			const pixel = new Uint8Array(4);
			gl.readPixels(
				canvas.width >> 1,
				canvas.height >> 1,
				1,
				1,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				pixel,
			);
			return Array.from(pixel);
		};
		let submitted = center();
		app.renderer.runners.postrender.add({
			postrender: () => {
				submitted = center();
			},
		});
		app.render();
		const expected = submitted;
		const time = video.currentTime;
		const camera = api.videoContainer!.parent!.parent!;
		const pose = () => [camera.x, camera.y, camera.scale.x];
		const expectedPose = pose();

		// Invalidate the pixels in place. The decoded video and Pixi dimensions
		// remain valid, but the currently uploaded recording is fully transparent.
		const texture = sprite.texture;
		const gpuTexture = (app.renderer as WebGLRenderer).texture.getGlSource(texture.source);
		const previousBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
		gl.bindTexture(gl.TEXTURE_2D, gpuTexture.texture);
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0,
			0,
			0,
			video.videoWidth,
			video.videoHeight,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			new Uint8Array(video.videoWidth * video.videoHeight * 4),
		);
		gl.bindTexture(gl.TEXTURE_2D, previousBinding);
		app.render();
		const damaged = submitted;
		const dimension = texture.width;

		// Finish an export while the paused preview has no current decoded frame.
		Object.defineProperty(video, "readyState", {
			configurable: true,
			value: video.HAVE_METADATA,
		});
		return {
			expected,
			damaged,
			dimension,
			restoreDecoder: () => {
				Reflect.deleteProperty(video, "readyState");
				video.dispatchEvent(new Event("canplay"));
			},
			read: () => ({
				pixels: submitted,
				playheadRetained: api.video === video && video.paused && video.currentTime === time,
				poseRetained: pose().every((value, i) => value === expectedPose[i]),
			}),
		};
	});

	expect(
		await frame.evaluate(({ expected, damaged, dimension }) => ({
			expected,
			damaged,
			dimension,
		})),
	).toMatchObject({
		damaged: [0, 0, 0, 0],
		dimension: 320,
	});
	const expected = await frame.evaluate((frame) => frame.expected);
	expect(expected[3]).toBe(255);
	await page.getByRole("button", { name: "Run export cycle", exact: true }).click();
	await expect(page.locator("[data-export-status]")).toHaveText("done");
	// Give the first post-export render a chance to run while the decoder is stalled.
	await page.evaluate(async () => {
		await new Promise(requestAnimationFrame);
		await new Promise(requestAnimationFrame);
	});
	await frame.evaluate((frame) => frame.restoreDecoder());
	await expect
		.poll(() => frame.evaluate((frame) => frame.read()))
		.toEqual({
			pixels: expected,
			playheadRetained: true,
			poseRetained: true,
		});
	await frame.dispose();
});

test("a failed post-export regeneration retries when the decoder reports it is ready", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/preview-performance.html");
	await expect
		.poll(
			() =>
				page.evaluate(() => Boolean(window.performancePreview?.api?.videoSprite?.visible)),
			{ timeout: 30_000 },
		)
		.toBe(true);

	const frame = await page.evaluateHandle(() => {
		const api = window.performancePreview.api!;
		const video = api.video!;
		const texture = api.videoSprite!.texture;
		const source = texture.source as unknown as { update: () => void };
		source.update = () => {
			throw new Error("Decoder lost the current frame");
		};
		return {
			texture,
			restoreDecoder: () => {
				Reflect.deleteProperty(source, "update");
				video.dispatchEvent(new Event("canplay"));
			},
			read: () => {
				const sprite = window.performancePreview.api!.videoSprite!;
				return {
					regenerated: texture.destroyed,
					visible: sprite.visible,
					matchesVideo: sprite.texture.width === video.videoWidth,
				};
			},
		};
	});
	await page.getByRole("button", { name: "Run export cycle", exact: true }).click();
	await expect(page.locator("[data-export-status]")).toHaveText("done");
	await expect
		.poll(() => frame.evaluate((frame) => frame.read()))
		.toMatchObject({ regenerated: true, visible: false });
	await page.evaluate(async () => {
		for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
	});
	expect(await frame.evaluate((frame) => frame.read().visible)).toBe(false);
	await frame.evaluate((frame) => frame.restoreDecoder());
	await expect
		.poll(() => frame.evaluate((frame) => frame.read()))
		.toEqual({ regenerated: true, visible: true, matchesVideo: true });
	expect(errors).toEqual(["Decoder lost the current frame"]);
	await frame.dispose();
});

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
