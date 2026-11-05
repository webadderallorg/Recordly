import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/merge.recordly",
			project: {
				version: 2,
				videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
				editor: {
					clipRegions: [0, 1, 2].map((i) => ({
						id: `clip-${i + 1}`,
						startMs: i * 2000,
						endMs: (i + 1) * 2000,
						sourceStartMs:
							i * 2000 +
							(location.search.includes("incompatible") && i === 1 ? 500 : 0),
						speed: 1,
					})),
					zoomRegions: [
						{
							id: "zoom-1",
							startMs: 500,
							endMs: 1500,
							depth: 2,
							focus: { cx: 0.5, cy: 0.5 },
						},
					],
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(3, { timeout: 30000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, {
		timeout: 30000,
	});
});

test("Shift-click selects a clip range, merges it, and supports undo and redo", async ({
	page,
}, testInfo) => {
	const clips = page.locator('[data-variant="clip"]');
	const selected = page.locator('[data-variant="clip"][data-selected="true"]');
	await clips.first().locator(".timeline-block").click();
	await expect(selected).toHaveCount(1);
	await clips
		.last()
		.locator(".timeline-block")
		.click({ modifiers: ["Shift"] });
	await expect(selected).toHaveCount(3);
	await page.screenshot({ path: testInfo.outputPath("shift-selection.png") });
	const merge = page.getByText("Merge clips", { exact: true });
	await expect(merge).toBeEnabled();
	await merge.click();
	await expect(clips).toHaveCount(1);
	await expect(clips).toHaveAttribute("data-start-ms", "0");
	await expect(clips).toHaveAttribute("data-end-ms", "6000");
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveAttribute("data-start-ms", "500");
	await expect(zoom).toHaveAttribute("data-stored-end-ms", "1500");
	await page.getByTestId("timeline-scroll").focus();
	await page.keyboard.press("Meta+z");
	await expect(clips).toHaveCount(3);
	await page.keyboard.press("Meta+Shift+z");
	await expect(clips).toHaveCount(1);
});

test("a plain click clears the range and reverse Shift selection includes intermediate clips", async ({
	page,
}) => {
	const clips = page.locator('[data-variant="clip"]');
	const selected = page.locator('[data-variant="clip"][data-selected="true"]');
	await clips.last().locator(".timeline-block").click();
	await clips
		.first()
		.locator(".timeline-block")
		.click({ modifiers: ["Shift"] });
	await expect(selected).toHaveCount(3);
	await clips.nth(1).locator(".timeline-block").click();
	await expect(selected).toHaveCount(1);
	await expect(page.getByText("Merge clips", { exact: true })).toHaveCount(0);
	await clips
		.last()
		.locator(".timeline-block")
		.click({ modifiers: ["Shift"] });
	await expect(selected).toHaveCount(2);
	await page.getByText("Merge clips", { exact: true }).click();
	await expect(clips).toHaveCount(2);
	await expect(clips.first()).toHaveAttribute("data-end-ms", "2000");
	await expect(clips.last()).toHaveAttribute("data-end-ms", "6000");
});

test("merge is disabled when selected footage is discontinuous", async ({ page }) => {
	await page.goto("/?windowType=editor&incompatible=1");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(3);
	await clips.first().locator(".timeline-block").click();
	await clips
		.last()
		.locator(".timeline-block")
		.click({ modifiers: ["Shift"] });
	await expect(page.locator('[data-variant="clip"][data-selected="true"]')).toHaveCount(3);
	await expect(page.getByText("Merge clips", { exact: true })).toBeDisabled();
	await expect(page.getByText("Merge clips", { exact: true }).locator("..")).toHaveAttribute(
		"title",
		/continuous footage/,
	);
	// Selecting a different track clears the range; it must not return on reselect.
	await page.locator('[data-variant="zoom"] .timeline-block').click();
	await expect(page.getByText("Merge clips", { exact: true })).toHaveCount(0);
	await clips.last().locator(".timeline-block").click();
	await expect(page.locator('[data-variant="clip"][data-selected="true"]')).toHaveCount(1);
});
