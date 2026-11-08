import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Read the shipped gallery itself so new presets receive the same export check.
const gallerySource = readFileSync(
	"src/components/video-editor/settings/backgroundPresets.ts",
	"utf8",
);
const presetSource = gallerySource.match(/const GRADIENTS = \[([\s\S]*?)\];/)![1];
const presets = [...presetSource.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

test("all shipped gradient backgrounds survive both renderers and match the CSS preview", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.goto("/tests/ui/export-gradient-backgrounds.html");
	await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
	const results = await page.evaluate(async (presets) => {
		return (
			window as unknown as {
				renderGradientBackgrounds(presets: string[]): Promise<
					Array<{
						wallpaper: string;
						supported: boolean;
						helper: Record<number, number>;
						legacy: Record<number, number>;
						modern: Record<number, number>;
					}>
				>;
			}
		).renderGradientBackgrounds(presets);
	}, presets);
	const reference = await page
		.locator("#reference")
		.screenshot({ path: testInfo.outputPath("all-gradient-css-previews.png") });
	const previewPixels = await page.evaluate(
		async ({ bytes, presetCount }) => {
			const bitmap = await createImageBitmap(
				new Blob([new Uint8Array(bytes)], { type: "image/png" }),
			);
			const canvas = document.createElement("canvas");
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const ctx = canvas.getContext("2d")!;
			ctx.drawImage(bitmap, 0, 0);
			bitmap.close();
			const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			const pixels: Record<number, number> = {};
			for (let index = 0; index < presetCount; index++)
				for (const x of [10, 40, 80, 120, 150])
					for (const y of [10, 30, 60, 80])
						for (let channel = 0; channel < 4; channel++) {
							const offset = ((index * 90 + y) * canvas.width + x) * 4 + channel;
							pixels[offset] = data[offset];
						}
			return { width: canvas.width, pixels };
		},
		{ bytes: [...reference], presetCount: presets.length },
	);
	expect(results).toHaveLength(presets.length);
	const differences = results.map((result, index) => {
		expect(result.supported, result.wallpaper).toBe(true);
		let maximum = 0;
		let worst = "";
		for (const backend of ["helper", "legacy", "modern"] as const) {
			for (const x of [10, 40, 80, 120, 150])
				for (const y of [10, 30, 60, 80]) {
					const expectedOffset = ((index * 90 + y) * previewPixels.width + x) * 4;
					const actualOffset = (y * 160 + x) * 4;
					for (let channel = 0; channel < 4; channel++) {
						const expected = previewPixels.pixels[expectedOffset + channel];
						const actual = result[backend][actualOffset + channel];
						if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
							throw new Error(
								`${backend} (${x},${y}) channel${channel}: missing finite sample (${actual} vs CSS ${expected})`,
							);
						}
						const difference = Math.abs(actual - expected);
						if (difference > maximum) {
							maximum = difference;
							worst = `${backend} (${x},${y}) channel${channel}: ${actual} vs CSS ${expected}`;
						}
					}
				}
		}
		return { preset: index + 1, maximum, worst };
	});
	expect(differences.filter((result) => result.maximum > 3)).toEqual([]);
	expect(errors).toEqual([]);
});
