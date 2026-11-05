import { expect, test } from "@playwright/test";

for (const effect of ["echo", "spotlight", "burst"] as const)
	test(`preview and canvas export ${effect === "burst" ? "burst from the original click point" : `keep held ${effect} on the moving cursor until release`}`, async ({
		page,
	}) => {
		await page.route("**/cursor-hold-audit.html", (route) =>
			route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
		);
		await page.goto("/cursor-hold-audit.html");
		const frames = await page.evaluate(async (effect) => {
			const renderer = await import(
				"/src/components/video-editor/videoPlayback/cursorRenderer.ts"
			);
			await renderer.preloadCursorAssets();
			const { Application } = await import("/tests/ui/pixiAudit.ts");
			const app = new Application();
			await app.init({ width: 800, height: 400, backgroundAlpha: 0, resolution: 1 });
			const config = {
				...renderer.DEFAULT_CURSOR_CONFIG,
				style: "dot",
				dotRadius: 80,
				clickEffect: effect,
				clickEffectColor: "#ff0000",
				clickEffectOpacity: 1,
			};
			const samples =
				effect === "burst"
					? [
							{
								timeMs: 0,
								cx: 0.2,
								cy: 0.5,
								interactionType: "click",
								mouseButton: 1,
							},
							{ timeMs: 60, cx: 0.5, cy: 0.5, interactionType: "move" },
							{
								timeMs: 100,
								cx: 0.8,
								cy: 0.5,
								interactionType: "mouseup",
								mouseButton: 1,
							},
							{ timeMs: 400, cx: 0.8, cy: 0.5, interactionType: "move" },
						]
					: [
							{
								timeMs: 0,
								cx: 0.2,
								cy: 0.5,
								interactionType: "click",
								mouseButton: 1,
							},
							{ timeMs: 2000, cx: 0.5, cy: 0.5, interactionType: "move" },
							{
								timeMs: 4000,
								cx: 0.8,
								cy: 0.5,
								interactionType: "mouseup",
								mouseButton: 1,
							},
							{ timeMs: 6000, cx: 0.8, cy: 0.5, interactionType: "move" },
						];
			const viewport = { x: 0, y: 0, width: 800, height: 400 };
			const overlay = new renderer.PixiCursorOverlay(config);
			app.stage.addChild(overlay.container);
			function redBounds(canvas: HTMLCanvasElement) {
				const ctx = canvas.getContext("2d")!;
				const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
				let count = 0,
					xSum = 0;
				for (let y = 0; y < canvas.height; y++)
					for (let x = 0; x < canvas.width; x++) {
						const i = (y * canvas.width + x) * 4;
						if (
							pixels[i] > 180 &&
							pixels[i + 1] < 90 &&
							pixels[i + 2] < 90 &&
							pixels[i + 3] > 20
						) {
							count++;
							xSum += x;
						}
					}
				return { count, x: count ? xSum / count : null };
			}
			const results = [];
			for (const time of effect === "burst"
				? [30, 90, 180, 350, 90]
				: [2000, 3000, 5000, 2000]) {
				overlay.update(samples, time, viewport, true, true);
				app.render();
				const preview = document.createElement("canvas");
				preview.width = 800;
				preview.height = 400;
				preview.getContext("2d")!.drawImage(app.canvas, 0, 0);
				const canvas = document.createElement("canvas");
				canvas.width = 800;
				canvas.height = 400;
				renderer.drawCursorOnCanvas(
					canvas.getContext("2d")!,
					samples,
					time,
					viewport,
					new renderer.SmoothedCursorState(config),
					config,
				);
				results.push({ time, preview: redBounds(preview), exported: redBounds(canvas) });
			}
			overlay.destroy();
			app.destroy(true);
			return results;
		}, effect);
		for (const frame of frames)
			for (const result of [frame.preview, frame.exported]) {
				if (frame.time === 5000 || (effect === "burst" && frame.time === 350))
					expect(result.count).toBe(0);
				else {
					expect(result.count, JSON.stringify(frames)).toBeGreaterThan(10);
					expect(result.x, JSON.stringify(frames)).toBeCloseTo(
						effect === "burst" ? 160 : frame.time === 2000 ? 400 : 520,
						-1,
					);
				}
			}
	});
