import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.setTimeout(60000);

async function loadClipProject(page: Page, threeClips: boolean) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(
		page,
		({ threeClips }) => {
			const editor = {
				clipRegions: threeClips
					? [0, 1, 2].map((index) => ({
							id: `clip-${index + 1}`,
							startMs: index * 2000,
							endMs: (index + 1) * 2000,
							speed: 1,
						}))
					: [{ id: "clip-1", startMs: 0, endMs: 6000, speed: 1 }],
				zoomRegions: threeClips
					? [
							{
								id: "zoom-1",
								startMs: 1000,
								endMs: 3000,
								depth: 2,
								focus: { cx: 0.5, cy: 0.5 },
							},
						]
					: [],
				annotationRegions: threeClips
					? [
							{
								id: "annotation-1",
								startMs: 1000,
								endMs: 3000,
								type: "text",
								content: "Attached",
							},
						]
					: [],
				sourceAudioTrackSettingsByClip: {
					"clip-1": { mixed: { volume: 0, normalize: true } },
				},
				defaultSourceAudioTrackSettings: { mixed: { volume: 0.8, normalize: false } },
			};
			window.electronAPI.loadCurrentProjectFile = async () => ({
				success: true,
				path: "/projects/clip-regression.recordly",
				project: {
					version: 2,
					videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
					editor,
				},
			});
			window.electronAPI.onMenuSaveProject = (callback) => {
				const handler = () => {
					void callback();
				};
				window.addEventListener("test-save-clips", handler);
				return () => window.removeEventListener("test-save-clips", handler);
			};
			window.electronAPI.saveProjectFile = async (project) => {
				sessionStorage.setItem("test-clip-editor", JSON.stringify(project.editor));
				return { success: true, path: "/projects/clip-regression.recordly" };
			};
		},
		{ threeClips },
	);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(threeClips ? 3 : 1, {
		timeout: 30000,
	});
	await expect(page.locator('[data-variant="clip"]').last()).toHaveAttribute(
		"data-end-ms",
		"6000",
	);
}

async function savedEditor(page: Page) {
	await page.evaluate(() => {
		sessionStorage.removeItem("test-clip-editor");
		window.dispatchEvent(new Event("test-save-clips"));
	});
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem("test-clip-editor")))
		.not.toBeNull();
	return page.evaluate(() => JSON.parse(sessionStorage.getItem("test-clip-editor")!));
}

test("split, undo and redo preserve silenced source tracks on both halves", async ({ page }) => {
	await loadClipProject(page, false);
	const clips = page.locator('[data-variant="clip"]');
	await clips.first().click();
	const body = (await clips.first().locator(".timeline-block").boundingBox())!;
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(body.x + body.width / 2, row.y - 8);
	await page.getByRole("button", { name: /^Split Clip \(/ }).click();
	await expect(clips).toHaveCount(2);
	const split = await savedEditor(page);
	for (const clip of split.clipRegions) {
		expect(split.sourceAudioTrackSettingsByClip[clip.id].mixed).toEqual({
			volume: 0,
			normalize: true,
		});
	}
	await page.keyboard.press("Meta+z");
	await expect(clips).toHaveCount(1);
	const undone = await savedEditor(page);
	expect(undone.sourceAudioTrackSettingsByClip).toEqual({
		"clip-1": { mixed: { volume: 0, normalize: true } },
	});
	await page.keyboard.press("Meta+Shift+z");
	await expect(clips).toHaveCount(2);
	const redone = await savedEditor(page);
	expect(redone.sourceAudioTrackSettingsByClip).toEqual(split.sourceAudioTrackSettingsByClip);
});

test("reordering preserves disconnected zoom and annotation pieces through undo and save", async ({
	page,
}) => {
	await loadClipProject(page, true);
	const clips = page.locator('[data-variant="clip"]');
	const third = (await clips.nth(2).boundingBox())!;
	const second = (await clips.nth(1).boundingBox())!;
	await page.mouse.move(third.x + third.width / 2, third.y + 20);
	await page.mouse.down();
	await page.mouse.move(second.x + second.width / 2 - 15, second.y + 20, { steps: 16 });
	await page.mouse.up();
	const zooms = page.locator('[data-variant="zoom"]');
	const annotations = page.locator('[data-variant="annotation"]');
	await expect(zooms).toHaveCount(2);
	await expect(annotations).toHaveCount(2);
	const edited = await savedEditor(page);
	expect(edited.clipRegions.map((clip: { id: string }) => clip.id)).toEqual([
		"clip-1",
		"clip-3",
		"clip-2",
	]);
	for (const regions of [edited.zoomRegions, edited.annotationRegions]) {
		expect(
			regions.map(({ startMs, endMs }: { startMs: number; endMs: number }) => [
				startMs,
				endMs,
			]),
		).toEqual([
			[1000, 2000],
			[4000, 5000],
		]);
		expect(new Set(regions.map((region: { id: string }) => region.id)).size).toBe(2);
	}
	await page.keyboard.press("Meta+z");
	await expect(zooms).toHaveCount(1);
	await expect(annotations).toHaveCount(1);
	await page.keyboard.press("Meta+Shift+z");
	await expect(zooms).toHaveCount(2);
	await expect(annotations).toHaveCount(2);
	expect((await savedEditor(page)).zoomRegions).toEqual(edited.zoomRegions);
});
