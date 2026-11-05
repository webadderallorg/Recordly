import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const { name, sourceStartMs, speed, sourceMaxMs, trimmedEnd, fullEnd } of [
	{
		name: "normal speed",
		sourceStartMs: 0,
		speed: 1,
		sourceMaxMs: 6000,
		trimmedEnd: 750,
		fullEnd: 6000,
	},
	{
		name: "double speed with a source cut boundary",
		sourceStartMs: 1000,
		speed: 2,
		sourceMaxMs: 5000,
		trimmedEnd: 250,
		fullEnd: 2000,
	},
]) {
	test(`a trimmed clip extends in one held edge drag: ${name}`, async ({ page }) => {
		test.setTimeout(60000);
		await installDesktopBridge(page, "filmstrip.mp4");
		await installDesktopBridgeOverrides(
			page,
			({ sourceStartMs, speed, sourceMaxMs, trimmedEnd }) => {
				window.electronAPI.loadCurrentProjectFile = async () => ({
					success: true,
					path: "/projects/edge-scroll.recordly",
					project: {
						version: 2,
						videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
						editor: {
							clipRegions: [
								{
									id: "clip-1",
									startMs: 0,
									endMs: trimmedEnd,
									sourceStartMs,
									sourceMaxMs,
									speed,
								},
							],
							zoomRegions: [],
							annotationRegions: [],
						},
					},
				});
			},
			{ sourceStartMs, speed, sourceMaxMs, trimmedEnd },
		);
		await page.goto("/?windowType=editor");
		const clip = page.locator('[data-timeline-item][data-variant="clip"]');
		await expect(clip).toHaveAttribute("data-end-ms", String(trimmedEnd), { timeout: 30000 });
		const box = (await clip.boundingBox())!;
		const x = box.x + box.width - 2;
		const y = box.y + 20;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 8, y, { steps: 4 });
		// No more pointer moves: the timeline must continue revealing source time.
		await expect
			.poll(
				async () => {
					const tooltip = page.locator("[data-clip-resize-tooltip]");
					return tooltip.textContent();
				},
				{ timeout: 15000 },
			)
			.toBe(`0.0s – ${(fullEnd / 1000).toFixed(1)}s`);
		// The edit is committed once, on release.
		await expect(clip).toHaveAttribute("data-end-ms", String(trimmedEnd));
		await page.mouse.up();
		await expect(clip).toHaveAttribute("data-end-ms", String(fullEnd));
		await page.keyboard.press("Meta+z");
		await expect(clip).toHaveAttribute("data-end-ms", String(trimmedEnd));
		await page.keyboard.press("Meta+Shift+z");
		await expect(clip).toHaveAttribute("data-end-ms", String(fullEnd));
	});
}

test("Escape cancels a held right-edge resize without changing the clip", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clip = page.locator('[data-timeline-item][data-variant="clip"]');
	await expect(clip).toHaveAttribute("data-end-ms", "6000", { timeout: 30000 });
	const box = (await clip.boundingBox())!;
	const x = box.x + box.width - 2;
	const y = box.y + 20;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 100, y, { steps: 8 });
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(clip).toHaveAttribute("data-end-ms", "6000");
	await expect.poll(async () => (await clip.boundingBox())!.width).toBeCloseTo(box.width, 0);
});
