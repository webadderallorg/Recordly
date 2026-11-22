import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("wallpaper tiles add, select and remove custom backgrounds without nested controls", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const add = page.getByRole("button", { name: "Add wallpaper", exact: true });
	await expect(add).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole("button", { name: "Upload Custom", exact: true })).toHaveCount(0);
	const initialSelection = page.locator('aside button[aria-pressed="true"]');
	const originalName = await initialSelection.getAttribute("aria-label");
	const chooser = page.waitForEvent("filechooser");
	await add.click();
	await (await chooser).setFiles("public/wallpapers/wallpaper1.jpg");
	const custom = page.getByRole("button", { name: "Custom wallpaper 1", exact: true });
	const remove = page.getByRole("button", { name: "Remove Custom wallpaper 1", exact: true });
	await expect(custom).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator("aside button button")).toHaveCount(0);
	await page.getByRole("button", { name: "Rename project" }).hover();
	await expect(remove).toHaveCSS("opacity", "0");
	await custom.hover();
	await expect(remove).toHaveCSS("opacity", "1");
	await page.screenshot({
		path: "test-results/editor-wallpaper-hover.png",
		animations: "disabled",
	});
	// Removing an unselected tile must preserve the current background.
	const original = page.getByRole("button", { name: originalName!, exact: true });
	await original.click();
	await custom.hover();
	await remove.click();
	await expect(custom).toHaveCount(0);
	await expect(original).toHaveAttribute("aria-pressed", "true");
	// The same file can be added again and removed with the keyboard.
	const secondChooser = page.waitForEvent("filechooser");
	await add.click();
	await (await secondChooser).setFiles("public/wallpapers/wallpaper1.jpg");
	await expect(custom).toHaveAttribute("aria-pressed", "true");
	await remove.focus();
	await expect(remove).toHaveCSS("opacity", "1");
	await page.keyboard.press("Enter");
	await expect(custom).toHaveCount(0);
	await expect(original).toHaveAttribute("aria-pressed", "true");
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(add).toBeVisible({ timeout: 20000 });
	await expect(custom).toHaveCount(0);
});

test("video wallpapers share the gallery's add and remove controls", async ({ page }) => {
	test.setTimeout(60000);
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const original = page.locator('aside button[aria-pressed="true"]');
	await expect(original).toBeVisible({ timeout: 20000 });
	const originalName = await original.getAttribute("aria-label");
	await page.getByRole("row", { name: "Video", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Add video wallpaper", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Upload Video", exact: true })).toHaveCount(0);
	await page.evaluate(() => {
		window.electronAPI.openVideoFilePicker = async () => ({
			success: true,
			path: `${location.origin}/tests/ui/fixtures/preview.mp4`,
		});
	});
	await page.getByRole("button", { name: "Add video wallpaper", exact: true }).click();
	const video = page.getByRole("button", { name: "preview.mp4", exact: true });
	await expect(video).toHaveAttribute("aria-pressed", "true");
	const videoTile = await video.boundingBox();
	expect(videoTile!.height).toBeLessThan(50);
	await video.hover();
	await page.screenshot({
		path: "test-results/editor-video-wallpaper-hover.png",
		animations: "disabled",
	});
	await page.getByRole("button", { name: "Remove preview.mp4", exact: true }).click();
	await expect(video).toHaveCount(0);
	await expect(page.getByRole("button", { name: originalName!, exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
});

for (const format of ["png", "jpeg-empty-mime", "heic"] as const) {
	test(`imports and decodes a ${format} wallpaper`, async ({ page }) => {
		test.setTimeout(60000);
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		const add = page.getByRole("button", { name: "Add wallpaper", exact: true });
		await expect(add).toBeVisible({ timeout: 20000 });
		const chooser = page.waitForEvent("filechooser");
		await add.click();
		if (format === "png") {
			await (await chooser).setFiles({
				name: "background.PNG",
				mimeType: "image/png",
				buffer: Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
					"base64",
				),
			});
		} else if (format === "heic") {
			await (await chooser).setFiles("tests/ui/fixtures/wallpaper.heic");
		} else {
			const { readFile } = await import("node:fs/promises");
			await (await chooser).setFiles({
				name: "background.JPEG",
				mimeType: "",
				buffer: await readFile("tests/ui/fixtures/recording-thumbnail.jpg"),
			});
		}
		const custom = page.getByRole("button", { name: "Custom wallpaper 1", exact: true });
		await expect(custom).toHaveAttribute("aria-pressed", "true", { timeout: 20000 });
		const image = custom.locator("img");
		await expect.poll(() => image.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
		if (format === "heic") await expect(image).toHaveAttribute("src", /^data:image\/png;/);
		await page.reload();
		await expect(custom).toHaveAttribute("aria-pressed", "true", { timeout: 20000 });
	});
}

test("the image picker routes a video wallpaper into the Video tab", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.evaluate(() => {
		window.electronAPI.importWallpaperVideo = async () => ({
			success: true,
			path: `${location.origin}/tests/ui/fixtures/background.webm`,
		});
	});
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Add wallpaper", exact: true }).click();
	await (await chooser).setFiles("tests/ui/fixtures/background.webm");
	await expect(
		page.getByRole("button", { name: "background.webm", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator('[data-background-panel="video"]')).toBeVisible();
	await expect
		.poll(() =>
			page
				.getByRole("button", { name: "background.webm", exact: true })
				.locator("video")
				.evaluate((video) => video.videoWidth),
		)
		.toBeGreaterThan(0);
});

test("a corrupt image does not add a broken wallpaper or change selection", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const original = page.locator('aside button[aria-pressed="true"]');
	await expect(original).toBeVisible();
	const name = await original.getAttribute("aria-label");
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Add wallpaper", exact: true }).click();
	await (await chooser).setFiles({
		name: "broken.png",
		mimeType: "image/png",
		buffer: Buffer.from("not an image"),
	});
	await expect(page.getByText("Could not open this wallpaper.", { exact: false })).toBeVisible();
	await expect(page.getByRole("button", { name: "Custom wallpaper 1", exact: true })).toHaveCount(
		0,
	);
	await expect(page.getByRole("button", { name: name!, exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
});
