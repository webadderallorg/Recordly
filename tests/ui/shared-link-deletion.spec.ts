import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const { fails, delayed, nativeFails } of [
	{ fails: false, delayed: false, nativeFails: false },
	{ fails: true, delayed: false, nativeFails: false },
	{ fails: false, delayed: true, nativeFails: false },
	{ fails: false, delayed: false, nativeFails: true },
]) {
	test(`deleting a cloud recording ${fails ? "preserves its saved link on failure" : delayed ? "clears a mounted Home card after leaving Shared" : nativeFails ? "warns when native settings cannot be updated" : "clears its saved local project links"}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			({ fails, delayed, nativeFails }) => {
				const projectPath = "/projects/shared.recordly";
				let links: unknown = {
					[projectPath]: {
						url: "https://example.test/s/deleted",
						sharedAt: Date.now() + 1000,
					},
				};
				let deleted = false;
				window.electronAPI.getCurrentVideoPath = async () => ({ success: false });
				window.electronAPI.getAppSetting = (key) =>
					key === "recordly.onboarding.v1.seen"
						? true
						: key === "recordly.project-share-links.v1"
							? structuredClone(links)
							: null;
				window.electronAPI.getAppSettingWithStatus = (key) => ({
					success: true,
					found:
						key === "recordly.onboarding.v1.seen" ||
						key === "recordly.project-share-links.v1",
					value: window.electronAPI.getAppSetting(key),
				});
				window.electronAPI.setAppSetting = (key, value) => {
					if (key === "recordly.project-share-links.v1") {
						if (nativeFails) return false;
						links = structuredClone(value);
					}
					return true;
				};
				window.electronAPI.listProjectFiles = async () => ({
					success: true,
					entries: [
						{
							path: projectPath,
							name: "Saved local project",
							updatedAt: 1,
							thumbnailPath: null,
							isCurrent: false,
							isInProjectsDirectory: true,
						},
					],
				});
				window.electronAPI.cloudShareManage = async (input) => {
					if (input.action === "delete") {
						document.documentElement.dataset.deleteCalls = "1";
						if (fails) return { success: false, error: "Fixture deletion failed" };
						if (delayed)
							await new Promise<void>((resolve) => {
								window.addEventListener("fixture-release-delete", () => resolve(), {
									once: true,
								});
							});
						deleted = true;
					}
					return {
						success: true,
						videos: deleted
							? []
							: [
									{
										code: "deleted",
										title: "Shared cloud recording",
										ready: true,
										size: 42,
										url: "https://example.test/s/deleted",
										createdAt: new Date().toISOString(),
									},
								],
					};
				};
			},
			{ fails, delayed, nativeFails },
		);
		await page.goto("/?windowType=editor");
		const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
		await expect(home).toBeVisible();
		const share = home.getByRole("button", {
			name: "View share link for Saved local project",
			exact: true,
		});
		await expect(share).toHaveText("Shared");
		const navigation = home.getByRole("complementary", { name: "Library navigation" });
		await navigation.getByRole("button", { name: "Shared links", exact: true }).click();
		await home
			.getByRole("button", { name: "Options for Shared cloud recording", exact: true })
			.click();
		page.once("dialog", (dialog) => dialog.dismiss());
		await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
		await expect(page.locator("html")).not.toHaveAttribute("data-delete-calls");
		await home
			.getByRole("button", { name: "Options for Shared cloud recording", exact: true })
			.click();
		page.once("dialog", (dialog) => dialog.accept());
		await page.getByRole("menuitem", { name: "Delete recording", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-delete-calls", "1");
		if (delayed) {
			await navigation.getByRole("button", { name: "Home", exact: true }).click();
			await expect(share).toHaveText("Shared");
			await page.evaluate(() => window.dispatchEvent(new Event("fixture-release-delete")));
			await expect(share).toHaveCount(0);
			return;
		}
		if (fails) await expect(home.getByRole("alert")).toBeVisible();
		else
			await expect(
				home.getByRole("button", { name: "Shared cloud recording", exact: true }),
			).toHaveCount(0);
		if (nativeFails)
			await expect(
				page.getByText("Could not save library preferences", { exact: true }),
			).toBeVisible();
		await navigation.getByRole("button", { name: "Home", exact: true }).click();
		if (fails) await expect(share).toHaveText("Shared");
		else {
			await expect(share).toHaveCount(0);
			await home
				.getByRole("button", { name: "Options for Saved local project", exact: true })
				.click();
			await expect(page.getByRole("menuitem", { name: "Share", exact: true })).toBeVisible();
			await expect(
				page.getByRole("menuitem", { name: "View link", exact: true }),
			).toHaveCount(0);
		}
	});
}
