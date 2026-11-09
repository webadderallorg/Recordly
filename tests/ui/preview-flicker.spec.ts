import { expect, test } from "@playwright/test";
import type {} from "./preview-performance";
import { installDesktopBridge } from "./bridge";

type FrameProbe = { frames: number; hidden: unknown[]; blank: unknown[]; retained: boolean };
declare global {
	interface Window {
		flickerProbe: FrameProbe;
	}
}

async function openPreview(page: import("@playwright/test").Page) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/preview-performance.html");
	await expect
		.poll(() => page.evaluate(() => !!window.performancePreview?.api?.videoSprite?.visible))
		.toBe(true);
}

for (const dpr of [1, 2])
	test.describe(`DPR ${dpr}`, () => {
		test.use({ deviceScaleFactor: dpr });
		test("playback, edits, seeks, resizes and export retain drawn source frames", async ({
			page,
		}, testInfo) => {
			test.setTimeout(90000);
			await openPreview(page);
			// The masked case recreates an equivalent mask object on each parent render.
			if (dpr === 2) {
				await page.getByRole("button", { name: "Toggle redaction", exact: true }).click();
				await expect
					.poll(() =>
						page.evaluate(
							() =>
								!window.performancePreview.api!.video!.seeking &&
								window.performancePreview.api!.videoSprite!.visible,
						),
					)
					.toBe(true);
			}
			await page.evaluate(() => {
				const api = window.performancePreview.api!;
				const app = api.app!;
				const sprite = api.videoSprite!;
				const canvas = app.canvas as HTMLCanvasElement;
				const gl = canvas.getContext("webgl2")!;
				const state: FrameProbe = { frames: 0, hidden: [], blank: [], retained: true };
				window.flickerProbe = state;
				// Inspect the pixels actually submitted by every render, before WebGL clears
				// its transient drawing buffer. Extracting the stage would render a new frame
				// and conceal intermittent blank frames from the preview itself.
				app.renderer.runners.postrender.add({
					postrender: () => {
						state.frames++;
						const p = new Uint8Array(4);
						gl.readPixels(
							Math.floor(canvas.width / 2),
							Math.floor(canvas.height / 2),
							1,
							1,
							gl.RGBA,
							gl.UNSIGNED_BYTE,
							p,
						);
						const sample = {
							frame: state.frames,
							time: api.video!.currentTime,
							seeking: api.video!.seeking,
							pixels: [...p],
						};
						state.retained &&=
							api.app === app && api.videoSprite === sprite && app.canvas === canvas;
						if (!sprite.visible) state.hidden.push(sample);
						if (p[3] === 0) state.blank.push(sample);
					},
				});
			});
			for (let cycle = 0; cycle < 6; cycle++) {
				await page.getByRole("button", { name: "Play", exact: true }).click();
				for (const action of [
					"Toggle mute",
					"Parent rerender",
					"Toggle clip mute",
					"Change padding",
					"Toggle annotation",
				])
					await page.getByRole("button", { name: action, exact: true }).click();
				await page.evaluate(async (cycle) => {
					const api = window.performancePreview.api!;
					document.querySelector("main")!.style.width = cycle % 2 ? "800px" : "760px";
					for (let i = 0; i < 8; i++) {
						api.seekTimeline(((cycle + i) % 5) + 0.1);
						for (let f = 0; f < 2; f++) await new Promise(requestAnimationFrame);
					}
				}, cycle);
				await page.getByRole("button", { name: "Pause", exact: true }).click();
				await page.getByRole("button", { name: "Run export cycle", exact: true }).click();
				await expect(page.locator("[data-export-status]")).toHaveText("done");
			}
			const result = await page.evaluate(() => window.flickerProbe);
			await testInfo.attach("submitted-preview-frames", {
				body: JSON.stringify(result, null, 2),
				contentType: "application/json",
			});
			console.log(
				`DPR ${dpr}: ${result.frames} submitted frames; ${result.blank.length} blank, ${result.hidden.length} hidden`,
			);
			expect(result.frames).toBeGreaterThan(50);
			expect(result.retained).toBe(true);
			expect(result.hidden).toEqual([]);
			expect(result.blank).toEqual([]);
		});
	});

test("a privacy edit suppresses the prior source until a replacement frame is decoded", async ({
	page,
}) => {
	await openPreview(page);
	await page.evaluate(() =>
		Object.defineProperty(window.performancePreview.api!.video!, "seeking", {
			configurable: true,
			get: () => true,
		}),
	);
	await page.getByRole("button", { name: "Toggle redaction", exact: true }).click();
	expect(await page.evaluate(() => window.performancePreview.api!.videoSprite!.visible)).toBe(
		false,
	);
	await page.evaluate(() => {
		const video = window.performancePreview.api!.video!;
		Reflect.deleteProperty(video, "seeking");
		video.dispatchEvent(new Event("seeked"));
	});
	await expect
		.poll(() => page.evaluate(() => window.performancePreview.api!.videoSprite!.visible))
		.toBe(true);
	const pixels = await page.evaluate(() => {
		const api = window.performancePreview.api!;
		const canvas = api.app!.canvas as HTMLCanvasElement;
		const gl = canvas.getContext("webgl2")!;
		const result = new Uint8Array(4);
		api.app!.render();
		gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, result);
		return [...result];
	});
	expect(pixels).toEqual([0, 0, 0, 255]);
	// Reopening keeps the same semantic mask key, but must create and compose
	// a new source/renderer rather than displaying an old or unmasked texture.
	for (let cycle = 0; cycle < 3; cycle++) {
		await page.evaluate(() =>
			Object.assign(window, { previousPreview: window.performancePreview.api!.app }),
		);
		await page.getByRole("button", { name: "Remount preview", exact: true }).click();
		await expect
			.poll(() =>
				page.evaluate(() => {
					const api = window.performancePreview.api;
					return Boolean(
						api?.app &&
							api.app !==
								(window as unknown as { previousPreview: unknown })
									.previousPreview &&
							api.videoSprite?.visible &&
							!api.video?.seeking &&
							api.composedFrame,
					);
				}),
			)
			.toBe(true);
		const reopened = await page.evaluate(() => {
			const api = window.performancePreview.api!;
			const canvas = api.app!.canvas as HTMLCanvasElement;
			const gl = canvas.getContext("webgl2")!;
			const result = new Uint8Array(4);
			api.app!.render();
			gl.readPixels(
				canvas.width / 2,
				canvas.height / 2,
				1,
				1,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				result,
			);
			return [...result];
		});
		expect(reopened).toEqual([0, 0, 0, 255]);
	}
});
