import { expect, test } from "@playwright/test";

test("glass rim has the same light direction and opacity in CSS and export at every shape", async ({
	page,
}, info) => {
	await page.goto("/tests/ui/webcam-edge.html");
	const results = await page.evaluate(async () => {
		const modulePath = "/src/components/video-editor/webcamGlassRim.ts";
		const { drawWebcamGlassRim, getWebcamGlassRimImage } = await import(
			/* @vite-ignore */ modulePath
		);
		const results = [];
		for (const shape of ["circle", "squircle", "rectangle"]) {
			const width = 240;
			const height = shape === "rectangle" ? 160 : 240;
			const radius = shape === "circle" ? 120 : height * 0.25;
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d")!;
			drawWebcamGlassRim(ctx, width, height, radius, shape);
			const css = document.createElement("canvas");
			css.width = width;
			css.height = height;
			const cssCtx = css.getContext("2d")!;
			const image = new Image();
			image.src = getWebcamGlassRimImage(width, height, radius, shape).slice(5, -2);
			await image.decode();
			cssCtx.drawImage(image, 0, 0);
			const points = [
				[width / 2, 1],
				[1, height / 2],
				[width - 2, height / 2],
				[width / 2, height - 2],
			];
			results.push({
				shape,
				edges: points.map(([x, y]) => ({
					canvas: Array.from(ctx.getImageData(x, y, 1, 1).data),
					css: Array.from(cssCtx.getImageData(x, y, 1, 1).data),
				})),
				center: Array.from(ctx.getImageData(width / 2, height / 2, 1, 1).data),
			});
			for (const output of [css, canvas]) {
				output.style.background = "#707b8e";
				output.dataset.shape = shape;
				document.body.append(output);
			}
		}
		return results;
	});
	for (const result of results) {
		expect(result.center).toEqual([0, 0, 0, 0]);
		for (const edge of result.edges) {
			expect(edge.canvas[3]).toBeGreaterThan(0);
			for (let channel = 0; channel < 4; channel++)
				expect(
					Math.abs(edge.canvas[channel] - edge.css[channel]),
					`${result.shape} channel ${channel}`,
				).toBeLessThanOrEqual(3);
		}
	}
	await page.screenshot({ path: info.outputPath("glass-rim-css-export.png"), fullPage: true });
});
