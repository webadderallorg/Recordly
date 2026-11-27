import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("preview zoom keeps rendering while a modern MP4 export is active", async ({ page }) => {
	test.setTimeout(60_000);
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/export-preview.recordly",
			project: {
				version: 2,
				videoPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				editor: {
					clipRegions: [{ id: "clip", startMs: 0, endMs: 6000, speed: 1 }],
					zoomRegions: [
						{
							id: "zoom",
							startMs: 1200,
							endMs: 5200,
							depth: 4,
							mode: "manual",
							focus: { cx: 0.5, cy: 0.5 },
						},
					],
					annotationRegions: [
						{
							id: "note",
							startMs: 0,
							endMs: 6000,
							type: "text",
							content: "Preview zoom",
							position: { x: 50, y: 50 },
						},
					],
				},
			},
		});
		window.electronAPI.nativeVideoExportStart = () => {
			document.documentElement.dataset.encoderWaiting = "true";
			return new Promise(() => {
				// Keep the export active until the preview assertions finish.
			});
		};
	});
	await page.goto("/?windowType=editor");
	const annotation = page.locator('[data-annotation-id="note"]');
	await expect(annotation).toBeVisible({ timeout: 20_000 });
	const initialWidth = (await annotation.boundingBox())!.width;

	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("row", { name: "Save to device", exact: true }).click();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-encoder-waiting", "true");
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(async () => (await annotation.boundingBox())?.width ?? 0)
		.toBeGreaterThan(initialWidth * 1.3);
	await expect(page.getByRole("progressbar", { name: "Exporting", exact: true })).toBeVisible();
});

test("new text and masks stay inside the visible preview during a corner-focused zoom", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/zoom-annotations.recordly",
			project: {
				version: 2,
				videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
				editor: {
					clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000, speed: 1 }],
					zoomRegions: [
						{
							id: "zoom-1",
							startMs: 0,
							endMs: 6000,
							depth: 6,
							mode: "manual",
							focus: { cx: 0.15, cy: 0.15 },
						},
					],
					annotationRegions: [],
					zoomClassicMode: true,
					padding: 0,
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 20000 });
	const clip = (await page.locator('[data-variant="clip"] .timeline-block').boundingBox())!;
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(clip.x + clip.width * 0.5, row.y - 8);
	await expect(page.getByTestId("playhead-cap")).toHaveAttribute("aria-label", "Playhead 3.0s");
	for (const [index, tool] of ["Text", "Mask"].entries()) {
		await page
			.getByRole("toolbar", { name: "Annotation tools" })
			.getByRole("button", { name: tool, exact: true })
			.click();
		const item = page.locator("[data-annotation-id]").nth(index);
		await expect(item).toBeVisible();
		const frame = (await page.locator(".editor-preview-frame").boundingBox())!;
		const box = (await item.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(frame.x);
		expect(box.y).toBeGreaterThanOrEqual(frame.y);
		expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
		expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
		await expect(page.locator('[data-variant="annotation"]').nth(index)).toHaveAttribute(
			"data-start-ms",
			"3000",
		);
	}
	await expect(page.locator("[data-blur-redaction]")).toBeVisible();
	// Selecting an interval outside the current playhead also brings its effect into view.
	await page.getByRole("button", { name: "Skip Back", exact: true }).click();
	await expect(page.locator("[data-blur-redaction]")).toHaveCount(0);
	await page.locator('[data-variant="annotation"]').last().click();
	await expect(page.locator("[data-blur-redaction]")).toBeVisible();
	await expect(page.getByTestId("playhead-cap")).toHaveAttribute("aria-label", "Playhead 3.0s");
	await page.screenshot({
		path: "test-results/annotation-zoom-visible.png",
		animations: "disabled",
	});
});
