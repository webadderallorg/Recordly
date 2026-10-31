import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
test("editor loads video, switches tools and edits export options", async ({ page }) => {
	test.setTimeout(120000);
	const errors: string[] = [];
	page.on("pageerror", (e) => {
		errors.push(e.message);
	});
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("navigation", { name: "Editor tools" })).toBeVisible({
		timeout: 20000,
	});
	await expect(page.getByRole("slider", { name: "Blur", exact: true })).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator("video")
				.evaluateAll((videos) =>
					videos.some((video) => (video as HTMLVideoElement).readyState >= 2),
				),
		)
		.toBe(true);
	await page.screenshot({
		path: "test-results/editor-scene-light.png",
		fullPage: true,
		animations: "disabled",
	});
	const inspectorWidth = (await page.locator("aside").boundingBox())?.width;
	await page.getByRole("row", { name: "Color", exact: true }).click();
	await expect(page.getByRole("button", { name: "Custom color", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Custom color", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Custom color", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await expect(page.getByText("Appearance", { exact: true })).toBeVisible();
	await page.getByRole("row", { name: "Dark", exact: true }).click();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.screenshot({
		path: "test-results/editor-dark.png",
		fullPage: true,
		animations: "disabled",
	});
	await page.getByRole("row", { name: "Light", exact: true }).click();
	await expect(page.locator("html")).not.toHaveClass(/dark/);
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await page.getByRole("button", { name: "Export", exact: true }).click();
	await expect(page.getByRole("grid", { name: "Format", exact: true })).toBeVisible();
	await page.getByRole("row", { name: "GIF", exact: true }).click();
	await expect(page.getByRole("switch", { name: "Loop", exact: false })).toBeVisible();
	await page.screenshot({
		path: "test-results/editor-export-light.png",
		fullPage: true,
		animations: "disabled",
	});
	await page.keyboard.press("Escape");
	await expect(page.getByRole("grid", { name: "Format", exact: true })).toHaveCount(0);
	await page.screenshot({
		path: "test-results/editor-light.png",
		fullPage: true,
		animations: "disabled",
	});
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "Projects dashboard", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Crop Video", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Crop Video", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await page.getByRole("button", { name: "16:9", exact: true }).click();
	await page.getByRole("menuitem", { name: "1:1", exact: true }).click();
	await expect(page.getByRole("button", { name: "1:1", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Open presets", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Annotation", exact: true }).click();
	await expect
		.poll(async () => (await page.locator("aside").boundingBox())?.width)
		.toBe(inspectorWidth);
	const bold = page.getByRole("button", { name: "Toggle bold", exact: false });
	await expect(bold).toHaveAttribute("aria-pressed", "true");
	await bold.click();
	await expect(bold).toHaveAttribute("aria-pressed", "false");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(bold).toHaveAttribute("aria-pressed", "true");
	const annotationBlock = page.locator('[data-variant="annotation"] .timeline-block');
	await expect(annotationBlock).toBeVisible();
	const blockBounds = (await annotationBlock.boundingBox())!;
	expect(blockBounds.y + blockBounds.height).toBeLessThan(page.viewportSize()!.height - 12);
	await page.screenshot({
		path: "test-results/editor-annotation.png",
		fullPage: true,
		animations: "disabled",
	});
	expect(errors).toEqual([]);
});
test("recorder opens device and source popovers", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => {
		errors.push(e.message);
	});
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Countdown delay", exact: false }).click();
	await page.getByRole("button", { name: "5s", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.getByRole("button", { name: "Built-in Display", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("button", { name: "More", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-dashboard-opened", "true");

	expect(errors).toEqual([]);
});
