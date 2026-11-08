import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("editor controls keep saved values without redundant section headers", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const originalGet = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.editor.preferences"
				? {
						padding: { top: 30, bottom: 30, left: 30, right: 30, linked: true },
						showCursor: false,
					}
				: originalGet(key);
	});
	await page.goto("/?windowType=editor");
	const sidebar = page.locator("aside");
	await expect(page.getByRole("slider", { name: "Padding", exact: true })).toHaveValue("30");
	for (const label of ["Background", "Frame", "Appearance", "Shape"]) {
		await expect(sidebar.getByText(label, { exact: true })).toHaveCount(0);
	}
	await expect(sidebar.getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	await expect(page.getByRole("switch", { name: "Show Cursor", exact: true })).not.toBeChecked();
	await expect(sidebar.getByText("Appearance", { exact: true })).toHaveCount(0);
	await expect(sidebar.getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
});
