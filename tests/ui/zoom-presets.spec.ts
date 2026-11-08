import { expect, test } from "@playwright/test";
import { CURSOR_MOTION_PRESETS } from "../../src/components/video-editor/cursorMotionPresets";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("zoom presets work in the basic panel and preserve cursor settings", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const save = window.electronAPI.saveProjectFile;
		window.electronAPI.saveProjectFile = async (...args) => {
			document.documentElement.dataset.savedZoomPresetProject = JSON.stringify(args[0]);
			return save(...args);
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	await page.locator('[data-variant="zoom"]').click();
	const presets = page.getByRole("grid", { name: "Presets", exact: true });
	await expect(presets).toBeVisible();
	const preferences = () =>
		page.evaluate(
			() =>
				JSON.parse(document.documentElement.dataset.savedZoomPresetProject ?? "{}").editor,
		);
	await expect.poll(preferences).toBeDefined();
	const before = await preferences();
	for (const preset of [CURSOR_MOTION_PRESETS.smooth, CURSOR_MOTION_PRESETS.focused]) {
		const option = presets.getByRole("row", { name: preset.label, exact: true });
		await option.click();
		await expect(option).toHaveAttribute("aria-selected", "true");
		await expect.poll(preferences).toMatchObject({
			zoomInDurationMs: preset.zoomInDurationMs,
			zoomOutDurationMs: preset.zoomOutDurationMs,
			cursorSize: before.cursorSize,
			cursorSmoothing: before.cursorSmoothing,
			cursorClickBounce: before.cursorClickBounce,
		});
	}
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	const classic = page.getByRole("switch", { name: "Classic Animation", exact: true });
	await classic.press("Space");
	await expect(classic).toBeChecked();
	await expect(presets.locator('[aria-selected="true"]')).toHaveCount(0);
	await presets.getByRole("row", { name: "Cinematic", exact: true }).click();
	await expect(classic).not.toBeChecked();
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(presets.getByRole("row", { name: "Cinematic", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.locator("aside").screenshot({
		path: test.info().outputPath("zoom-presets-panel.png"),
		animations: "disabled",
	});
});
