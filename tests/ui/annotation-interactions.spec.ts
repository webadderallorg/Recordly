import { expect, test, type Locator, type Page } from "@playwright/test";
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

async function add(page: Page, tool = "Text") {
	await page
		.getByRole("toolbar", { name: "Annotation tools" })
		.getByRole("button", { name: tool, exact: true })
		.click();
	const item = page.locator("[data-annotation-id]").last();
	await expect(item).toBeVisible();
	return item;
}
async function drag(page: Page, locator: Locator, dx: number, dy: number) {
	const box = (await locator.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
	await page.mouse.up();
}

test("property text is live, owns typing, and a complete typing run undoes once", async ({
	page,
}) => {
	const item = await add(page);
	const text = page.locator("aside textarea").first();
	await text.fill("First line");
	await text.press("End");
	await text.press("Enter");
	await text.pressSequentially("Second line T M");
	await expect(item.locator("[data-annotation-text]")).toHaveText("First line\nSecond line T M");
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	await text.press("Escape");
	await expect(text).not.toBeFocused();
	await item.click();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(item.locator("[data-annotation-text]")).toHaveText("Enter text...");
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(item.locator("[data-annotation-text]")).toHaveText("First line\nSecond line T M");
	await page.locator(".editor-preview-stage").click({ position: { x: 1, y: 1 } });
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(item.locator("[data-annotation-text]")).toHaveText("Enter text...");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.locator("[data-annotation-id]")).toHaveCount(0);
});

test("double-click edits multiline text with focus and Escape commits one undoable change", async ({
	page,
}) => {
	const item = await add(page);
	const before = (await item.boundingBox())!;
	await item.dblclick();
	const editor = page.getByRole("textbox", { name: "Edit annotation text", exact: true });
	await expect(editor).toBeFocused();
	await expect
		.poll(() =>
			editor.evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart),
		)
		.toBe("Enter text...".length);
	await editor.fill("Inline T M");
	await editor.dblclick();
	await expect(editor).toHaveValue("Inline T M");
	await editor.press("End");
	await editor.press("Enter");
	await editor.pressSequentially("Second line");
	await editor.press("ArrowLeft");
	await editor.press("Backspace");
	await expect(item).toHaveCount(1);
	expect(Math.abs((await item.boundingBox())!.x - before.x)).toBeLessThan(1);
	await editor.press("Escape");
	await expect(editor).toHaveCount(0);
	await expect(item.locator("[data-annotation-text]")).toHaveText("Inline T M\nSecond lie");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(item.locator("[data-annotation-text]")).toHaveText("Enter text...");
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(item.locator("[data-annotation-text]")).toHaveText("Inline T M\nSecond lie");
	await expect(editor).toHaveCount(0);
});

test("click-away commits inline text, unchanged edits add no history, and blank deletion restores", async ({
	page,
}) => {
	let item = await add(page);
	await item.dblclick();
	let editor = page.getByRole("textbox", { name: "Edit annotation text", exact: true });
	await editor.fill("Kept after click-away");
	await page.locator(".editor-preview-stage").click({ position: { x: 1, y: 1 } });
	await expect(item.locator("[data-annotation-text]")).toHaveText("Kept after click-away");
	await item.dblclick();
	await editor.press("ControlOrMeta+Enter");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(item.locator("[data-annotation-text]")).toHaveText("Enter text...");
	await item.dblclick();
	await editor.fill(" \n ");
	await editor.press("ControlOrMeta+Enter");
	await expect(page.locator("[data-annotation-id]")).toHaveCount(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	item = page.locator("[data-annotation-id]");
	await expect(item.locator("[data-annotation-text]")).toHaveText("Enter text...");
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(1);
});

test("corner resize wraps text at constant font size and exposes only four corner handles", async ({
	page,
}) => {
	const item = await add(page);
	await page
		.locator("aside textarea")
		.first()
		.fill("Many words in a long label which should wrap as its authored box gets narrower");
	await item.click();
	const label = item.locator("[data-annotation-text]");
	const font = await label.evaluate((node) => getComputedStyle(node).fontSize);
	const before = (await item.boundingBox())!;
	const labelBefore = (await label.boundingBox())!;
	await expect(item.locator("[data-annotation-resize]")).toHaveCount(4);
	await drag(
		page,
		item.locator('[data-annotation-resize="bottom-right"]'),
		-before.width * 0.45,
		10,
	);
	await expect
		.poll(async () => (await item.boundingBox())!.width)
		.toBeLessThan(before.width * 0.6);
	await expect(label).toHaveCSS("font-size", font);
	await expect
		.poll(async () => (await label.boundingBox())!.height)
		.toBeGreaterThan(labelBefore.height);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect
		.poll(async () => Math.abs((await item.boundingBox())!.width - before.width))
		.toBeLessThan(1);
});

for (const tool of ["Text", "Mask"]) {
	test(`${tool} arrow nudges use frame percentages and Escape dismisses selection`, async ({
		page,
	}) => {
		const item = await add(page, tool);
		await item.click();
		const before = (await item.boundingBox())!;
		await page.keyboard.press("ArrowRight");
		const one = (await item.boundingBox())!;
		expect(one.x).toBeGreaterThan(before.x);
		await page.keyboard.press("Shift+ArrowRight");
		const six = (await item.boundingBox())!;
		expect(Math.abs(six.x - before.x - (one.x - before.x) * 6)).toBeLessThan(1);
		await page.keyboard.press("Escape");
		await expect(item).toHaveCSS("outline-style", "none");
		await item.click();
		await page.keyboard.press("Delete");
		await expect(page.locator("[data-annotation-id]")).toHaveCount(0);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect(page.locator("[data-annotation-id]")).toHaveCount(1);
	});
}

test("sub-two-pixel movement is a click and adds no geometry undo step", async ({ page }) => {
	const item = await add(page);
	const before = (await item.boundingBox())!;
	await drag(page, item, 1, 0);
	expect(Math.abs((await item.boundingBox())!.x - before.x)).toBeLessThan(0.5);
	await page.locator(".editor-preview-stage").click({ position: { x: 1, y: 1 } });
	await item.click();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.locator("[data-annotation-id]")).toHaveCount(0);
});

test("font-size panel scales the authored box around its top center and undoes once", async ({
	page,
}) => {
	const item = await add(page);
	const before = (await item.boundingBox())!;
	const originalFont = Number.parseFloat(
		await item
			.locator("[data-annotation-text]")
			.evaluate((node) => getComputedStyle(node).fontSize),
	);
	await page
		.locator("aside")
		.getByRole("button", { name: "32 Select option", exact: true })
		.click();
	await page.getByRole("option", { name: /^64(?:px)?$/ }).click();
	await expect
		.poll(async () => (await item.boundingBox())!.width)
		.toBeGreaterThan(before.width * 1.9);
	const after = (await item.boundingBox())!;
	expect(Math.abs(after.y - before.y)).toBeLessThan(1);
	expect(Math.abs(after.x + after.width / 2 - before.x - before.width / 2)).toBeLessThan(1);
	expect(Math.abs(after.height - before.height * 2)).toBeLessThan(1);
	const newFont = Number.parseFloat(
		await item
			.locator("[data-annotation-text]")
			.evaluate((node) => getComputedStyle(node).fontSize),
	);
	expect(Math.abs(newFont - originalFont * 2)).toBeLessThan(0.1);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect
		.poll(async () => Math.abs((await item.boundingBox())!.width - before.width))
		.toBeLessThan(1);
});
