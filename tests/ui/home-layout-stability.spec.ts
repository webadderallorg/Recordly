import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("unknown or empty shared content never displaces local projects, including focus refreshes", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			projects: [],
			entries: [
				{
					path: "/projects/demo.recordly",
					name: "Stable demo",
					updatedAt: 1759000000000,
					thumbnailPath: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
		window.electronAPI.cloudShareManage = async () => {
			document.documentElement.dataset.sharesPending = "true";
			await new Promise<void>((resolve) =>
				window.addEventListener("test-release-shares", () => resolve(), { once: true }),
			);
			delete document.documentElement.dataset.sharesPending;
			return { success: true, videos: [] };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	const card = home.getByRole("button", { name: "Stable demo", exact: true });
	await expect(card).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-shares-pending", "true");
	await expect(home.getByRole("region", { name: "Recently shared videos" })).toHaveCount(0);
	const before = await card.boundingBox();
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-shares")));
	await expect(page.locator("html")).not.toHaveAttribute("data-shares-pending");
	await expect.poll(async () => (await card.boundingBox())!.y).toBe(before!.y);
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(page.locator("html")).toHaveAttribute("data-shares-pending", "true");
	await expect(home.getByRole("region", { name: "Recently shared videos" })).toHaveCount(0);
	expect((await card.boundingBox())!.y).toBe(before!.y);
	await page.evaluate(() => window.dispatchEvent(new Event("test-release-shares")));
});

for (const empty of [false, true]) {
	test(`known ${empty ? "empty library" : "project cards"} remain visible while Home saves and refreshes`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(empty) => {
				window.electronAPI.cloudShareManage = async () => ({ success: true, videos: [] });
				window.electronAPI.listProjectFiles = async () => ({
					success: true,
					projects: [],
					entries: empty
						? []
						: [
								{
									path: "/projects/demo.recordly",
									name: "Stable demo",
									updatedAt: 1759000000000,
									thumbnailPath: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
									isCurrent: false,
									isInProjectsDirectory: true,
								},
							],
				});
				const save = window.electronAPI.saveProjectFile;
				window.electronAPI.saveProjectFile = async (...args) => {
					if (document.documentElement.dataset.delayHomeSave && args[3]) {
						document.documentElement.dataset.homeSavePending = "true";
						await new Promise<void>((resolve) =>
							window.addEventListener("test-release-save", () => resolve(), {
								once: true,
							}),
						);
					}
					return save(...args);
				};
			},
			empty,
		);
		await page.goto("/?windowType=editor");
		await expect(page.locator("html")).toHaveAttribute("data-project-creates", "1", {
			timeout: 15000,
		});
		await page.getByRole("button", { name: "Home", exact: true }).click();
		const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		await expect(
			empty
				? home.getByRole("heading", { name: "No projects yet", exact: true })
				: home.getByRole("button", { name: "Stable demo", exact: true }),
		).toBeVisible();
		await home.getByRole("button", { name: "Resume Untitled Project", exact: true }).click();
		await page.evaluate(() => {
			document.documentElement.dataset.delayHomeSave = "true";
		});
		await page.getByRole("button", { name: "Home", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-home-save-pending", "true");
		await expect(
			empty
				? home.getByRole("heading", { name: "No projects yet", exact: true })
				: home.getByRole("button", { name: "Stable demo", exact: true }),
		).toBeVisible();
		await expect(home.getByLabel("Loading projects")).toHaveCount(0);
		await page.evaluate(() => window.dispatchEvent(new Event("test-release-save")));
	});
}
