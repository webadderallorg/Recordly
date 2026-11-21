import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("an edge zoom keeps the recording in view on a square canvas", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/square-zoom.recordly",
			project: {
				version: 2,
				videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
				editor: {
					aspectRatio: "1:1",
					wallpaper: "#eb15bb",
					padding: 0,
					borderRadius: 0,
					clipRegions: [{ id: "screen", startMs: 0, endMs: 6000, speed: 1 }],
					zoomRegions: [
						{
							id: "edge-zoom",
							startMs: 1000,
							endMs: 5500,
							depth: 4,
							mode: "manual",
							focus: { cx: 0.5, cy: 0.02 },
						},
					],
					zoomClassicMode: true,
					zoomMotionBlur: 0,
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 20000 });
	const preview = page.locator(".editor-preview-frame canvas").first();
	const topPixel = async () => {
		const png = await preview.screenshot();
		return page.evaluate(async (source) => {
			const image = new Image();
			image.src = `data:image/png;base64,${source}`;
			await image.decode();
			const sample = document.createElement("canvas").getContext("2d")!;
			sample.drawImage(
				image,
				Math.floor(image.width / 2),
				Math.floor(image.height * 0.07),
				1,
				1,
				0,
				0,
				1,
				1,
			);
			return [...sample.getImageData(0, 0, 1, 1).data.slice(0, 3)];
		}, png.toString("base64"));
	};
	const wallpaper = [235, 21, 187];
	await expect.poll(topPixel).toEqual(wallpaper);
	const clip = (await page.locator('[data-variant="clip"] .timeline-block').boundingBox())!;
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(clip.x + clip.width * 0.5, row.y - 8);
	await expect(page.getByTestId("playhead-cap")).toHaveAttribute("aria-label", "Playhead 3.0s");
	await expect.poll(topPixel).not.toEqual(wallpaper);
});
