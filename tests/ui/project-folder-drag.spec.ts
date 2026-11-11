import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("dragging a project preview assigns a folder once, persists, and never opens the editor", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		localStorage.setItem(
			"recordly.project-folders.v1",
			JSON.stringify([
				{ id: "tutorials", name: "Tutorials", color: "#759bd2", paths: [] },
				{ id: "favorites", name: "Favorites", color: "#de85ac", paths: [] },
			]),
		);
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: [
				{
					path: "/projects/demo.recordly",
					name: "Drag demo",
					updatedAt: 1759000000000,
					thumbnailPath: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
		window.electronAPI.openProjectFileAtPath = async () => {
			document.documentElement.dataset.dragOpenedProject = "true";
			return { success: false, canceled: true };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	const preview = home.getByRole("button", { name: "Drag demo", exact: true });
	const target = home.locator('[data-project-drop-target="tutorials"]');
	await expect(preview.locator(":scope > [draggable]")).toHaveAttribute("draggable", "true");
	await preview.dragTo(target);
	await expect(
		home.getByRole("button", { name: "Remove Drag demo from Tutorials", exact: true }),
	).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-drag-opened-project");
	// Dropping into an existing folder adds membership; it must not toggle it off.
	await preview.dragTo(target);
	await preview.dragTo(home.locator('[data-project-drop-target="favorites"]'));
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem("recordly.project-folders.v1")!),
	);
	expect(stored.map((folder: { paths: string[] }) => folder.paths)).toEqual([
		["/projects/demo.recordly"],
		["/projects/demo.recordly"],
	]);
	await home.getByRole("button", { name: "Tutorials", exact: true }).click();
	await expect(preview).toBeVisible();
	await expect(target).not.toHaveAttribute("data-drag-over");
	// External text/file data and unknown project paths cannot change folder contents.
	await target.evaluate((element) => {
		for (const type of ["text/plain", "application/x-recordly-project"]) {
			const dataTransfer = new DataTransfer();
			dataTransfer.setData(type, "/projects/unknown.recordly");
			element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
		}
	});
	expect(
		await page.evaluate(() => JSON.parse(localStorage.getItem("recordly.project-folders.v1")!)),
	).toEqual(stored);
	await home.getByRole("button", { name: "Home", exact: true }).click();
	await home.getByRole("button", { name: "Select projects" }).click();
	await expect(preview.locator(":scope > [draggable]")).toHaveAttribute("draggable", "false");
	await preview.click();
	await expect(preview).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator("html")).not.toHaveAttribute("data-drag-opened-project");
});
