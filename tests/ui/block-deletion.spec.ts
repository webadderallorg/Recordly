import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
});

test("clip keyboard deletion is wired through the editor and undo restores it", async ({
	page,
}) => {
	const clips = page.locator('[data-variant="clip"]');
	await clips.click({ position: { x: 100, y: 20 } });
	await page.keyboard.press("Backspace");
	await expect(clips).toHaveCount(0);
	await page.keyboard.press("Meta+z");
	await expect(clips).toHaveCount(1);
	await clips.click({ position: { x: 100, y: 20 } });
	await page.keyboard.press("Delete");
	await expect(clips).toHaveCount(0);
});

test("zoom can be deleted after using its inspector", async ({ page }) => {
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(1);
	await zoom.click();
	await expect(page.getByRole("button", { name: "Delete Zoom", exact: true })).toHaveCount(1);
	await page.locator("aside").getByRole("row", { name: "Manual", exact: true }).click();
	await page.keyboard.press("Backspace");
	await expect(zoom).toHaveCount(0);
});

test("annotation deletion works from its inspector without deleting while typing", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Annotation", exact: true }).click();
	const annotation = page.locator('[data-variant="annotation"]');
	await expect(annotation).toHaveCount(1);
	await annotation.click();
	const text = page.locator("aside").getByRole("textbox").first();
	await text.fill("Keep this annotation");
	await page.keyboard.press("Backspace");
	await expect(annotation).toHaveCount(1);
	const remove = page.getByRole("button", { name: "Delete Annotation", exact: true });
	await remove.focus();
	await page.keyboard.press("Delete");
	await expect(annotation).toHaveCount(0);
});

test("audio deletion works after changing inspector focus", async ({ page }) => {
	await page.locator('[data-variant="clip"]').click({ position: { x: 100, y: 20 } });
	await page.evaluate(() => {
		window.electronAPI.openAudioFilePicker = async () => ({
			success: true,
			path: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
		});
	});
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Audio", exact: true }).click();
	const audio = page.locator('[data-variant="audio"]');
	await expect(audio).toHaveCount(1);
	await audio.click();
	const remove = page.getByRole("button", { name: "Delete Audio", exact: true });
	await remove.focus();
	await page.keyboard.press("Backspace");
	await expect(audio).toHaveCount(0);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
});

test("caption remains deletable after the playhead leaves its span", async ({ page }) => {
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	const showCaptions = page.getByRole("switch", { name: "Show", exact: true });
	await page
		.locator('[data-slot="switch"]')
		.filter({ has: showCaptions })
		.locator('[data-slot="switch-control"]')
		.click();
	await expect(showCaptions).toBeChecked();
	await page
		.locator("[data-caption-add-target]")
		.first()
		.click({ position: { x: 100, y: 8 } });
	const caption = page.locator('[data-variant="caption"]');
	await expect(caption).toHaveCount(1);
	const text = page.getByRole("textbox", { name: "Text", exact: true });
	await text.fill("Caption to delete");
	await page.keyboard.press("Backspace");
	await expect(caption).toHaveCount(1);
	await page.getByRole("button", { name: "Skip Forward", exact: true }).click();
	await expect
		.poll(async () => {
			const label = await page.getByTestId("playhead-cap").getAttribute("aria-label");
			return Number(label?.match(/[\d.]+/)?.[0]) * 1000;
		})
		.toBeGreaterThan(Number(await caption.getAttribute("data-end-ms")));
	await page.keyboard.press("Delete");
	await expect(caption).toHaveCount(0);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
});

test("inspector delete buttons remove clips and zooms", async ({ page }) => {
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	const zoom = page.locator('[data-variant="zoom"]');
	await zoom.click();
	await expect(page.locator("aside").getByRole("grid", { name: "Zoom level" })).toBeVisible();
	await expect(page.locator("aside").getByText("Animation", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("radio", { name: "Extensions", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Account", exact: true })).toHaveCount(0);
	await page.screenshot({
		path: "test-results/zoom-inspector-cleaned.png",
		animations: "disabled",
	});
	await page.getByRole("button", { name: "Delete Zoom", exact: true }).click();
	await expect(zoom).toHaveCount(0);
	const clip = page.locator('[data-variant="clip"]');
	await clip.click({ position: { x: 100, y: 20 } });
	await page.getByRole("button", { name: "Delete Clip", exact: true }).click();
	await expect(clip).toHaveCount(0);
});

test("tool navigation leaves the annotation inspector", async ({ page }) => {
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Annotation", exact: true }).click();
	await page.locator('[data-variant="annotation"]').click();
	await expect(
		page.getByRole("button", { name: "Delete Annotation", exact: true }),
	).toBeVisible();
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect(
		page.locator("aside").getByRole("heading", { name: "Cursor", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("slider", { name: "Cursor Size", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Delete Annotation", exact: true })).toHaveCount(
		0,
	);
	await page.keyboard.press("Delete");
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(1);
});

test("a dragged annotation can be selected across its whole block and deleted without deleting footage", async ({
	page,
}) => {
	const clip = page.locator('[data-variant="clip"]');
	await clip.click({ position: { x: 100, y: 20 } });
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Annotation", exact: true }).click();
	const annotation = page.locator('[data-variant="annotation"]');
	const box = (await annotation.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 12 });
	await page.mouse.up();
	await expect
		.poll(async () => Number(await annotation.getAttribute("data-start-ms")))
		.toBeGreaterThan(0);
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await annotation.click({ position: { x: 40, y: 1 } });
	await expect(
		page.getByRole("button", { name: "Delete Annotation", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Delete");
	await expect(annotation).toHaveCount(0);
	await expect(clip).toHaveCount(1);
});
