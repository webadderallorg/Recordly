import { expect, test, type Page } from "@playwright/test";
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

test("crops directly in the preview, Shift snaps to square, cancel restores and done keeps it", async ({
	page,
}) => {
	await openCrop(page);
	await expect(page.getByRole("dialog")).toHaveCount(0);
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
	const corner = await page
		.getByLabel("Resize crop: bottom right", { exact: true })
		.boundingBox();
	await page.mouse.move(corner!.x + corner!.width / 2, corner!.y + corner!.height / 2);
	await page.mouse.down();
	await page.mouse.move(original.x + original.width * 0.7, original.y + original.height * 0.7, {
		steps: 5,
	});
	await page.keyboard.down("Shift");
	await expect
		.poll(async () => {
			const box = await selection(page);
			return Math.abs(box.width - box.height);
		})
		.toBeLessThan(1);
	await page.keyboard.up("Shift");
	await expect
		.poll(async () => {
			const box = await selection(page);
			return box.width / box.height;
		})
		.toBeGreaterThan(1.2);
	await page.keyboard.down("Shift");
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await expect(page.getByTestId("crop-surface")).toHaveCount(0);
	await page.getByRole("button", { name: "Crop", exact: true }).click();
	const saved = await selection(page);
	expect(Math.abs(saved.width - saved.height)).toBeLessThan(1);
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

test("custom aspect ratio uses a compact dialog, locks resizing and supports moving", async ({
	page,
}) => {
	await openCrop(page);
	await page.getByRole("button", { name: "Aspect ratio", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.screenshot({ path: test.info().outputPath("recordly-crop-ratio.png") });
	await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("0");
	await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
	await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("3");
	await page.getByRole("spinbutton", { name: "Height", exact: true }).fill("2");
	await page.getByRole("button", { name: "Apply", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
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
	await page.screenshot({ path: test.info().outputPath("recordly-inline-crop.png") });
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
		await page.getByRole("button", { name: "Aspect ratio", exact: true }).click();
		await page.getByRole("spinbutton", { name: "Width", exact: true }).fill(String(ratio));
		await page.getByRole("spinbutton", { name: "Height", exact: true }).fill("1");
		await page.getByRole("button", { name: "Apply", exact: true }).click();
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
