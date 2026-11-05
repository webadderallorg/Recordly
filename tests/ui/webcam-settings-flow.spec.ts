import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("webcam import, anchor placement, precise adjustment and removal stay discoverable", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let picks = 0;
		window.electronAPI.openVideoFilePicker = async () => {
			picks++;
			return picks === 2
				? { success: false }
				: { success: true, path: `${location.origin}/tests/ui/fixtures/preview.mp4` };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	const sidebar = page.locator("aside");
	await expect(sidebar.getByText("Add a webcam video", { exact: true })).toBeVisible();
	await expect(sidebar.getByRole("slider")).toHaveCount(0);
	await page.getByRole("button", { name: "Upload footage", exact: true }).click();
	await expect(sidebar.getByText("preview.mp4", { exact: true })).toBeVisible();
	const camera = page.locator("[data-webcam-overlay]");
	await expect(camera).toBeVisible();
	for (const label of ["Appearance", "Shape"]) {
		await expect(sidebar.getByText(label, { exact: true })).toHaveCount(0);
	}
	await page.getByRole("row", { name: "Top left", exact: true }).click();
	await expect(page.getByRole("row", { name: "Top left", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const top = (await camera.boundingBox())!;
	await page.getByRole("row", { name: "Bottom right", exact: true }).click();
	await expect.poll(async () => (await camera.boundingBox())!.x).toBeGreaterThan(top.x + 50);
	await expect.poll(async () => (await camera.boundingBox())!.y).toBeGreaterThan(top.y + 50);
	await page.screenshot({
		path: "test-results/webcam-clean-controls.png",
		animations: "disabled",
	});
	await page.getByRole("button", { name: "Replace footage", exact: true }).click();
	// Cancelling replacement keeps the linked source and placement intact.
	await expect(sidebar.getByText("preview.mp4", { exact: true })).toBeVisible();
	await expect(page.getByRole("row", { name: "Bottom right", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	await expect(page.getByRole("switch", { name: "Custom position", exact: true })).toHaveCount(0);
	const horizontal = page.getByRole("slider", { name: "Horizontal", exact: true });
	await horizontal.focus();
	await horizontal.press("Home");
	await horizontal.press("ArrowRight");
	await expect(horizontal).toHaveValue("1");
	await expect(sidebar.getByText("Custom position", { exact: true })).toBeVisible();
	await page.getByRole("row", { name: "Center", exact: true }).click();
	await expect(horizontal).toHaveValue("50");
	const show = page.getByRole("switch", { name: "Show", exact: true });
	await show.press("Space");
	await expect(camera).toBeHidden();
	await show.press("Space");
	await expect(camera).toBeVisible();
	await page.getByRole("button", { name: "Remove footage", exact: true }).click();
	await expect(sidebar.getByText("Add a webcam video", { exact: true })).toBeVisible();
	await expect(camera).toHaveCount(0);
	await page.getByRole("button", { name: "Upload footage", exact: true }).click();
	await expect(sidebar.getByText("preview.mp4", { exact: true })).toBeVisible();
	await expect(camera).toBeVisible();
	await expect(page.getByRole("row", { name: "Center", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	// All actions fit within the sidebar rather than scrolling horizontally.
	expect(await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});
