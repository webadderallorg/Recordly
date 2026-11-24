import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("copy/paste and the duplicate shortcut copy regions without trimming them", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const videoPath = location.origin + "/tests/ui/fixtures/filmstrip.mp4";
		const zoom = (id: string, startMs: number, endMs: number) => ({
			id,
			startMs,
			endMs,
			depth: 3,
			mode: "manual",
			focus: { cx: 0.4, cy: 0.5 },
		});
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/duplicate.recordly",
			project: {
				version: 2,
				videoPath,
				editor: {
					clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000, speed: 1 }],
					zoomRegions: [
						zoom("zoom-1", 500, 1500),
						zoom("zoom-2", 1500, 2400),
						zoom("zoom-3", 5300, 6000),
					],
					annotationRegions: [
						{
							id: "annotation-1",
							startMs: 2000,
							endMs: 3000,
							type: "text",
							content: "Copy this note",
							position: { x: 22, y: 25 },
						},
					],
					audioRegions: [
						{
							id: "audio-1",
							startMs: 800,
							endMs: 1600,
							audioPath: videoPath,
							volume: 0.45,
							normalize: true,
							trackIndex: 0,
						},
						{
							id: "audio-2",
							startMs: 1600,
							endMs: 2400,
							audioPath: videoPath,
							volume: 0.7,
							trackIndex: 0,
						},
					],
				},
			},
		});
		window.electronAPI.onMenuSaveProject = (callback) => {
			const save = () => void callback();
			window.addEventListener("test-save-duplicate", save);
			return () => window.removeEventListener("test-save-duplicate", save);
		};
		window.electronAPI.saveProjectFile = async (project) => {
			sessionStorage.setItem("test-duplicate-editor", JSON.stringify(project.editor));
			return { success: true, path: "/projects/duplicate.recordly" };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 45000 });
	const zooms = page.locator('[data-variant="zoom"]');
	const annotations = page.locator('[data-variant="annotation"]');
	const audio = page.locator('[data-variant="audio"]');
	const copyPaste = async () => {
		await page.keyboard.press("Control+c");
		await page.keyboard.press("Control+v");
	};
	await expect(page.getByRole("button", { name: "Duplicate Selected" })).toHaveCount(0);
	await expect(zooms).toHaveCount(3);
	await zooms.and(page.locator('[data-start-ms="500"]')).click();
	await copyPaste();
	await expect(zooms.and(page.locator('[data-start-ms="2400"][data-end-ms="3400"]'))).toHaveCount(
		1,
	);
	await zooms.and(page.locator('[data-start-ms="5300"]')).click();
	await copyPaste();
	await expect(page.getByText("There is no room to duplicate this item.")).toBeVisible();
	await expect(zooms).toHaveCount(4);

	await annotations.first().click();
	await page.keyboard.press("Control+Shift+d");
	await expect(
		annotations.and(page.locator('[data-start-ms="3000"][data-end-ms="4000"]')),
	).toHaveCount(1);

	await audio.and(page.locator('[data-start-ms="800"]')).click();
	await copyPaste();
	const audioCopy = audio.and(page.locator('[data-start-ms="2400"][data-end-ms="3200"]'));
	await expect(audioCopy).toHaveCount(1);
	await page.keyboard.press("Control+z");
	await expect(audio).toHaveCount(2);
	await page.keyboard.press("Control+Shift+z");
	await expect(audioCopy).toHaveCount(1);

	await page.evaluate(() => {
		sessionStorage.removeItem("test-duplicate-editor");
		window.dispatchEvent(new Event("test-save-duplicate"));
	});
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem("test-duplicate-editor")))
		.not.toBeNull();
	const saved = await page.evaluate(() =>
		JSON.parse(sessionStorage.getItem("test-duplicate-editor")!),
	);
	expect(saved.zoomRegions).toContainEqual(
		expect.objectContaining({ startMs: 2400, endMs: 3400, mode: "manual", depth: 3 }),
	);
	expect(saved.annotationRegions).toContainEqual(
		expect.objectContaining({
			startMs: 3000,
			endMs: 4000,
			content: "Copy this note",
			position: { x: 22, y: 25 },
		}),
	);
	expect(saved.audioRegions).toContainEqual(
		expect.objectContaining({
			startMs: 2400,
			endMs: 3200,
			volume: 0.45,
			normalize: true,
			trackIndex: 0,
		}),
	);
});
