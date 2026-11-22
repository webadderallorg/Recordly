import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const failure of ["result", "exception"] as const) {
	test(`project library ${failure} failure shows retry instead of an empty library`, async ({
		page,
	}, testInfo) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(mode) => {
				window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
				window.electronAPI.listProjectFiles = async () => {
					if (document.documentElement.dataset.libraryRecovered === "true")
						return { success: true, entries: [] };
					if (mode === "exception")
						throw new Error("EACCES: projects folder inaccessible");
					return {
						success: false,
						entries: [],
						error: "EACCES: projects folder inaccessible",
					};
				};
			},
			failure,
		);
		await page.goto("/?windowType=editor");
		const home = page.getByRole("dialog", { name: "Projects dashboard" });
		const alert = home.getByRole("main").getByRole("alert");
		await expect(alert).toContainText("Could not load projects.");
		await expect(home.getByRole("heading", { name: "No projects yet" })).toHaveCount(0);
		if (failure === "result")
			await page.screenshot({
				path: testInfo.outputPath("project-library-error.png"),
				animations: "disabled",
			});
		await expect(
			alert.getByText("EACCES: projects folder inaccessible", { exact: true }),
		).not.toBeVisible();
		await alert.getByRole("button", { name: "Technical details", exact: true }).click();
		await expect(
			alert.getByText("EACCES: projects folder inaccessible", { exact: true }),
		).toBeVisible();
		await page.evaluate(() => {
			document.documentElement.dataset.libraryRecovered = "true";
		});
		await home.getByRole("button", { name: "Retry loading projects", exact: true }).click();
		await expect(alert).toHaveCount(0);
		await expect(home.getByRole("heading", { name: "No projects yet" })).toBeVisible();
	});
}

test("project library refresh failure preserves loaded projects until retry succeeds", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listProjectFiles = async () => {
			if (document.documentElement.dataset.libraryUnavailable === "true")
				return { success: false, entries: [], error: "Temporary disk failure" };
			return {
				success: true,
				entries: [
					{
						path: "/projects/demo.recordly",
						name: "Demo project",
						updatedAt: Date.now(),
						thumbnailPath: null,
						isCurrent: false,
						isInProjectsDirectory: true,
					},
				],
			};
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await page.evaluate(() => {
		document.documentElement.dataset.libraryUnavailable = "true";
	});
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(home.getByRole("main").getByRole("alert")).toContainText(
		"Could not load projects.",
	);
	await expect(home.getByRole("button", { name: "Demo project", exact: true })).toBeVisible();
	await page.evaluate(() => {
		delete document.documentElement.dataset.libraryUnavailable;
	});
	await home.getByRole("button", { name: "Retry loading projects", exact: true }).click();
	await expect(home.getByRole("main").getByRole("alert")).toHaveCount(0);
	await expect(home.getByRole("button", { name: "Demo project", exact: true })).toBeVisible();
});
