import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("Shortcuts has its own settings section with inline editing, save and reset", async ({
	page,
}, testInfo) => {
	test.setTimeout(120000);
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => ({ success: false, path: null });
		window.electronAPI.getShortcuts = async () => null;
		window.electronAPI.saveShortcuts = async (value) => {
			document.documentElement.dataset.savedShortcuts = JSON.stringify(value);
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	const dashboard = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(dashboard).toBeVisible({ timeout: 60000 });
	await dashboard.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await expect(dashboard.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		dashboard.getByRole("button", { name: "Edit shortcuts", exact: true }),
	).toHaveCount(0);
	await dashboard.getByRole("tab", { name: "Shortcuts", exact: true }).click();
	const panel = dashboard.getByRole("tabpanel", { name: /^Shortcuts settings/ });
	await expect(panel.getByText("Configurable", { exact: true })).toBeVisible();
	await expect(panel.getByText("Fixed", { exact: true })).toBeVisible();
	await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts", exact: true })).toHaveCount(
		0,
	);
	const split = () => panel.getByRole("button", { name: /^Change Split Clip shortcut/ });
	await expect(split()).toHaveText("⌘ + B");
	await split().click();
	await page.keyboard.press("Meta+k");
	await expect(split()).toHaveText("⌘ + K");
	await expect(
		panel.getByText(
			"Click a shortcut then press the new key combination. Press Esc to cancel.",
			{ exact: true },
		),
	).toBeInViewport();
	await panel.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(panel.getByRole("button", { name: "Save", exact: true })).toBeInViewport({
		ratio: 1,
	});
	await expect(panel.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({
		ratio: 1,
	});
	await panel.getByRole("button", { name: "Save", exact: true }).click();
	await expect
		.poll(() => page.locator("html").getAttribute("data-saved-shortcuts"))
		.toContain('"splitClip":{"key":"k","ctrl":true}');
	await expect(dashboard.getByRole("tab", { name: "Shortcuts", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await panel.getByRole("button", { name: "Reset to defaults", exact: true }).click();
	await expect(split()).toHaveText("⌘ + B");
	await panel.getByRole("button", { name: "Save", exact: true }).click();
	await split().click();
	await dashboard.getByRole("tab", { name: "General", exact: true }).click();
	// A hidden shortcut editor must not capture typing in another category.
	await page.keyboard.press("x");
	await dashboard.getByRole("tab", { name: "Shortcuts", exact: true }).click();
	await expect(split()).toHaveText("⌘ + B");
	for (const width of [1440, 760]) {
		await page.setViewportSize({ width, height: 900 });
		await expect
			.poll(() => panel.evaluate((node) => node.scrollWidth - node.clientWidth), {
				message: `Shortcuts panel overflow at ${width}px`,
			})
			.toBeLessThanOrEqual(0);
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.keyboard.press("Escape");
	await expect(dashboard).not.toBeVisible();
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await settings.getByRole("tab", { name: "Shortcuts", exact: true }).click();
	const settingsPanel = settings.getByRole("tabpanel");
	await expect(settingsPanel.getByText("Configurable", { exact: true })).toBeVisible();
	for (const width of [420, 320]) {
		await page.setViewportSize({ width, height: 900 });
		await expect
			.poll(() => settingsPanel.evaluate((node) => node.scrollWidth - node.clientWidth), {
				message: `Shortcuts dialog overflow at ${width}px`,
			})
			.toBeLessThanOrEqual(0);
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	await settings.screenshot({
		path: testInfo.outputPath("shortcuts-settings.png"),
		animations: "disabled",
	});
});
