import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("webcam preview frame choices persist and inline crop updates immediately", async ({
	page,
}, testInfo) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentRecordingSession = async () => ({
			success: true,
			session: {
				videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
				webcamPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
				timeOffsetMs: 0,
			},
		});
		const set = window.electronAPI.setAppSetting;
		window.electronAPI.setAppSetting = (key, value) => {
			if (key === "recordly.editor.preferences")
				document.documentElement.dataset.webcamPreferences = JSON.stringify(
					(value as { webcam: unknown }).webcam,
				);
			return set(key, value);
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator(".editor-preview-frame")).toHaveClass(/loading-content-enter/, {
		timeout: 20000,
	});
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	const choices = page.getByRole("grid", { name: "Preview frame", exact: true });
	const soft = choices.getByRole("row", { name: "Soft blur", exact: true });
	const standard = choices.getByRole("row", { name: "Standard", exact: true });
	const layer = page.locator("[data-webcam-feather-preview]");
	await expect(soft).toHaveAttribute("aria-selected", "true");
	await expect(layer).not.toHaveCSS("mask-image", "none");
	await standard.click();
	await expect(layer).toHaveCSS("mask-image", "none");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(document.documentElement.dataset.webcamPreferences ?? "{}")
						.previewFrame,
			),
		)
		.toBe("standard");
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await page.getByRole("radio", { name: "Webcam", exact: true }).click();
	await expect(standard).toHaveAttribute("aria-selected", "true");
	await soft.click();
	await expect(layer).not.toHaveCSS("mask-image", "none");
	await expect(page.locator("[data-webcam-overlay]")).toBeVisible();
	await choices.screenshot({
		path: testInfo.outputPath("webcam-frame-selector.png"),
		animations: "disabled",
	});
	const crop = page.locator("[data-webcam-crop-control]");
	const handle = crop.getByRole("button", {
		name: "Resize webcam crop from bottom right",
		exact: true,
	});
	await handle.focus();
	await handle.press("ArrowLeft");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(document.documentElement.dataset.webcamPreferences ?? "{}")
						.cropRegion?.width,
			),
		)
		.toBeCloseTo(0.99, 5);
	for (const name of ["Cancel", "Done", "Reset"])
		await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
});
