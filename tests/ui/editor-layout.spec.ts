import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function recordHighlightMotion(page: Page) {
	await page.evaluate(() => {
		const animate = Element.prototype.animate;
		Element.prototype.animate = function (...args) {
			if (this.classList.contains("sliding-highlight")) {
				const options = args[1];
				const id = typeof options === "object" ? options.id : undefined;
				if (id === "highlight-enter" || id === "highlight-slide") {
					const counter =
						id === "highlight-enter" ? "data-enter-count" : "data-slide-count";
					this.setAttribute(counter, String(Number(this.getAttribute(counter)) + 1));
				}
			}
			return animate.apply(this, args);
		};
	});
}

test("the highlight slides only between neighboring timeline controls and Add menu items", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await recordHighlightMotion(page);
	const tools = page.locator(".editor-playback-tools");
	const toolbarHighlight = tools.locator(".sliding-highlight");
	const add = tools.getByRole("button", { name: "Add", exact: true });
	await expect(add).toBeVisible({ timeout: 20000 });
	await add.hover();
	await expect(toolbarHighlight).toHaveAttribute("data-visible", "");
	await expect(toolbarHighlight).toHaveAttribute("data-enter-count", "1");
	await expect(toolbarHighlight).not.toHaveAttribute("data-slide-count");
	await tools.getByRole("button", { name: /^Add Zoom/ }).hover();
	await expect(toolbarHighlight).toHaveAttribute("data-slide-count", "1");
	await tools.getByRole("button", { name: "Suggest Zooms from Cursor" }).hover();
	await expect(toolbarHighlight).toHaveAttribute("data-slide-count", "1");
	await expect(toolbarHighlight).toHaveAttribute("data-enter-count", "2");

	await add.click();
	const menu = page.getByRole("menu");
	const menuHighlight = menu.locator("..").locator(".sliding-highlight");
	await menu.getByRole("menuitem", { name: "Import from Clips" }).hover();
	await expect(menuHighlight).toHaveAttribute("data-visible", "");
	await expect(menuHighlight).toHaveAttribute("data-enter-count", "1");
	await menu.getByRole("menuitem", { name: "Import from device…" }).hover();
	await expect(menuHighlight).toHaveAttribute("data-slide-count", "1");
	await page.keyboard.press("ArrowDown");
	await expect(menu.getByRole("menuitem", { name: "Annotation" })).toBeFocused();
	await expect(menuHighlight).toHaveAttribute("data-slide-count", "2");

	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.keyboard.press("ArrowDown");
	const audio = menu.getByRole("menuitem", { name: "Audio", exact: true });
	await expect(audio).toBeFocused();
	await expect(menuHighlight).toHaveAttribute("data-slide-count", "2");
	const [highlightBounds, audioBounds] = await Promise.all([
		menuHighlight.boundingBox(),
		audio.boundingBox(),
	]);
	expect(highlightBounds!.y).toBeCloseTo(audioBounds!.y, 0);
	await page.keyboard.press("Escape");
	await expect(add).toBeFocused();
});

test("the same highlight follows editor choices, Settings tabs and Home sort options", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await recordHighlightMotion(page);

	const editorTools = page.getByRole("navigation", { name: "Editor tools" });
	const railHighlight = editorTools.locator('.sliding-highlight[data-selection="true"]');
	const railPreview = editorTools.locator(".sliding-highlight[data-preview]");
	const scene = editorTools.getByRole("radio", { name: "Scene" });
	const cursor = editorTools.getByRole("radio", { name: "Cursor" });
	await expect(scene).toBeChecked({
		timeout: 45000,
	});
	const presets = editorTools.getByRole("button", { name: "Open presets", exact: true });
	const settingsButton = editorTools.getByRole("button", { name: "Settings", exact: true });
	const footer = editorTools.locator(".sliding-highlight-group").filter({
		has: page.getByRole("button", { name: "Open presets", exact: true }),
	});
	await expect(
		page.locator(".editor-header").getByRole("button", { name: "Open presets" }),
	).toHaveCount(0);
	const [presetsBounds, dividerBounds, settingsBounds] = await Promise.all([
		presets.boundingBox(),
		footer.getByRole("separator").boundingBox(),
		settingsButton.boundingBox(),
	]);
	expect(dividerBounds!.y).toBeGreaterThan(presetsBounds!.y + presetsBounds!.height);
	expect(settingsBounds!.y).toBeGreaterThan(dividerBounds!.y + dividerBounds!.height);
	const footerGap = settingsBounds!.y - presetsBounds!.y - presetsBounds!.height;
	expect(footerGap).toBeGreaterThan(16);
	expect(footerGap).toBeLessThanOrEqual(32);
	await presets.hover();
	await settingsButton.hover();
	await expect(footer.locator(".sliding-highlight")).toHaveAttribute("data-slide-count", "1");
	await presets.click();
	await expect(page.getByRole("dialog", { name: "Presets", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(presets).toBeFocused();
	await expect(page.locator("[data-wallpaper-glass-theme] .sliding-highlight")).toHaveCount(0);

	await expect(railHighlight).toHaveAttribute("data-visible", "");
	await cursor.hover();
	await expect(railPreview).toHaveAttribute("data-enter-count", "1");
	await expect(cursor).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await editorTools.getByRole("radio", { name: "Webcam" }).hover();
	await expect(railPreview).toHaveAttribute("data-slide-count", "1");
	await expect(scene).toBeChecked();
	await cursor.click();
	await expect(railHighlight).toHaveAttribute("data-slide-count", "1");
	await expect(cursor).toBeChecked();
	await expect(railPreview).not.toHaveAttribute("data-visible");
	await editorTools.getByRole("radio", { name: "Captions" }).click();
	await expect(railHighlight).toHaveAttribute("data-enter-count", "1");

	await settingsButton.click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	const tabs = settings.getByRole("tablist", { name: "Settings sections" });
	const tabHighlight = tabs.locator("..").locator(".sliding-highlight[data-selection]");
	await expect(tabHighlight).toHaveAttribute("data-visible", "");
	const tab = tabs.getByRole("tab", { selected: true });
	await tab.press("ArrowDown");
	await expect(tabHighlight).toHaveAttribute("data-slide-count", "1");
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Home", exact: true }).click();
	await page.getByRole("button", { name: "Sort projects" }).click();
	const sortMenu = page.getByRole("menu", { name: "Sort projects" });
	const sortOptions = sortMenu.getByRole("menuitemradio");
	const sortHighlight = sortMenu.locator("..").locator(".sliding-highlight");
	await sortOptions.first().hover();
	await expect(sortHighlight).toHaveAttribute("data-visible", "");
	await sortOptions.nth(1).hover();
	await expect(sortHighlight).toHaveAttribute("data-slide-count", "1");
});

test("advanced controls preserve values and remember each section's view", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentRecordingSession = async () => ({
			success: true,
			session: {
				videoPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				webcamPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				timeOffsetMs: 0,
			},
		});
	});
	await page.goto("/?windowType=editor");
	const advanced = page.getByRole("switch", { name: "Advanced settings" });
	await expect(advanced).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole("switch", { name: "Link padding sides" })).toHaveCount(0);
	const blur = page.getByRole("slider", { name: "Blur", exact: true });
	await expect(blur).toBeVisible();
	await blur.focus();
	await page.keyboard.press("ArrowRight");
	const value = await blur.inputValue();
	await page.locator("aside").getByText("Advanced", { exact: true }).click();
	await expect(page.getByRole("switch", { name: "Link padding sides" })).toBeVisible();
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await expect(advanced).not.toBeChecked();
	await page
		.getByRole("grid", { name: "Shape", exact: true })
		.getByRole("row", { name: "Square", exact: true })
		.click();
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
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	await page.getByRole("button", { name: "Add custom color", exact: true }).click();
	await page.getByRole("textbox", { name: "Hex color", exact: true }).fill("#27AE60");
	await page.keyboard.press("Tab");
	await expect(page.getByRole("textbox", { name: "Hex color", exact: true })).toHaveValue(
		"#27AE60",
	);
	await page
		.getByRole("dialog", { name: "Custom color", exact: true })
		.getByRole("button", { name: "Add", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Background color #27AE60", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: "Add custom color", exact: true }).click();
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
		await page.setViewportSize({ width, height: width === 800 ? 600 : 800 });
		for (const trafficLightsVisible of [false, true]) {
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
			expect(dividers).toHaveLength(1);
			await expect(
				page.locator('.editor-header-start > span[aria-hidden="true"]'),
			).toHaveText("/");
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
			expect(center!.width).toBeGreaterThanOrEqual(120);
			await expect(page.getByRole("button", { name: "Clips", exact: true })).toHaveCount(0);
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
			const playbackBounds = (await page.locator(".editor-playback").boundingBox())!;
			for (const button of buttons) {
				expect(button.x).toBeGreaterThanOrEqual(playbackBounds.x);
				expect(button.right).toBeLessThanOrEqual(playbackBounds.x + playbackBounds.width);
				expect(
					Math.abs(
						(button.y + button.bottom) / 2 - (buttons[0].y + buttons[0].bottom) / 2,
					),
				).toBeLessThan(1);
			}
			await expect(
				page.getByRole("button", { name: "Publish", exact: true }),
			).toBeInViewport();
			await expect(page.getByRole("button", { name: "Play", exact: true })).toBeInViewport();
		}
		await page.screenshot({
			path: `test-results/editor-layout-${width}.png`,
			animations: "disabled",
		});
	}
	await page.keyboard.press("Escape");
	await expect(page.getByRole("button", { name: "Rename project" })).toBeFocused();
	const update = page.getByRole("button", { name: "Update available", exact: true });
	await expect(update.locator("..")).toHaveAttribute("title", "Update available");
	await page.locator(".editor-header").screenshot({
		path: test.info().outputPath("compact-editor-header.png"),
		animations: "disabled",
	});
	await update.press("Enter");
	await expect(page.getByRole("dialog", { name: "App update", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(update).toBeFocused();
});

test("playback controls fit and zoom the timeline in compact windows", async ({ page }) => {
	test.setTimeout(60_000);
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");

	const bar = page.locator(".editor-playback");
	const tools = bar.locator(".editor-playback-tools");
	const transport = bar.locator(".editor-playback-center");
	const controls = bar.locator(".editor-playback-volume");
	const zoom = controls.getByRole("group", { name: "Zoom Timeline" });
	const zoomIn = zoom.getByRole("button", { name: "Zoom In", exact: true });
	const zoomOut = zoom.getByRole("button", { name: "Zoom Out", exact: true });
	await expect(zoomIn).toBeVisible({ timeout: 20000 });
	await expect(controls.getByRole("button", { name: "Preview volume" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Zoom In", exact: true })).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Zoom Out", exact: true })).toHaveCount(1);

	for (const width of [1100, 1000, 800]) {
		await page.setViewportSize({ width, height: 600 });
		const [barBox, toolsBox, transportBox, controlsBox] = await Promise.all(
			[bar, tools, transport.locator(":scope > div"), controls].map((group) =>
				group.boundingBox(),
			),
		);
		expect(toolsBox!.x + toolsBox!.width).toBeLessThanOrEqual(transportBox!.x);
		expect(transportBox!.x + transportBox!.width).toBeLessThanOrEqual(controlsBox!.x);
		expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(barBox!.x + barBox!.width);
	}

	const clip = page.locator('[data-variant="clip"]');
	await expect(clip).toBeVisible({ timeout: 20000 });
	const clipWidth = async () => (await clip.boundingBox())!.width;
	const initialWidth = await clipWidth();
	await zoomIn.click();
	await expect.poll(clipWidth).toBeGreaterThan(initialWidth);
	await zoomOut.click();
	await expect.poll(clipWidth).toBeCloseTo(initialWidth, 0);
});

test("header name edits directly without a selection box and saves on blur", async ({ page }) => {
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
		{ timeout: 30000 },
	);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	const title = page.getByRole("button", { name: "Rename project" });
	const originalTextBox = (await title.locator("span").boundingBox())!;
	await title.click();
	const input = page.getByRole("textbox", { name: "Project name" });
	await expect(input).toBeFocused();
	await expect(input).toHaveCSS("outline-style", "none");
	await expect(input).toHaveCSS("border-top-width", "0px");
	await expect(input).toHaveCSS("box-shadow", "none");
	await expect(input).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await expect
		.poll(() =>
			input.evaluate((node: HTMLInputElement) => node.selectionStart === node.selectionEnd),
		)
		.toBe(true);
	expect((await input.boundingBox())!.x).toBeCloseTo(originalTextBox.x, 0);
	await input.fill("Launch demo");
	await input.press("Tab");
	await expect(page.getByRole("button", { name: "Rename project" })).toContainText("Launch demo");
	await expect(title).toHaveAccessibleDescription("Launch demo");
	await title.press("Enter");
	await expect(input).toBeFocused();
	await expect(input).toHaveCSS("outline-style", "solid");
	await input.fill("Discard this");
	await input.press("Escape");
	await expect(title).toContainText("Launch demo");
	await expect(title).toBeFocused();
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

test("the timeline expand control stays hidden with three or fewer tracks", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole("button", { name: "Expand Timeline", exact: true })).toHaveCount(0);
});

test("the timeline can expand for editing and return to its default height", async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 700 });
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const videoPath = location.origin + "/tests/ui/fixtures/filmstrip.mp4";
		const note = (id: string, trackIndex: number) => ({
			id,
			startMs: 500,
			endMs: 1500,
			type: "text",
			content: id,
			position: { x: 20, y: 20 },
			trackIndex,
		});
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/tracks.recordly",
			project: {
				version: 2,
				videoPath,
				editor: {
					clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000, speed: 1 }],
					annotationRegions: [note("annotation-1", 0), note("annotation-2", 1)],
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toBeVisible({ timeout: 20000 });

	const panel = page.locator("[data-timeline-panel]");
	const height = async () => (await panel.boundingBox())!.height;
	const defaultHeight = await height();
	const expand = page.getByRole("button", { name: "Expand Timeline", exact: true });
	await expect(expand).toBeVisible();
	await expand.focus();
	await page.keyboard.press("Enter");

	const collapse = page.getByRole("button", { name: "Collapse Timeline", exact: true });
	await expect(collapse).toHaveAttribute("aria-expanded", "true");
	await expect.poll(height).toBeGreaterThan(defaultHeight + 70);
	await expect(page.locator(".editor-preview-stage")).toBeVisible();
	await collapse.click();
	await expect(expand).toHaveAttribute("aria-expanded", "false");
	await expect.poll(height).toBe(defaultHeight);
});
