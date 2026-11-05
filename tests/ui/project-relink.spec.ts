import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("missing startup recording can be located without autosaving an empty edit", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		const failSave = async () => {
			document.documentElement.dataset.unexpectedSave = "true";
			return { success: false, error: "Recovery must preserve the saved edits" };
		};
		window.electronAPI.createProjectFile = failSave;
		window.electronAPI.saveProjectFile = failSave;
		window.electronAPI.saveProjectFileNamed = failSave;
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: false,
			path: "/projects/Keep my edits.recordly",
			missingRecordingPath: "/disconnected/original.mp4",
			message: "Project video file not found: /disconnected/original.mp4",
		});
		let attempts = 0;
		window.electronAPI.relinkProjectRecording = async (path) => {
			document.documentElement.dataset.relinkedProject = path;
			if (attempts++ === 0) return { success: false, canceled: true };
			return {
				success: true,
				path,
				project: {
					version: 2,
					projectId: "original-identity",
					videoPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
					editor: {
						wallpaper: "#aabbcc",
						clipRegions: [
							{
								id: "saved-clip",
								startMs: 0,
								endMs: 2000,
								sourceStartMs: 1000,
								speed: 1,
							},
						],
					},
				},
			};
		};
	});
	await page.goto("/?windowType=editor");
	const error = page.getByRole("dialog", { name: "The project’s recording is unavailable" });
	await expect(error).toBeVisible();
	const locate = error.getByRole("button", { name: "Locate recording", exact: true });
	await locate.click();
	await expect(error).toBeVisible();
	// Give the existing autosave debounce time to run; a source-less recovery must never save.
	await page.waitForTimeout(800);
	await expect(page.locator("html")).not.toHaveAttribute("data-unexpected-save", "true");
	await locate.click();
	await expect(error).toHaveCount(0);
	await expect(page.locator('[data-timeline-item][data-variant="clip"]')).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Rename project" })).toContainText(
		"Keep my edits",
	);
	await expect(page.locator("html")).toHaveAttribute(
		"data-relinked-project",
		"/projects/Keep my edits.recordly",
	);
	await expect(page.locator("html")).not.toHaveAttribute("data-unexpected-save", "true");
});
