import { expect, type Locator, test } from "@playwright/test";

async function activePixels(canvas: Locator) {
	return canvas.evaluate((node: HTMLCanvasElement) => {
		const ratio = node.width / node.getBoundingClientRect().width;
		const row = node
			.getContext("2d")!
			.getImageData(0, Math.round(10 * ratio), node.width, 1).data;
		return Array.from({ length: row.length / 4 }, (_, i) => row[i * 4 + 3]).flatMap(
			(alpha, i) => (alpha > 0 ? [i / ratio] : []),
		);
	});
}

test("keeps the panned waveform aligned to the visible audio", async ({ page }) => {
	await page.goto("/tests/ui/waveform-viewport.html");
	await expect.poll(() => activePixels(page.locator("#panned canvas"))).toContain(59);
});

test("retains a transient between the samples used for screen pixels", async ({ page }) => {
	await page.goto("/tests/ui/waveform-viewport.html");
	await expect.poll(() => activePixels(page.locator("#zoomed canvas"))).toContain(0);
});

test("maps a trimmed, double-speed segment to its source audio", async ({ page }) => {
	await page.goto("/tests/ui/waveform-viewport.html");
	const canvas = page.locator("#trimmed canvas");
	await expect.poll(() => activePixels(canvas)).toContain(25);
	expect(await activePixels(canvas)).not.toContain(65);
});
