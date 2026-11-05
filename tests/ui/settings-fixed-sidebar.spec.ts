import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const height of [720, 600, 480]) {
	test(`settings sidebar needs no scrolling at ${height}px tall`, async ({ page }) => {
		await page.setViewportSize({ width: 1000, height: 720 });
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await expect(settings).not.toHaveAttribute("data-entering");
		await page.setViewportSize({ width: 1000, height });
		const navigation = settings.locator(".dashboard-settings-navigation");
		const account = navigation.getByRole("button", { name: "Manage account", exact: true });
		await expect(account).toBeInViewport({ ratio: 1 });
		for (const tab of await navigation.getByRole("tab").all()) {
			await expect(tab).toBeInViewport({ ratio: 1 });
		}
		const positions = await navigation
			.getByRole("tab")
			.evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().y));
		await navigation.hover();
		await page.mouse.wheel(0, 1000);
		await expect
			.poll(() =>
				navigation
					.getByRole("tab")
					.evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().y)),
			)
			.toEqual(positions);
		await expect(navigation.locator(".tabs__list-container__scroll-next:visible")).toHaveCount(
			0,
		);
		await expect(navigation.locator(".tabs__list-container__scroll-prev:visible")).toHaveCount(
			0,
		);
		const panel = settings.getByRole("tabpanel");
		await panel.hover();
		await page.mouse.wheel(0, 10000);
		await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
		await expect
			.poll(() =>
				navigation
					.getByRole("tab")
					.evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().y)),
			)
			.toEqual(positions);
		await expect(account).toBeInViewport({ ratio: 1 });
		await settings.screenshot({ path: test.info().outputPath("fixed-sidebar.png") });
	});
}
