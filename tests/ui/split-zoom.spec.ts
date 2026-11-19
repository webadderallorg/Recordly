import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const action of ["button", "shortcut"] as const) {
	test(`splitting with the ${action} splits zooms and preserves them through undo, redo and save`, async ({
		page,
	}) => {
		test.setTimeout(90000);
		await installDesktopBridge(page, "filmstrip.mp4");
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.loadCurrentProjectFile = async () => ({
				success: true,
				path: "/projects/split-zoom.recordly",
				project: {
					version: 2,
					videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
					editor: {
						clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000, speed: 1 }],
						zoomRegions: [
							{
								id: "zoom-1",
								startMs: 1000,
								endMs: 5000,
								depth: 3,
								focus: { cx: 0.4, cy: 0.6 },
								focusSpace: "viewport",
								mode: "manual",
							},
						],
					},
				},
			});
			window.electronAPI.onMenuSaveProject = (callback) => {
				const handler = async () => {
					await callback();
					sessionStorage.setItem("test-save-split-complete", "true");
				};
				window.addEventListener("test-save-split-zoom", handler);
				return () => window.removeEventListener("test-save-split-zoom", handler);
			};
			window.electronAPI.saveProjectFile = async (project) => {
				sessionStorage.setItem("test-split-zoom", JSON.stringify(project.editor));
				return { success: true, path: "/projects/split-zoom.recordly" };
			};
		});
		await page.goto("/?windowType=editor");
		const clips = page.locator('[data-variant="clip"]');
		const zooms = page.locator('[data-variant="zoom"]');
		await expect(clips).toHaveAttribute("data-end-ms", "6000", { timeout: 30000 });
		await expect(zooms).toHaveCount(1);
		await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 60000 });
		await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, {
			timeout: 60000,
		});
		const block = (await clips.locator(".timeline-block").boundingBox())!;
		const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
		await page.mouse.click(block.x + block.width / 2, row.y - 8);
		if (action === "button") {
			await page.getByRole("button", { name: /^Split Clip \(/ }).click();
		} else {
			await page.getByTestId("timeline-scroll").focus();
			await page.keyboard.press("Meta+b");
		}
		await expect(clips).toHaveCount(2);
		await expect(zooms).toHaveCount(2);
		await expect(zooms.first()).toHaveAttribute("data-stored-end-ms", "3000");
		await expect(zooms.nth(1)).toHaveAttribute("data-start-ms", "3000");
		await page.keyboard.press("Meta+z");
		await expect(clips).toHaveCount(1);
		await expect(zooms).toHaveCount(1);
		await expect(zooms).toHaveAttribute("data-stored-end-ms", "5000");
		await page.keyboard.press("Meta+Shift+z");
		await expect(clips).toHaveCount(2);
		await expect(zooms).toHaveCount(2);
		await page.evaluate(() => {
			sessionStorage.removeItem("test-split-zoom");
			sessionStorage.removeItem("test-save-split-complete");
			window.dispatchEvent(new Event("test-save-split-zoom"));
		});
		await expect
			.poll(() => page.evaluate(() => sessionStorage.getItem("test-save-split-complete")))
			.toBe("true");
		const editor = await page.evaluate(() =>
			JSON.parse(sessionStorage.getItem("test-split-zoom")!),
		);
		expect(editor.zoomRegions).toEqual([
			{
				id: "zoom-1",
				startMs: 1000,
				endMs: 3000,
				depth: 3,
				focus: { cx: 0.4, cy: 0.6 },
				focusSpace: "viewport",
				mode: "manual",
			},
			{
				id: "zoom-2",
				startMs: 3000,
				endMs: 5000,
				depth: 3,
				focus: { cx: 0.4, cy: 0.6 },
				focusSpace: "viewport",
				mode: "manual",
			},
		]);
	});
}
