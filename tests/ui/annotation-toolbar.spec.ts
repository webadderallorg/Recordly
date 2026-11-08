import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(
		page
			.getByRole("toolbar", { name: "Annotation tools" })
			.getByRole("button", { name: "Text", exact: true }),
	).toBeEnabled({ timeout: 20000 });
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 20000 });
});

test("toolbar creates editable annotations and masks on separate tracks with one-step undo", async ({
	page,
}) => {
	const toolbar = page.getByRole("toolbar", { name: "Annotation tools" });
	const blocks = page.locator('[data-variant="annotation"]');
	const inspector = page.locator("aside");
	for (const [index, label] of ["Text", "Mask"].entries()) {
		await toolbar.getByRole("button", { name: label, exact: true }).click();
		await expect(blocks).toHaveCount(index + 1);
		if (label === "Text") await expect(inspector.getByRole("textbox").first()).toBeVisible();
		else
			await expect(
				inspector.getByRole("slider", { name: "Blur Strength: 20", exact: true }),
			).toBeVisible();
	}
	await expect(page.locator("[data-annotation-id] [data-blur-redaction]")).toHaveCSS(
		"backdrop-filter",
		/blur\(/,
	);
	await expect(inspector.getByRole("button", { name: "None", exact: true })).toBeVisible();
	await expect(inspector.getByRole("grid", { name: "Annotation type" })).toBeVisible();
	const rows = await blocks.evaluateAll((nodes) =>
		nodes.map((node) => node.getBoundingClientRect().y),
	);
	expect(new Set(rows).size).toBe(2);
	for (const block of await blocks.all()) {
		await expect(block).toHaveAttribute("data-start-ms", "0");
		const end = Number(await block.getAttribute("data-end-ms"));
		expect(end).toBeGreaterThan(0);
		expect(end).toBeLessThanOrEqual(6000);
	}
	await page.screenshot({
		path: "test-results/annotation-toolbar-light.png",
		animations: "disabled",
	});
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(blocks).toHaveCount(1);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(blocks).toHaveCount(2);
	await blocks.last().click();
	await expect(inspector.getByRole("button", { name: "None", exact: true })).toBeVisible();
});

test("toolbar pauses playback and is unavailable during crop editing", async ({ page }) => {
	const toolbar = page.getByRole("toolbar", { name: "Annotation tools" });
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 20000 });
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
	await toolbar.getByRole("button", { name: "Mask", exact: true }).click();
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Crop", exact: true }).click();
	await expect(page.locator("[data-inline-crop]")).toBeVisible();
	for (const button of await toolbar.getByRole("button").all())
		await expect(button).toBeDisabled();
	await page
		.locator("[data-inline-crop]")
		.getByRole("button", { name: "Done", exact: true })
		.click();
	await expect(toolbar.getByRole("button", { name: "Mask", exact: true })).toBeEnabled();
});

test("clicking off a preview annotation deselects it and allows selecting it again", async ({
	page,
}) => {
	await page
		.getByRole("toolbar", { name: "Annotation tools" })
		.getByRole("button", { name: "Text", exact: true })
		.click();
	const annotation = page.locator("[data-annotation-id]");
	const inspector = page.locator("aside");
	await expect(annotation).toHaveCount(1);
	await expect(inspector.getByRole("textbox").first()).toBeVisible();
	await expect(annotation).toHaveCSS("outline-style", "solid");
	await page.locator(".editor-preview-frame").click({ position: { x: 8, y: 8 } });
	await expect(inspector.getByRole("heading", { name: "Scene", exact: true })).toBeVisible();
	await expect(annotation).toHaveCSS("outline-style", "none");
	await annotation.click();
	await expect(inspector.getByRole("textbox").first()).toBeVisible();
	await expect(annotation).toHaveCSS("outline-style", "solid");
	await page.locator(".editor-preview-stage").click({ position: { x: 1, y: 1 } });
	await expect(annotation).toHaveCSS("outline-style", "none");
});

test("toolbar supports keyboard navigation and stays outside the preview at smaller sizes", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1100, height: 760 });
	const toolbar = page.getByRole("toolbar", { name: "Annotation tools" });
	const text = toolbar.getByRole("button", { name: "Text", exact: true });
	const mask = toolbar.getByRole("button", { name: "Mask", exact: true });
	await text.hover();
	await expect(page.getByRole("tooltip", { name: "Text", exact: true })).toBeVisible();
	await mask.hover();
	await expect(page.getByRole("tooltip", { name: "Mask", exact: true })).toBeVisible();
	await text.focus();
	await page.keyboard.press("ArrowDown");
	await expect(mask).toBeFocused();
	await page.keyboard.press("End");
	await expect(mask).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(text).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(mask).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(1);
	const toolbarBounds = (await toolbar.boundingBox())!;
	const previewBounds = (await page.locator(".editor-preview-frame").boundingBox())!;
	expect(toolbarBounds.x).toBeGreaterThan(previewBounds.x + previewBounds.width);
	expect(toolbarBounds.y).toBeGreaterThan(0);
	expect(toolbarBounds.y + toolbarBounds.height).toBeLessThan(760);
	await page.evaluate(() => {
		document.documentElement.classList.add("dark");
	});
	await page.screenshot({
		path: "test-results/annotation-toolbar-dark-compact.png",
		animations: "disabled",
	});
});

for (const tool of ["Text", "Mask"])
	test(`${tool} can be selected, resized from preview corners and dragged in one gesture`, async ({
		page,
	}) => {
		await page
			.getByRole("toolbar", { name: "Annotation tools" })
			.getByRole("button", { name: tool, exact: true })
			.click();
		const item = page.locator("[data-annotation-id]");
		const original = (await item.boundingBox())!;
		const handle = item.locator('[data-annotation-resize="bottom-right"]');
		const grip = (await handle.boundingBox())!;
		await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
		await page.mouse.down();
		await page.mouse.move(grip.x + grip.width / 2 + 45, grip.y + grip.height / 2 + 25, {
			steps: 8,
		});
		await page.mouse.up();
		await expect
			.poll(async () => (await item.boundingBox())!.width)
			.toBeGreaterThan(original.width + 40);
		await expect
			.poll(async () => (await item.boundingBox())!.height)
			.toBeGreaterThan(original.height + 20);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect
			.poll(async () => Math.abs((await item.boundingBox())!.width - original.width))
			.toBeLessThan(1);
		await expect
			.poll(async () => Math.abs((await item.boundingBox())!.height - original.height))
			.toBeLessThan(1);
		const topLeft = (await item.locator('[data-annotation-resize="top-left"]').boundingBox())!;
		await page.mouse.move(topLeft.x + 6, topLeft.y + 6);
		await page.mouse.down();
		await page.mouse.move(topLeft.x + 6 - 30, topLeft.y + 6 - 15, { steps: 8 });
		await page.mouse.up();
		await expect.poll(async () => (await item.boundingBox())!.x).toBeLessThan(original.x - 25);
		const resized = (await item.boundingBox())!;
		expect(Math.abs(resized.x + resized.width - original.x - original.width)).toBeLessThan(1);
		expect(Math.abs(resized.y + resized.height - original.y - original.height)).toBeLessThan(1);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect
			.poll(async () => Math.abs((await item.boundingBox())!.x - original.x))
			.toBeLessThan(1);
		await page.locator(".editor-preview-frame").click({ position: { x: 8, y: 8 } });
		await expect(item).toHaveCSS("outline-style", "none");
		const beforeDrag = (await item.boundingBox())!;
		await page.mouse.move(
			beforeDrag.x + beforeDrag.width / 2,
			beforeDrag.y + beforeDrag.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			beforeDrag.x + beforeDrag.width / 2 - 50,
			beforeDrag.y + beforeDrag.height / 2 - 30,
			{ steps: 8 },
		);
		await page.mouse.up();
		await expect(item).toHaveCSS("outline-style", "solid");
		await expect
			.poll(async () => (await item.boundingBox())!.x)
			.toBeLessThan(beforeDrag.x - 45);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect
			.poll(async () => Math.abs((await item.boundingBox())!.x - beforeDrag.x))
			.toBeLessThan(1);
	});

test("clicking a selected text annotation does not select a different annotation", async ({
	page,
}) => {
	const toolbar = page.getByRole("toolbar", { name: "Annotation tools" });
	await toolbar.getByRole("button", { name: "Text", exact: true }).click();
	await toolbar.getByRole("button", { name: "Mask", exact: true }).click();
	await page.locator('[data-variant="annotation"]').first().click();
	const text = page
		.locator("[data-annotation-id]")
		.filter({ hasNot: page.locator("[data-blur-redaction]") });
	await text.click();
	await text.click();
	await expect(page.locator("aside").getByRole("textbox").first()).toBeVisible();
	await expect(text).toHaveCSS("outline-style", "solid");
});
