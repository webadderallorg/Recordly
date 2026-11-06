import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const height of [720, 600, 480, 360]) {
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
		await test.info().attach("sidebar-layout", { contentType: "application/json", body: JSON.stringify(await navigation.evaluate((element) => {
			const nodes = [element.closest(".app-settings-dialog")!, element, ...element.querySelectorAll(".dashboard-settings-tab-list, .tabs__tab, .dashboard-settings-sidebar-footer")];
			return nodes.map((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return { className: node.className, text: node.textContent, rect: {x:rect.x,y:rect.y,width:rect.width,height:rect.height}, clientHeight:node.clientHeight, scrollHeight:node.scrollHeight, height:style.height, padding:style.padding, overflow:style.overflow, minHeight:style.minHeight, gap:style.gap }; });
		})) });
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


test("storage locations stay in their info tooltips", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingsDirectory = async () => ({ success: true, path: "/Users/creator/Documents/Recordly/Recordings" });
		window.electronAPI.getProjectsDirectory = async () => ({ success: true, path: "/Users/creator/Documents/Recordly/Projects" });
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await expect(settings.getByText("Recordings folder", { exact: true })).toBeVisible();
	await expect(settings).not.toContainText("/Users/creator");
	for (const [label, path] of [
		["Recordings folder", "/Users/creator/Documents/Recordly/Recordings"],
		["Projects folder", "/Users/creator/Documents/Recordly/Projects"],
	]) {
		await settings.getByLabel(label, { exact: true }).hover();
		await expect(page.getByRole("tooltip")).toContainText(path);
		await settings.getByRole("heading", { name: "Settings", exact: true }).hover();
		await expect(page.getByRole("tooltip")).toHaveCount(0);
	}
	await settings.screenshot({ path: test.info().outputPath("storage-tooltips.png") });
});
