import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

// Use actual loaded/rasterized artwork: checking the SVG canvas dimensions misses
// transparent margins and the shadow padding that caused the size mismatch.
test("cursor bodies match across styles and preview/export renderers", async ({ page }) => {
	await page.route("**/cursor-height-audit.html", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><body></body>",
		}),
	);
	await page.goto("/cursor-height-audit.html");
	const measurements = await page.evaluate(async () => {
		const renderer = await import(
			"/src/components/video-editor/videoPlayback/cursorRenderer.ts"
		);
		const sizing = await import(
			"/src/components/video-editor/videoPlayback/uploadedCursorAssets.ts"
		);
		const { Application } = await import("/tests/ui/pixiAudit.ts");
		function bodyHeight(canvas: HTMLCanvasElement) {
			const pixels = canvas
				.getContext("2d")!
				.getImageData(0, 0, canvas.width, canvas.height).data;
			let top = canvas.height;
			let bottom = -1;
			for (let y = 0; y < canvas.height; y++)
				for (let x = 0; x < canvas.width; x++) {
					if (pixels[(y * canvas.width + x) * 4 + 3] >= 128) {
						top = Math.min(top, y);
						bottom = Math.max(bottom, y);
					}
				}
			return bottom - top + 1;
		}
		const app = new Application();
		await app.init({ width: 400, height: 400, backgroundAlpha: 0, resolution: 1 });
		const results: {
			style: string;
			target: number;
			pixi: number;
			canvas: number;
			atlas: number;
		}[] = [];
		for (const style of [
			"macos",
			"tahoe",
			"windows11",
			"dot",
			"figma",
			"bold-outline",
			"pixel-hand",
			"bee",
			"breezex",
			"tahoe-inverted",
			"catppuccin-pink",
		]) {
			const atlas = await renderer.buildNativeCursorAtlas(style);
			const image = new Image();
			image.src = atlas!.dataUrl;
			await image.decode();
			const entry = atlas!.entries[0];
			const tile = document.createElement("canvas");
			tile.width = entry.width;
			tile.height = entry.height;
			tile.getContext("2d")!.drawImage(
				image,
				entry.x,
				entry.y,
				entry.width,
				entry.height,
				0,
				0,
				tile.width,
				tile.height,
			);
			for (const [width, size] of [
				[1920, 28],
				[1920, 84],
				[960, 84],
			]) {
				const target = (size * width) / 1920;
				const config = {
					...renderer.DEFAULT_CURSOR_CONFIG,
					style,
					dotRadius: size,
					clickBounce: 0,
					clickEffect: "none" as const,
				};
				const viewport = { x: 0, y: 0, width, height: 1080 };
				const samples = [{ timeMs: 0, cx: 0.5, cy: 0.5, cursorType: "arrow" as const }];
				const overlay = new renderer.PixiCursorOverlay(config);
				app.stage.addChild(overlay.container);
				overlay.update(samples, 0, viewport, true, true);
				overlay.container.position.set(200 - width / 2, 200 - 540);
				app.render();
				const pixi = app.renderer.extract.canvas(app.stage) as HTMLCanvasElement;
				const canvas = document.createElement("canvas");
				canvas.width = 400;
				canvas.height = 400;
				const ctx = canvas.getContext("2d")!;
				ctx.translate(200 - width / 2, 200 - 540);
				renderer.drawCursorOnCanvas(
					ctx,
					samples,
					0,
					viewport,
					new renderer.SmoothedCursorState(config),
					config,
				);
				results.push({
					style,
					target,
					pixi: bodyHeight(pixi),
					canvas: bodyHeight(canvas),
					atlas:
						(bodyHeight(tile) / entry.height) *
						target *
						sizing.getCursorStyleSizeMultiplier(style),
				});
				overlay.destroy();
			}
		}
		app.destroy(true);
		return results;
	});
	for (const row of measurements) {
		expect(Math.abs(row.pixi - row.target), JSON.stringify(row)).toBeLessThanOrEqual(2);
		expect(Math.abs(row.canvas - row.target), JSON.stringify(row)).toBeLessThanOrEqual(2);
		expect(Math.abs(row.atlas - row.target), JSON.stringify(row)).toBeLessThanOrEqual(1);
		expect(Math.abs(row.pixi - row.canvas), JSON.stringify(row)).toBeLessThanOrEqual(1);
	}
});

test("picker thumbnails have the same visible height using renderer assets", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	const picker = page.getByRole("grid", { name: "Cursor Style", exact: true });
	await expect(picker.locator("img:visible")).toHaveCount(8);
	await expect(picker.getByRole("row", { name: "Bibata Bee", exact: true })).toHaveCount(0);
	const boldOutline = picker.getByRole("row", { name: "Bold Outline", exact: true });
	await boldOutline.click();
	await expect(boldOutline).toHaveAttribute("aria-selected", "true");
	await page.mouse.move(1200, 100);
	const heights = await picker.locator("img:visible").evaluateAll(async (images) =>
		Promise.all(
			images.map(async (element) => {
				const image = element as HTMLImageElement;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const ctx = canvas.getContext("2d")!;
				ctx.drawImage(image, 0, 0);
				const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
				let top = canvas.height;
				let bottom = -1;
				for (let y = 0; y < canvas.height; y++)
					for (let x = 0; x < canvas.width; x++) {
						if (data[(y * canvas.width + x) * 4 + 3] >= 128) {
							top = Math.min(top, y);
							bottom = Math.max(bottom, y);
						}
					}
				return ((bottom - top + 1) / canvas.height) * image.getBoundingClientRect().height;
			}),
		),
	);
	for (const height of heights) expect(height).toBeCloseTo(28, 0);
});
