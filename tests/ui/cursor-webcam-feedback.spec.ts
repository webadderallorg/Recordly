import { writeFile } from "node:fs/promises";
import { expect, type Locator, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function fade(scroller: Locator, edge: "start" | "end") {
	return scroller.evaluate(
		(element, side) =>
			Number.parseFloat(
				getComputedStyle(element).getPropertyValue(`--scroll-shadow-${side}-fade`),
			) || 0,
		edge,
	);
}

async function checkScrollFade(scroller: Locator, fadeSize = 16) {
	await expect(scroller).toBeVisible();
	await expect(scroller).not.toHaveCSS("mask-image", "none");
	await expect
		.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
		.toBeGreaterThan(16);
	await scroller.evaluate((el) => {
		el.scrollTop = 0;
	});
	await expect.poll(() => fade(scroller, "start")).toBeLessThan(0.1);
	await expect.poll(() => fade(scroller, "end")).toBeGreaterThan(fadeSize - 0.1);
	await scroller.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect.poll(() => fade(scroller, "end")).toBeLessThan(0.1);
	await expect.poll(() => fade(scroller, "start")).toBeGreaterThan(fadeSize - 0.1);
}

test("cursor previews respond to hover and keyboard focus without changing selection", async ({
	page,
}, info) => {
	await installDesktopBridge(page);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	const styles = page.getByRole("grid", { name: "Cursor Style", exact: true });
	const windows = styles.getByRole("row", { name: "Windows 11", exact: true });
	await page.mouse.move(1100, 50);
	await expect(windows.locator("img:visible")).toHaveCount(1);
	const arrow = await windows.locator("img:visible").getAttribute("src");
	const selected = await windows.getAttribute("aria-selected");
	await windows.hover();
	await expect.poll(() => windows.locator("img:visible").getAttribute("src")).not.toBe(arrow);
	await expect(windows).toHaveAttribute("aria-selected", selected!);
	const order = await styles
		.getByRole("row")
		.evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
	expect(order[2]).toBe("Bold Outline");
	expect(order[5]).toBe("Minimal");
	await page.mouse.move(1100, 50);
	await page.keyboard.press("Tab");
	await windows.focus();
	await expect.poll(() => windows.locator("img:visible").getAttribute("src")).not.toBe(arrow);
	await expect(windows).toHaveAttribute("aria-selected", selected!);

	const ripple = page
		.getByRole("grid", { name: "Click Effects", exact: true })
		.getByRole("row", { name: "Ripple", exact: true });
	const preview = ripple.locator("svg").locator("..");
	await ripple.hover();
	await expect(preview).not.toHaveCSS("animation-name", "none");
	const transform = await preview.evaluate((el) => getComputedStyle(el).transform);
	await expect
		.poll(() => preview.evaluate((el) => getComputedStyle(el).transform))
		.not.toBe(transform);
	await expect(ripple).toHaveAttribute("aria-selected", "false");
	await page.mouse.move(1100, 50);
	await page.keyboard.press("Tab");
	await ripple.focus();
	await expect(preview).not.toHaveCSS("animation-name", "none");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(preview).toHaveCSS("animation-name", "none");
	await expect(ripple).toHaveAttribute("aria-selected", "false");
	await styles.screenshot({ path: info.outputPath("cursor-styles.png") });
});

test("rectangle camera dimensions and sharp corners survive reopening", async ({ page }, info) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentRecordingSession = async () => ({
			success: true,
			session: {
				videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
				webcamPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
				timeOffsetMs: 0,
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Crop", exact: true })).toBeEnabled({
		timeout: 20000,
	});
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	const rectangle = page.getByRole("row", { name: "Rectangle", exact: true });
	await rectangle.click();
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	const height = page.getByRole("slider", { name: "Webcam Height", exact: true });
	await expect(height).toBeVisible();
	await height.focus();
	await height.press("Home");
	await height.press("ArrowRight");
	await expect(height).toHaveValue("11");
	const mask = page.locator('div[style*="clip-path"][style*="contain: paint"]:has(video)');
	await expect(mask).toHaveCSS("clip-path", /^inset\(/);
	await expect(mask.locator(":scope > div:has(video)")).toHaveCSS("opacity", "1");
	await expect
		.poll(() =>
			mask.evaluate((el) => {
				const box = el.getBoundingClientRect();
				return box.width / box.height;
			}),
		)
		.toBeGreaterThan(3);
	await expect(page.getByRole("slider", { name: "Webcam Roundness", exact: true })).toHaveValue(
		"20",
	);
	await page.screenshot({
		path: info.outputPath("rectangle-camera.png"),
		animations: "disabled",
	});
	await page.reload();
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await expect(rectangle).toHaveAttribute("aria-selected", "true");
	await expect(height).toHaveValue("11");
	await expect(mask).toHaveCSS("clip-path", /^inset\(/);
});

test("background tabs retain gallery and following-control positions with live scroll fades", async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const gallery = page.getByTestId("background-slider");
	const scroller = page.locator("aside .custom-scrollbar").filter({ visible: true });
	const positions = [];
	for (const name of ["Image", "Colors", "Video", "Image"]) {
		await page.getByRole("row", { name, exact: true }).click();
		await scroller.evaluate((el) => {
			el.scrollTop = 0;
		});
		await expect(gallery).toBeVisible();
		positions.push(
			await gallery.evaluate((el) => {
				const box = el.getBoundingClientRect();
				return {
					y: box.y,
					height: box.height,
					nextTop: el.parentElement!.getBoundingClientRect().bottom,
				};
			}),
		);
		await page.locator("aside").screenshot({
			path: info.outputPath(`background-${name.toLowerCase()}.png`),
			animations: "disabled",
		});
	}
	await info.attach("background-gallery-positions", {
		body: JSON.stringify(positions),
		contentType: "application/json",
	});
	await writeFile(info.outputPath("gallery-positions.json"), JSON.stringify(positions, null, 2));
	for (const position of positions) {
		expect(Math.abs(position.y - positions[0].y)).toBeLessThan(1);
		expect(Math.abs(position.height - positions[0].height)).toBeLessThan(1);
		expect(Math.abs(position.nextTop - positions[0].nextTop)).toBeLessThan(1);
		expect(position.height, "gallery remains bounded within the editor sidebar").toBeLessThan(
			320,
		);
	}
	await info.attach("background-gallery-positions", {
		body: JSON.stringify(positions),
		contentType: "application/json",
	});
	await page.setViewportSize({ width: 1440, height: 600 });
	await checkScrollFade(scroller);
	await page.setViewportSize({ width: 1440, height: 1800 });
	await expect
		.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
		.toBeLessThanOrEqual(1);
	await expect.poll(() => fade(scroller, "end")).toBeLessThan(0.1);
	await expect.poll(() => fade(scroller, "start")).toBeLessThan(0.1);
	await expect(scroller).toHaveCSS("mask-image", "none");
	await page.setViewportSize({ width: 1440, height: 600 });
	await checkScrollFade(scroller);
});

test("large custom galleries stay bounded without creating an oversized empty video tab", async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const getAppSetting = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.editor.preferences"
				? {
						...(getAppSetting(key) as object),
						customWallpapers: Array.from(
							{ length: 40 },
							(_, i) =>
								`${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg?wallpaper=${i}`,
						),
					}
				: getAppSetting(key);
	});
	await page.goto("/?windowType=editor");
	const gallery = page.getByTestId("background-slider");
	const images = page.locator('[data-background-scroller="image"]');
	await expect
		.poll(() => images.evaluate((el) => el.scrollHeight - el.clientHeight))
		.toBeGreaterThan(200);
	await checkScrollFade(images, 12);
	await images.screenshot({ path: info.outputPath("large-gallery-scrolled-bottom.png") });
	await expect(images.locator(".wallpaper-tile").last()).toBeInViewport();
	const imageHeight = (await gallery.boundingBox())!.height;
	expect(imageHeight).toBeLessThanOrEqual(273);
	await page.getByRole("row", { name: "Video", exact: true }).click();
	await expect
		.poll(async () => (await gallery.boundingBox())!.height)
		.toBeCloseTo(imageHeight, 0);
	const video = page.locator('[data-background-scroller="video"]');
	await expect
		.poll(() => video.evaluate((el) => el.scrollHeight - el.clientHeight))
		.toBeLessThanOrEqual(1);
	await expect(video).toHaveCSS("mask-image", "none");
	await expect.poll(() => fade(video, "start")).toBeLessThan(0.1);
	await expect.poll(() => fade(video, "end")).toBeLessThan(0.1);
	await page.locator("aside").screenshot({
		path: info.outputPath("large-gallery-video-tab.png"),
		animations: "disabled",
	});
	await page.getByRole("row", { name: "Image", exact: true }).click();
	await expect.poll(() => images.evaluate((el) => el.scrollTop)).toBe(0);
	await expect(images.locator("[data-background-panel=image]")).toHaveCSS(
		"animation-name",
		"editor-section-enter",
	);
	await checkScrollFade(images, 12);
});

test("annotation and application settings fades clear when reaching their last control", async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 600 });
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Annotation", exact: true }).click();
	await checkScrollFade(page.locator("aside .custom-scrollbar").filter({ visible: true }));
	await page.locator("aside").screenshot({
		path: info.outputPath("annotation-scrolled-bottom.png"),
		animations: "disabled",
	});
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	const settings = page.getByRole("dialog", { name: "Settings", exact: true });
	await expect(settings).not.toHaveAttribute("data-entering");
	await checkScrollFade(settings.getByRole("tabpanel"));
	await settings.screenshot({
		path: info.outputPath("application-settings-scrolled-bottom.png"),
		animations: "disabled",
	});
});

test.describe("Retina camera preview", () => {
	test.use({ deviceScaleFactor: 2 });
	test("zoom blur retains physical pixels while keeping the CSS overlay size", async ({
		page,
	}, info) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.goto("/tests/ui/webcam-motion-blur.html");
		await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
		await page.getByRole("button", { name: "Play", exact: true }).click();
		const blurred = page.locator("[data-webcam-motion-blur]");
		await expect(blurred).toBeVisible({ timeout: 5000 });
		const pixels = await blurred.evaluate((el) => {
			const canvas = el as HTMLCanvasElement;
			return {
				width: canvas.width,
				height: canvas.height,
				cssWidth: parseFloat(canvas.style.width),
				cssHeight: parseFloat(canvas.style.height),
				dpr: devicePixelRatio,
			};
		});
		expect(pixels.dpr).toBe(2);
		expect(pixels.width / pixels.cssWidth).toBeCloseTo(2, 5);
		expect(pixels.height / pixels.cssHeight).toBeCloseTo(2, 5);
		await page.screenshot({ path: info.outputPath("webcam-retina-zoom.png") });
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		await expect(blurred).toBeHidden();
		await expect(page.locator("[data-webcam-overlay]")).toHaveCSS("visibility", "visible");
	});
});

test("custom swatch removals update reserved gallery rows without changing selection", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		localStorage.setItem(
			"recordly.editor.preferences",
			JSON.stringify({
				wallpaper: "#123456",
				customColors: ["#010100", "#010101", "#010102", "#010103"],
				customGradients: ["linear-gradient(1deg, #123456 0%, #654321 100%)"],
			}),
		);
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("row", { name: "Colors", exact: true }).click();
	const reservedSlots = page
		.getByTestId("background-slider")
		.locator(':scope > [aria-hidden="true"] > div');
	const selected = page.getByRole("button", { name: "Background color #123456", exact: true });
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	await expect(reservedSlots).toHaveCount(31);
	await page.getByRole("button", { name: "Remove custom color #010100", exact: true }).click();
	// This removal crosses a five-column row boundary while the selection stays unchanged.
	await expect(reservedSlots).toHaveCount(30);
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: "Remove Custom gradient 1", exact: true }).click();
	await expect(reservedSlots).toHaveCount(29);
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByRole("row", { name: "Colors", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
});
