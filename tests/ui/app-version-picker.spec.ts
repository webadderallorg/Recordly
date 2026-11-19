import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openVersionPicker(page: Page) {
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await settings.getByRole("button", { name: "Change version", exact: true }).click();
	return page.getByRole("dialog", { name: "Change version", exact: true });
}

test("Updates lets users choose an older installer without changing the installed-version label", async ({
	page,
}, testInfo) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listReleaseVersions = async () => ({
			success: true,
			versions: [
				{ tag: "v1.4.0", version: "1.4.0", prerelease: false, publishedAt: "" },
				{ tag: "v1.3.3", version: "1.3.3", prerelease: false, publishedAt: "" },
			],
		});
		window.electronAPI.downloadReleaseVersion = async (tag) => {
			document.documentElement.dataset.downloadedRelease = tag;
			return { success: true };
		};
	});
	const picker = await openVersionPicker(page);
	await expect(
		picker.getByText("Download a release, then open its installer to change versions.", {
			exact: true,
		}),
	).toBeVisible();
	await picker.getByRole("button", { name: /Version/ }).click();
	await page.getByRole("option", { name: "1.3.3", exact: true }).click();
	await picker.screenshot({ path: testInfo.outputPath("version-picker.png") });
	await picker.getByRole("button", { name: "Download installer", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-downloaded-release", "v1.3.3");
	await expect(picker).not.toBeVisible();
	await expect(
		page
			.getByRole("dialog", { name: "Settings", exact: true })
			.getByText("1.4.0", { exact: true }),
	).toBeVisible();
});

test("version lookup and download failures can be retried", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let attempts = 0;
		window.electronAPI.listReleaseVersions = async () =>
			++attempts === 1
				? { success: false, versions: [] }
				: {
						success: true,
						versions: [
							{ tag: "v1.3.3", version: "1.3.3", prerelease: false, publishedAt: "" },
						],
					};
		let downloads = 0;
		window.electronAPI.downloadReleaseVersion = async () => ({ success: ++downloads > 1 });
	});
	const picker = await openVersionPicker(page);
	await expect(picker.getByRole("alert")).toBeVisible();
	const download = picker.getByRole("button", { name: "Download installer", exact: true });
	await expect(download).toBeDisabled();
	await picker.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(download).toBeEnabled();
	await download.click();
	await expect(picker.getByRole("alert")).toBeVisible();
	await picker.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(download).toBeEnabled();
	await download.click();
	await expect(picker).not.toBeVisible();
});
