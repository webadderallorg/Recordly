import { expect, type Locator, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function openCropDialog(page: Page, videoFixture: string) {
	await installDesktopBridge(page, videoFixture);
	await page.setViewportSize({ width: 1280, height: 600 });
	await page.goto("/?windowType=editor");

	await expect(page.getByRole("navigation", { name: "Editor tools" })).toBeVisible({
		timeout: 20000,
	});
	await expect
		.poll(() =>
			page
				.locator("video")
				.evaluateAll((videos) =>
					videos.some((video) => (video as HTMLVideoElement).readyState >= 2),
				),
		)
		.toBe(true);

	await page.getByRole("button", { name: "Crop Video", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Crop Video", exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function expectFittedDialog(dialog: Locator, aspectRatio: number) {
	await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeInViewport();

	await expect
		.poll(async () => {
			const box = await dialog.locator("canvas").boundingBox();
			return box ? box.width / box.height : 0;
		})
		.toBeCloseTo(aspectRatio, 1);

	const dimensions = await dialog.evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
	}));
	expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
}

test("crop dialog keeps a landscape source ratio and Done visible in short windows", async ({
	page,
}) => {
	test.setTimeout(120000);
	const dialog = await openCropDialog(page, "preview.mp4");
	await expectFittedDialog(dialog, 16 / 9);
	await page.screenshot({
		path: "test-results/crop-dialog-short.png",
		animations: "disabled",
	});
});

test("crop dialog keeps a portrait source ratio and Done visible in short windows", async ({
	page,
}) => {
	test.setTimeout(120000);
	const dialog = await openCropDialog(page, "preview-portrait.mp4");
	await expectFittedDialog(dialog, 180 / 320);
	await page.screenshot({
		path: "test-results/crop-dialog-portrait.png",
		animations: "disabled",
	});
});
