import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("advanced controls preserve values and remember each section's view", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const advanced = page.getByRole("switch", { name: "Advanced settings" });
	await expect(advanced).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole("switch", { name: "Link padding sides" })).toHaveCount(0);
	const blur = page.getByRole("slider", { name: "Blur", exact: true });
	await blur.focus();
	await page.keyboard.press("ArrowRight");
	const value = await blur.inputValue();
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(page.getByRole("switch", { name: "Link padding sides" })).toBeVisible();
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await expect(advanced).not.toBeChecked();
	await expect(page.getByRole("slider", { name: "Webcam Height" })).toHaveCount(0);
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(page.getByRole("slider", { name: "Webcam Height" })).toBeAttached();
	await page.screenshot({
		path: "test-results/editor-webcam-advanced.png",
		animations: "disabled",
	});
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await expect(advanced).toBeChecked();
	await expect(blur).toHaveValue(value);
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(blur).toHaveValue(value);
	await page.getByRole("row", { name: "Color", exact: true }).click();
	await page.getByRole("button", { name: "Custom color", exact: true }).click();
	await page.getByRole("textbox", { name: "Hex color", exact: true }).fill("#27AE60");
	await page.keyboard.press("Tab");
	await expect(page.getByRole("textbox", { name: "Hex color", exact: true })).toHaveValue(
		"#27AE60",
	);
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Custom color", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Hex color", exact: true })).toHaveValue(
		"#27AE60",
	);
	await page.screenshot({ path: "test-results/editor-color-picker.png", animations: "disabled" });
});

test("header breadcrumb fits long names, native chrome and compact windows", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Rename project" })).toBeVisible({
		timeout: 20000,
	});
	await page.getByRole("button", { name: "Rename project" }).click();
	await page
		.getByRole("textbox", { name: "Project name" })
		.fill("A very long project title that should truncate and never cover the toolbar");
	// Validate the editing state as well as the display state.
	for (const width of [1440, 1280, 800]) {
		await page.setViewportSize({ width, height: 800 });
		for (const trafficLightsVisible of [true, false]) {
			await page.evaluate(
				(visible) =>
					window.dispatchEvent(
						new CustomEvent("test-window-chrome", {
							detail: { trafficLightsVisible: visible },
						}),
					),
				trafficLightsVisible,
			);
			await expect(page.locator(".editor-header-start")).toHaveCSS(
				"padding-left",
				trafficLightsVisible ? "76px" : "0px",
			);
			const header = await page.locator(".editor-header").boundingBox();
			const dividers = await page.locator(".editor-header").getByRole("separator").all();
			expect(dividers).toHaveLength(2);
			for (const divider of dividers) {
				const box = await divider.boundingBox();
				expect(box!.height).toBe(20);
				expect(
					Math.abs(box!.y + box!.height / 2 - (header!.y + header!.height / 2)),
				).toBeLessThanOrEqual(1);
			}
			const stage = await page.locator(".editor-preview-stage").boundingBox();
			const frame = await page.locator(".editor-preview-frame").boundingBox();
			expect(
				Math.abs(stage!.x + stage!.width / 2 - frame!.x - frame!.width / 2),
			).toBeLessThan(1);
			expect(
				Math.abs(stage!.y + stage!.height / 2 - frame!.y - frame!.height / 2),
			).toBeLessThan(1);
			const boxes = await Promise.all(
				[".editor-header-start", ".editor-header-title", ".editor-header-end"].map(
					(selector) => page.locator(selector).boundingBox(),
				),
			);
			const [left, center, right] = boxes;
			expect(center!.x).toBeGreaterThan(left!.x);
			expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
			expect(center!.x + center!.width).toBeLessThanOrEqual(right!.x);
			const buttons = await page.locator(".editor-playback button").evaluateAll((nodes) =>
				nodes
					.filter((n) => n.getBoundingClientRect().width > 0)
					.map((n) => {
						const r = n.getBoundingClientRect();
						return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
					}),
			);
			for (let i = 0; i < buttons.length; i++)
				for (let j = i + 1; j < buttons.length; j++) {
					const a = buttons[i],
						b = buttons[j];
					expect(
						a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y,
					).toBe(true);
				}
			await expect(
				page.getByRole("button", { name: "Export", exact: true }),
			).toBeInViewport();
			await expect(page.getByRole("button", { name: "Play", exact: true })).toBeInViewport();
		}
		await page.screenshot({
			path: `test-results/editor-layout-${width}.png`,
			animations: "disabled",
		});
	}
	await page.keyboard.press("Escape");
	await expect(page.getByRole("button", { name: "Rename project" })).toBeVisible();
});

test("header name edits in place and saves on blur without a boxed input", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.saveProjectFileNamed = async (_data, name) => ({
			success: true,
			path: `/projects/${name}.recordly`,
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Rename project" })).toContainText(
		"Untitled Project",
	);
	await page.getByRole("button", { name: "Rename project" }).click();
	const input = page.getByRole("textbox", { name: "Project name" });
	await expect(input).toHaveCSS("box-shadow", "none");
	await expect(input).toHaveCSS("border-top-width", "0px");
	await input.fill("Launch demo");
	await input.press("Tab");
	await expect(page.getByRole("button", { name: "Rename project" })).toContainText("Launch demo");
	await page.getByRole("button", { name: "Rename project" }).click();
	await input.fill("Discard this");
	await input.press("Escape");
	await expect(page.getByRole("button", { name: "Rename project" })).toContainText("Launch demo");
});

test("new zoom blocks default to 1.8x", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	await page.locator('[data-variant="zoom"] .timeline-block').first().click();
	await expect(page.getByRole("row", { name: "1.8×", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
});
