import { expect, type Locator, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

const VIEWPORTS = [
	{ label: "minimum desktop", width: 800, height: 600 },
	{ label: "short window", width: 1280, height: 600 },
];

function activePreviewVideo(page: Page) {
	return page.locator(".editor-preview-stage video").first();
}

async function openCropDialog(
	page: Page,
	videoFixture: string,
	viewport: { width: number; height: number },
) {
	await installDesktopBridge(page, videoFixture);
	await page.setViewportSize(viewport);
	await page.goto("/?windowType=editor");

	await expect(page.getByRole("navigation", { name: "Editor tools" })).toBeVisible({
		timeout: 20000,
	});
	await expect
		.poll(() =>
			activePreviewVideo(page).evaluate(
				(video) => (video as HTMLVideoElement).readyState >= 2,
			),
		)
		.toBe(true);

	await page.getByRole("button", { name: "Crop Video", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Crop Video", exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function expectCanvasRatio(dialog: Locator, aspectRatio: number) {
	await expect
		.poll(async () => {
			const box = await dialog.locator("canvas").boundingBox();
			return box ? box.width / box.height : 0;
		})
		.toBeCloseTo(aspectRatio, 1);
}

async function expectFittedDialog(dialog: Locator, aspectRatio: number) {
	await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeInViewport();

	await expectCanvasRatio(dialog, aspectRatio);

	const dimensions = await dialog.evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
	}));
	expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
}

for (const viewport of VIEWPORTS) {
	test(`crop dialog keeps a landscape source ratio and Done visible in a ${viewport.label}`, async ({
		page,
	}) => {
		test.setTimeout(120000);
		const dialog = await openCropDialog(page, "preview.mp4", viewport);
		await expectFittedDialog(dialog, 16 / 9);
		await page.screenshot({
			path: `test-results/crop-dialog-landscape-${viewport.width}x${viewport.height}.png`,
			animations: "disabled",
		});
	});

	test(`crop dialog keeps a portrait source ratio and Done visible in a ${viewport.label}`, async ({
		page,
	}) => {
		test.setTimeout(120000);
		const dialog = await openCropDialog(page, "preview-portrait.mp4", viewport);
		await expectFittedDialog(dialog, 180 / 320);
		await page.screenshot({
			path: `test-results/crop-dialog-portrait-${viewport.width}x${viewport.height}.png`,
			animations: "disabled",
		});
	});
}

test("crop preview follows late metadata on the bound video element", async ({ page }) => {
	test.setTimeout(120000);
	const dialog = await openCropDialog(page, "preview.mp4", VIEWPORTS[1]);
	await expectCanvasRatio(dialog, 16 / 9);

	// Simulate a source whose metadata lands after the dialog opened. Overriding
	// the instance dimensions keeps the assertion on the element CropControl
	// actually subscribed to.
	await activePreviewVideo(page).evaluate((video) => {
		Object.defineProperty(video, "videoWidth", { value: 360, configurable: true });
		Object.defineProperty(video, "videoHeight", { value: 640, configurable: true });
		video.dispatchEvent(new Event("loadedmetadata"));
	});

	await expectCanvasRatio(dialog, 360 / 640);
	await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
});
