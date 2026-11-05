import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("undo and redo survive project switching and a renderer restart", async ({ page }) => {
	test.setTimeout(180_000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const storageKey = "test-history-project";
		const path = "/projects/History.recordly";
		let activePath = path;
		const read = () => JSON.parse(localStorage.getItem(storageKey) || "null");
		const save = async (data: unknown) => {
			localStorage.setItem(
				activePath === path ? storageKey : "test-other-project",
				JSON.stringify(data),
			);
			return {
				success: true,
				path: activePath,
				projectId: activePath === path ? "history-project" : "other",
			};
		};
		window.electronAPI.createProjectFile = save;
		window.electronAPI.saveProjectFile = save;
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: !!read(),
			path,
			project: read(),
		});
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: [
				{
					path,
					name: "History",
					updatedAt: Date.now(),
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
				{
					path: "/projects/Other.recordly",
					name: "Other",
					updatedAt: Date.now(),
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
		window.electronAPI.openProjectFileAtPath = async (selected) => {
			activePath = selected;
			return {
				success: true,
				path: selected,
				project:
					selected === path
						? read()
						: {
								version: 2,
								projectId: "other",
								videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
								editor: {
									clipRegions: [
										{
											id: "clip-1",
											startMs: 0,
											endMs: 6000,
											sourceStartMs: 0,
											speed: 1,
										},
									],
								},
							},
			};
		};
	});
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	const zooms = page.locator('[data-variant="zoom"]');
	await expect(clips).toHaveCount(1, { timeout: 30_000 });
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	await expect(zooms).toHaveCount(1);
	await zooms.click();
	await page.keyboard.press("Delete");
	await expect(zooms).toHaveCount(0);
	await page.keyboard.press("Meta+z");
	await expect(zooms).toHaveCount(1);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const saved = JSON.parse(localStorage.getItem("test-history-project") || "null");
				return [saved?.editor.zoomRegions.length, saved?.history?.future.length];
			}),
		)
		.toEqual([1, 1]);

	await page.reload();
	await expect(zooms).toHaveCount(1, { timeout: 30_000 });
	await page.getByTestId("timeline-scroll").focus();
	await page.keyboard.press("Meta+Shift+z");
	await expect(zooms).toHaveCount(0);
	await page.keyboard.press("Meta+z");
	await expect(zooms).toHaveCount(1);
	await page.keyboard.press("Meta+z");
	await expect(zooms).toHaveCount(0);
	await page.keyboard.press("Meta+Shift+z");
	await expect(zooms).toHaveCount(1);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(localStorage.getItem("test-history-project") || "null")?.editor
						.zoomRegions.length,
			),
		)
		.toBe(1);

	await page.getByRole("button", { name: "Home", exact: true }).click();
	const dashboard = page.getByRole("dialog", { name: "Projects dashboard" });
	await dashboard.getByRole("button", { name: "Other", exact: true }).click();
	await expect(dashboard).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
	await page.getByTestId("timeline-scroll").focus();
	await page.keyboard.press("Meta+z");
	await expect(zooms).toHaveCount(0);
	await expect(clips).toHaveCount(1);
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	await expect(zooms).toHaveCount(1);
	await page.keyboard.press("Meta+z");
	await expect(zooms).toHaveCount(0);
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await dashboard.getByRole("button", { name: "History", exact: true }).click();
	await expect(dashboard).not.toBeVisible();
	await expect(zooms).toHaveCount(1);
	await page.getByTestId("timeline-scroll").focus();
	await page.keyboard.press("Meta+Shift+z");
	await expect(zooms).toHaveCount(0);
});
