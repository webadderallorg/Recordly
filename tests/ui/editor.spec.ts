import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
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
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	await expect(page.getByRole("button", { name: "Add custom color", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Add custom color", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Custom color", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Appearance", exact: true })
		.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await expect(settings.getByRole("radiogroup", { name: "Appearance", exact: true })).toBeVisible();
	await settings.getByRole("radiogroup", { name: "Appearance", exact: true })
		.getByText("Dark", { exact: true }).click();
	await expect(settings.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.screenshot({
		path: "test-results/editor-dark.png",
		fullPage: true,
		animations: "disabled",
	});
	await settings.getByRole("radiogroup", { name: "Appearance", exact: true })
		.getByText("Light", { exact: true }).click();
	await expect(settings.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
	await expect(page.locator("html")).not.toHaveClass(/dark/);
	await page.keyboard.press("Escape");
	await expect(settings).toHaveCount(0);
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("row", { name: "Save video", exact: true }).click();
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
	await page.getByRole("button", { name: "Crop", exact: true }).click();
	const crop = page.locator("[data-inline-crop]");
	await expect(crop).toBeVisible();
	await crop.getByRole("button", { name: "Done", exact: true }).click();
	await expect(crop).toHaveCount(0);
	await page.getByRole("button", { name: /^Aspect ratio:/ }).click();
	await page
		.getByRole("dialog", { name: "Aspect ratio", exact: true })
		.getByRole("radio", { name: "1:1", exact: true })
		.press("Space");
	await expect(page.getByRole("button", { name: "Aspect ratio: 1:1", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
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
test("recorder countdown and native source selection keep the HUD responsive", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => {
		errors.push(e.message);
	});
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.pickCaptureTarget = async () => {
			document.documentElement.dataset.pickerCalls = "1";
			return {
				success: true,
				source: {
					id: "window:101:0",
					name: "Selected window",
					display_id: "1",
					thumbnail: null,
					appIcon: null,
				},
			};
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Countdown delay", exact: false }).click();
	await page.getByRole("button", { name: "5 sec", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Countdown delay: 5s", exact: true })).toBeVisible();
	const source = page.getByRole("button", { name: "Choose recording source", exact: true });
	await expect(source).toContainText("Built-in Display");
	await source.click();
	await expect(page.locator("html")).toHaveAttribute("data-picker-calls", "1");
	await expect(source).toContainText("Selected window");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "More", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-dashboard-opened", "true");

	expect(errors).toEqual([]);
});
