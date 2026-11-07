import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("settings anchors live usage and account actions below compact navigation", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.cloudBilling = async ({ action }) =>
			action === "catalog"
				? {
						success: true,
						prices: [],
						limits: {
							freeRecordingLimit: 5,
							freeMaxRecordingBytes: 1e9,
							plusMaxRecordingBytes: 1e10,
							storageLimitBytes: null,
						},
					}
				: {
						success: true,
						billing: {
							plan: "free",
							subscriptionStatus: null,
							currentPeriodEnd: null,
							cancelAtPeriodEnd: false,
							portalAvailable: false,
							checkoutAvailable: false,
							checkoutIntervals: [],
							prices: [],
						},
						usage: {
							recordings: 4,
							recordingLimit: 5,
							maxRecordingBytes: 1e9,
							storageBytes: 40e6,
							storageLimitBytes: 100e9,
						},
					};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await settings.getByRole("tab", { name: "General", exact: true }).click();
	const usage = settings.getByRole("region", { name: "Cloud usage", exact: true });
	await expect(usage.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
	await expect(usage.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "5");
	await expect(usage).toContainText("80%");
	await expect(usage).toContainText("4 of 5 used");
	const circleBounds = await usage.getByRole("progressbar").locator("svg").boundingBox();
	const percentageBounds = await usage.getByText("80%", { exact: true }).boundingBox();
	expect(circleBounds!.width).toBeGreaterThan(percentageBounds!.width + 16);
	const navigation = settings.locator(".dashboard-settings-navigation");
	const account = navigation.getByRole("button", { name: "Manage account", exact: true }).last();
	await expect(account).toBeVisible();
	await settings.screenshot({ path: test.info().outputPath("settings-sidebar.png") });
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await settings.screenshot({ path: test.info().outputPath("settings-sidebar-dark.png") });
	await page.setViewportSize({ width: 760, height: 720 });
	await expect(account).toBeVisible();
	await settings.getByRole("tab", { name: "General", exact: true }).scrollIntoViewIfNeeded();
	await expect(settings.getByRole("tab", { name: "General", exact: true })).toBeVisible();
	const tabBounds = await settings
		.getByRole("tab", { name: "General", exact: true })
		.boundingBox();
	const nextArrow = navigation.locator(".tabs__list-container__scroll-next:visible");
	if (await nextArrow.count()) {
		const arrowBounds = await nextArrow.boundingBox();
		expect(arrowBounds!.y).toBeGreaterThanOrEqual(tabBounds!.y + tabBounds!.height - 1);
	}
	await settings.screenshot({ path: test.info().outputPath("settings-sidebar-narrow.png") });
	await usage.getByRole("button", { name: "Dismiss", exact: true }).click();
	await expect(usage).toHaveCount(0);
	await expect(account).toBeFocused();
	await account.click();
	await expect(settings.getByRole("tab", { name: "Account", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.setViewportSize({ width: 600, height: 720 });
	await expect(settings.locator(".dashboard-settings-sidebar-footer")).toBeHidden();
	await expect(settings.getByRole("tab", { name: "Account", exact: true })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 1000 });
	await expect(usage).toHaveCount(0);
});
