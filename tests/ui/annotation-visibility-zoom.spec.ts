import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

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
