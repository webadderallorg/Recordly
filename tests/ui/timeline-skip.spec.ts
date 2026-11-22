import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("preview skip buttons visit zooms, clip boundaries, and markers in timeline order", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/timeline-skip.recordly",
			project: {
				version: 2,
				videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
				editor: {
					clipRegions: [
						{ id: "clip-1", startMs: 0, endMs: 2500, speed: 2 },
						{ id: "clip-2", startMs: 2500, endMs: 6000, sourceStartMs: 200, speed: 1 },
					],
					zoomRegions: [
						{
							id: "zoom-1",
							startMs: 1000,
							endMs: 2000,
							depth: 2,
							mode: "manual",
							focus: { cx: 0.5, cy: 0.5 },
						},
					],
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	const playhead = page.getByTestId("playhead-cap");
	const back = page.getByRole("button", { name: "Skip Back", exact: true });
	const forward = page.getByRole("button", { name: "Skip Forward", exact: true });
	const clips = page.locator('[data-variant="clip"]');
	const video = page.locator('video[aria-hidden="true"]');
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 45000 });
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 0.0s", { timeout: 20000 });
	await expect(clips).toHaveCount(2);

	await forward.click();
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 1.0s");
	await forward.click();
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 2.5s");
	await expect
		.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
		.toBeCloseTo(0.2, 1);
	await forward.click();
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 6.0s");
	await back.click();
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 2.5s");
	await back.click();
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 1.0s");
	await back.click();
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 0.0s");

	await forward.click();
	await forward.click();
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 2.5s");
	await back.click({ modifiers: ["Shift"] });
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 0.0s");

	await forward.click();
	await forward.click();
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 2.5s");
	await back.press("Home");
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 0.0s");

	const secondClip = (await clips.nth(1).locator(".timeline-block").boundingBox())!;
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(secondClip.x + secondClip.width / 2, row.y - 8);
	await expect(playhead).toHaveAttribute("aria-label", /^Playhead 4\.[23]s$/);
	const markerPosition = (await playhead.getAttribute("aria-label"))!;
	await page.keyboard.press("f");
	await expect(page.getByTitle(/^Keyframe @ /)).toHaveCount(1);
	await back.click();
	await expect(playhead).toHaveAttribute("aria-label", "Playhead 2.5s");
	await forward.click();
	await expect(playhead).toHaveAttribute("aria-label", markerPosition);
});
