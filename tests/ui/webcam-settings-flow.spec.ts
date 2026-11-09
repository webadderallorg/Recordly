import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("webcam import, anchor placement, precise adjustment and removal stay discoverable", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		let picks = 0;
		window.electronAPI.openVideoFilePicker = async () => {
			picks++;
			return picks === 2
				? { success: false }
				: { success: true, path: `${location.origin}/tests/ui/fixtures/preview.mp4` };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	const sidebar = page.locator("aside");
	await expect(sidebar.getByText("Add a webcam video", { exact: true })).toBeVisible();
	await expect(sidebar.getByRole("slider")).toHaveCount(0);
	await page.getByRole("button", { name: "Upload footage", exact: true }).click();
	await expect(sidebar.locator("[data-webcam-source]")).toHaveCount(0);
	const camera = page.locator("[data-webcam-motion-blur]");
	await expect(camera).toBeVisible();
	await expect(sidebar.getByRole("switch", { name: "Glass border", exact: true })).toHaveCount(0);
	for (const label of ["Appearance", "Shape"]) {
		await expect(sidebar.getByText(label, { exact: true })).toHaveCount(0);
	}
	await page.getByRole("row", { name: "Top left", exact: true }).click();
	await expect(page.getByRole("row", { name: "Top left", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const top = (await camera.boundingBox())!;
	await page.getByRole("row", { name: "Bottom right", exact: true }).click();
	await expect.poll(async () => (await camera.boundingBox())!.x).toBeGreaterThan(top.x + 50);
	await expect.poll(async () => (await camera.boundingBox())!.y).toBeGreaterThan(top.y + 50);
	await page.screenshot({
		path: "test-results/webcam-clean-controls.png",
		animations: "disabled",
	});
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	await page.getByRole("button", { name: "Webcam source", exact: true }).click();
	await page.getByRole("button", { name: "Change source", exact: true }).click();
	// Cancelling replacement keeps the linked source and placement intact.
	await expect(sidebar.getByText("preview.mp4", { exact: true })).toBeVisible();
	await expect(page.getByRole("row", { name: "Bottom right", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("switch", { name: "Custom position", exact: true })).toHaveCount(0);
	const topRight = page.getByRole("row", { name: "Top right", exact: true });
	await topRight.click();
	await expect(topRight).toHaveAttribute("aria-selected", "true");
	const beforeAdjustment = (await camera.boundingBox())!;
	const preview = (await page.locator("[data-preview-overlay]").boundingBox())!;
	const horizontalTravel = preview.width - beforeAdjustment.width;
	expect(horizontalTravel).toBeGreaterThan(0);
	const horizontal = page.getByRole("slider", { name: "Horizontal", exact: true });
	await horizontal.focus();
	await horizontal.press("Home");
	await horizontal.press("ArrowRight");
	await expect(horizontal).toHaveValue("1");
	// Manual position must move the rendered camera across the available preview,
	// rather than merely updating the slider or hiding a redundant label.
	await expect
		.poll(async () => beforeAdjustment.x - (await camera.boundingBox())!.x)
		.toBeGreaterThan(horizontalTravel / 2);
	await expect(sidebar.getByText("Custom position", { exact: true })).toHaveCount(0);
	await page.getByRole("row", { name: "Center", exact: true }).click();
	await expect(horizontal).toHaveValue("50");
	const show = page.getByRole("switch", { name: "Show", exact: true });
	await show.press("Space");
	await expect(camera).toBeHidden();
	await show.press("Space");
	await expect(camera).toBeVisible();
	await page.getByRole("button", { name: "Remove from project", exact: true }).click();
	await expect(sidebar.getByText("Add a webcam video", { exact: true })).toBeVisible();
	await expect(page.locator("[data-webcam-overlay]")).toHaveCount(0);
	await expect(camera).toBeHidden();
	await page.getByRole("button", { name: "Upload footage", exact: true }).click();
	await expect(sidebar.getByText("preview.mp4", { exact: true })).toBeVisible();
	await expect(camera).toBeVisible();
	await expect(page.getByRole("row", { name: "Center", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	// All actions fit within the sidebar rather than scrolling horizontally.
	expect(await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test("visual webcam shapes and source details support cancelling and changing footage", async ({
	page,
}, info) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const videoPath = `${location.origin}/tests/ui/fixtures/preview.mp4`;
		window.electronAPI.getCurrentRecordingSession = async () => ({
			success: true,
			session: { videoPath, webcamPath: videoPath, timeOffsetMs: 0 },
		});
		let picks = 0;
		window.electronAPI.openVideoFilePicker = async () =>
			++picks === 1
				? { success: false }
				: { success: true, path: `${location.origin}/tests/ui/fixtures/filmstrip.mp4` };
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	const sidebar = page.locator("aside");
	const source = sidebar.locator("[data-webcam-source]");
	await expect(source).toHaveCount(0);
	const positions = sidebar.getByRole("grid", { name: "Position", exact: true });
	await expect(
		sidebar.getByText("Or drag the webcam in the preview.", { exact: true }),
	).toHaveCount(0);
	const gridBounds = await positions.boundingBox();
	const controlsBounds = await sidebar.locator("[data-webcam-settings]").boundingBox();
	expect(gridBounds!.width).toBeCloseTo(controlsBounds!.width, 0);
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	await expect(source.getByText("preview.mp4", { exact: true })).toBeVisible();
	await expect(source.getByText("Webcam video", { exact: true })).toHaveCount(0);
	await expect(sidebar.getByRole("button", { name: "Replace footage", exact: true })).toHaveCount(
		0,
	);
	await expect(source).toHaveCSS("border-top-width", "0px");
	const shapes = sidebar.getByRole("grid", { name: "Shape", exact: true });
	for (const name of ["Circle", "Square", "Rectangle"]) {
		const option = shapes.getByRole("row", { name, exact: true });
		await expect(option.locator("svg")).toBeVisible();
		await expect(option.locator("svg [stroke]")).toHaveCount(0);
		await option.click();
		await expect(option).toHaveAttribute("aria-selected", "true");
	}
	await sidebar.screenshot({ path: info.outputPath("webcam-visual-controls.png") });
	const file = source.getByRole("button", { name: "Webcam source", exact: true });
	await file.focus();
	await file.press("Enter");
	const details = page.getByRole("dialog", { name: "Webcam source", exact: true });
	await expect(details.getByText(/\/tests\/ui\/fixtures\/preview\.mp4$/)).toBeVisible();
	await details.screenshot({ path: info.outputPath("webcam-source-details.png") });
	await page.keyboard.press("Escape");
	await expect(details).toBeHidden();
	await expect(file).toBeFocused();
	await file.click();
	await details.getByRole("button", { name: "Change source", exact: true }).click();
	await expect(details).toBeHidden();
	await expect(source.getByText("preview.mp4", { exact: true })).toBeVisible();
	await file.click();
	await details.getByRole("button", { name: "Change source", exact: true }).click();
	await expect(source.getByText("filmstrip.mp4", { exact: true })).toBeVisible();
	await expect(shapes.getByRole("row", { name: "Rectangle", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	expect(await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});
