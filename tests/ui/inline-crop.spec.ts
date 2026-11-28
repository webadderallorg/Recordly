import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test.setTimeout(90000);

async function openCrop(page: Page) {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Crop", exact: true }).click({ timeout: 60000 });
	await expect(page.getByTestId("crop-surface")).toBeVisible();
}
async function selection(page: Page) {
	const box = await page.getByTestId("crop-selection").boundingBox();
	if (!box) throw new Error("Missing crop selection");
	return box;
}

test("edits the inline crop in source pixels and keeps those values after Done", async ({
	page,
}) => {
	await openCrop(page);
	const detailsButton = page.getByRole("button", { name: /^Crop details/ });
	await detailsButton.click();
	const left = page.getByRole("spinbutton", { name: "Left (px)", exact: true });
	const top = page.getByRole("spinbutton", { name: "Top (px)", exact: true });
	const width = page.getByRole("spinbutton", { name: "Width (px)", exact: true });
	const height = page.getByRole("spinbutton", { name: "Height (px)", exact: true });
	await expect(left).toBeEnabled();
	const source = await page
		.locator("video")
		.first()
		.evaluate((video: HTMLVideoElement) => ({
			width: video.videoWidth,
			height: video.videoHeight,
		}));
	const cropWidth = Math.floor(source.width / 2);
	const cropHeight = Math.floor(source.height / 2);
	await left.fill("31");
	await left.dispatchEvent("keydown", { key: "Enter", isComposing: true });
	await expect(left).toBeFocused();
	for (const [field, value] of [
		[left, 31],
		[top, 27],
		[width, cropWidth],
		[height, cropHeight],
	] as const) {
		await field.fill(String(value));
		await field.press("Enter");
		await expect(field).toHaveValue(String(value));
	}
	const [x, y, w, h] = await page.getByTestId("crop-selection").evaluate((element) => {
		const { left, top, width, height } = element.style;
		return [left, top, width, height].map(Number.parseFloat);
	});
	expect(x).toBeCloseTo((31 / source.width) * 100, 5);
	expect(y).toBeCloseTo((27 / source.height) * 100, 5);
	expect(w).toBeCloseTo((cropWidth / source.width) * 100, 5);
	expect(h).toBeCloseTo((cropHeight / source.height) * 100, 5);
	await expect(detailsButton).toContainText(`${cropWidth} × ${cropHeight} px`);

	await width.fill(String(cropWidth - 3));
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await expect(page.getByRole("button", { name: "Crop", exact: true })).toBeFocused();
	await page.getByRole("button", { name: "Crop", exact: true }).click();
	await detailsButton.click();
	await expect(left).toHaveValue("31");
	await expect(top).toHaveValue("27");
	await expect(width).toHaveValue(String(cropWidth - 3));
	await expect(height).toHaveValue(String(cropHeight));
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Crop details", exact: true })).toHaveCount(0);
	await expect(detailsButton).toBeFocused();
	await expect(page.getByTestId("crop-surface")).toBeVisible();
});

test("Shift preserves the starting crop ratio, cancel restores and done keeps it", async ({
	page,
}) => {
	await openCrop(page);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByText(/Hold Shift/)).toHaveCount(0);
	await page.keyboard.press("Space");
	await expect
		.poll(() =>
			page
				.locator("video")
				.first()
				.evaluate((video: HTMLVideoElement) => video.paused),
		)
		.toBe(true);
	const original = await selection(page);
	const cornerHandle = page.getByLabel("Resize crop: bottom right", { exact: true });
	let corner = await cornerHandle.boundingBox();
	await page.mouse.move(corner!.x + corner!.width / 2, corner!.y + corner!.height / 2);
	await page.mouse.down();
	await page.mouse.move(original.x + original.width * 0.8, original.y + original.height * 0.95);
	await page.mouse.up();
	const startingCrop = await selection(page);
	const startingRatio = startingCrop.width / startingCrop.height;
	expect(startingRatio).not.toBeCloseTo(original.width / original.height, 1);

	const selectionRatio = async () => {
		const box = await selection(page);
		return box.width / box.height;
	};
	const dragX = startingCrop.x + startingCrop.width * 0.6;
	const dragY = startingCrop.y + startingCrop.height * 0.85;
	corner = await cornerHandle.boundingBox();
	await page.mouse.move(corner!.x + corner!.width / 2, corner!.y + corner!.height / 2);
	await page.mouse.down();
	await page.mouse.move(dragX, dragY, { steps: 5 });
	const freeformRatio = await selectionRatio();
	expect(freeformRatio).not.toBeCloseTo(startingRatio, 1);

	await page.keyboard.down("Shift");
	await expect.poll(selectionRatio).toBeCloseTo(startingRatio, 2);
	await page.mouse.move(dragX - 20, dragY, { steps: 3 });
	await expect.poll(selectionRatio).toBeCloseTo(startingRatio, 2);
	await page.mouse.move(dragX, dragY);
	await page.keyboard.up("Shift");
	await expect.poll(selectionRatio).toBeCloseTo(freeformRatio, 2);
	await page.keyboard.down("Shift");
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await expect(page.getByTestId("crop-surface")).toHaveCount(0);
	await page.getByRole("button", { name: "Crop", exact: true }).click();
	const saved = await selection(page);
	expect(saved.width / saved.height).toBeCloseTo(startingRatio, 2);
	await page
		.locator("[data-inline-crop]")
		.getByRole("button", { name: "Reset", exact: true })
		.click();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("crop-surface")).toHaveCount(0);
	await page.getByRole("button", { name: "Crop", exact: true }).click();
	const restored = await selection(page);
	expect(restored.width).toBeCloseTo(saved.width, 0);
	expect(restored.height).toBeCloseTo(saved.height, 0);
});

test("switches visible crop presets and enters custom ratios from the size control", async ({
	page,
}) => {
	await openCrop(page);
	const detailsButton = page.getByRole("button", { name: /^Crop details/ });
	await page.screenshot({
		path: test.info().outputPath("recordly-crop-toolbar.png"),
		animations: "disabled",
	});
	const details = page.getByRole("dialog", { name: "Crop details", exact: true });
	const widePreset = page.getByRole("radio", { name: "16:9", exact: true });
	const squarePreset = page.getByRole("radio", { name: "1:1", exact: true });
	await expect(details).toHaveCount(0);
	await widePreset.click();
	const landscape = await selection(page);
	await squarePreset.press("Space");
	const square = await selection(page);
	expect(square.width / square.height).toBeCloseTo(1, 2);
	await page.screenshot({
		path: test.info().outputPath("recordly-crop-square.png"),
		animations: "disabled",
	});
	await widePreset.click();
	const landscapeAgain = await selection(page);
	expect(landscapeAgain.width).toBeCloseTo(landscape.width, 0);
	expect(landscapeAgain.height).toBeCloseTo(landscape.height, 0);
	await expect(widePreset).toBeChecked();
	await detailsButton.click();
	await expect(details).toBeVisible();
	await page.screenshot({
		path: test.info().outputPath("recordly-crop-details.png"),
		animations: "disabled",
	});

	const custom = details.getByRole("textbox", { name: "Custom · Aspect ratio", exact: true });
	await custom.fill("0:2");
	await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
	await custom.fill("3:2");
	await custom.press("Enter");
	await expect(detailsButton).toContainText("3:2");
	await page.keyboard.press("Escape");
	await expect(details).toHaveCount(0);
	let box = await selection(page);
	expect(box.width / box.height).toBeCloseTo(1.5, 2);
	const handle = await page
		.getByLabel("Resize crop: bottom right", { exact: true })
		.boundingBox();
	await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 5 });
	await page.mouse.up();
	box = await selection(page);
	expect(box.width / box.height).toBeCloseTo(1.5, 2);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 15, { steps: 3 });
	await page.mouse.up();
	const moved = await selection(page);
	expect(moved.width).toBeCloseTo(box.width, 0);
	expect(moved.height).toBeCloseTo(box.height, 0);
	expect(moved.x).toBeGreaterThan(box.x + 10);
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await page.screenshot({
		path: test.info().outputPath("recordly-crop-dark.png"),
		animations: "disabled",
	});
	await page.setViewportSize({ width: 800, height: 600 });
	await expect(widePreset).toBeInViewport({ ratio: 1 });
	await detailsButton.click();
	await expect(details).toBeInViewport({ ratio: 1 });
	const panelBounds = await details.boundingBox();
	const viewerBounds = await page.getByTestId("crop-surface").boundingBox();
	expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(viewerBounds!.x);
	await expect(page.getByRole("button", { name: "Done", exact: true })).toBeInViewport({
		ratio: 1,
	});
	await page.screenshot({
		path: test.info().outputPath("recordly-crop-compact.png"),
		animations: "disabled",
	});
});

for (const ratio of [1, 3]) {
	test(`Auto fits the entire ${ratio}:1 crop inside the preview after Done`, async ({ page }) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: /^Aspect ratio:/ }).click({ timeout: 60000 });
		await page
			.getByRole("dialog", { name: "Aspect ratio", exact: true })
			.getByRole("radio", { name: "Auto", exact: true })
			.check();
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Crop", exact: true }).click();
		if (ratio === 1) {
			await page.getByRole("radio", { name: "1:1", exact: true }).click();
		} else {
			await page.getByRole("button", { name: /^Crop details/ }).click();
			const details = page.getByRole("dialog", { name: "Crop details", exact: true });
			await details
				.getByRole("textbox", { name: "Custom · Aspect ratio", exact: true })
				.fill("3:1");
			await details.getByRole("button", { name: "Apply", exact: true }).click();
		}
		await page.getByRole("button", { name: "Done", exact: true }).click();
		const frame = page.locator(".editor-preview-frame");
		const canvas = frame.locator("canvas").first();
		await expect(canvas).toBeVisible();
		await expect
			.poll(async () => {
				const box = await frame.boundingBox();
				return box!.width / box!.height;
			})
			.toBeCloseTo(ratio, 2);
		const outer = await frame.boundingBox();
		const content = await canvas.boundingBox();
		const stage = await page.locator(".editor-preview-stage").boundingBox();
		expect(Math.abs(content!.width - outer!.width)).toBeLessThan(2);
		expect(Math.abs(content!.height - outer!.height)).toBeLessThan(2);
		expect(content!.y + content!.height).toBeLessThanOrEqual(stage!.y + stage!.height + 1);
		expect(content!.x + content!.width).toBeLessThanOrEqual(stage!.x + stage!.width + 1);
		await page.screenshot({ path: test.info().outputPath(`recordly-auto-crop-${ratio}.png`) });
	});
}
