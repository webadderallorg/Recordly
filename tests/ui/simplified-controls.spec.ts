import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("eight cursor styles in one grid with Scale on click above Hide when idle", async ({
	page,
}, testInfo) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	const styles = page.getByRole("grid", { name: "Cursor Style", exact: true });
	await expect(styles.getByRole("row")).toHaveCount(8);
	for (const row of await styles.getByRole("row").all()) await expect(row).toBeVisible();
	const positions = await styles
		.getByRole("row")
		.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().y));
	expect(new Set(positions.slice(0, 4)).size).toBe(1);
	expect(new Set(positions.slice(4)).size).toBe(1);
	expect(positions[4]).toBeGreaterThan(positions[0]);
	await expect(page.getByText("More styles", { exact: true })).toHaveCount(0);
	await styles.getByRole("row", { name: "Pixel Glove", exact: true }).click();
	await expect(styles.getByRole("row", { name: "Pixel Glove", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await styles.getByRole("row", { name: "Golden Gate", exact: true }).click();
	await expect(styles.getByRole("row", { name: "Golden Gate", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const scale = page.getByRole("switch", { name: "Scale on click", exact: true });
	const idle = page.getByRole("switch", { name: "Hide when idle", exact: true });
	await expect(scale).toBeVisible();
	expect((await idle.boundingBox())!.y).toBeGreaterThan((await scale.boundingBox())!.y);
	expect((await idle.boundingBox())!.y - (await scale.boundingBox())!.y).toBeLessThanOrEqual(32);
	await page
		.locator("aside")
		.screenshot({ path: testInfo.outputPath("cursor-settings.png"), animations: "disabled" });
	await expect(idle).toBeChecked();
	await idle.press("Space");
	await expect(idle).not.toBeChecked();
	await idle.press("Space");
	await page.getByRole("switch", { name: "Advanced settings", exact: true }).press("Space");
	await expect(idle).toBeChecked();
	for (const name of ["Idle detection", "Fade delay", "Fade duration", "Movement tolerance"])
		await expect(page.getByRole("slider", { name, exact: true })).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath("cursor.png"), animations: "disabled" });
});

test("Generate captions downloads once and continues without a second click", async ({
	page,
}, testInfo) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		// The desktop engine receives a local recording path; the browser preview
		// serves its bytes from the fixture without pretending it is remote media.
		window.electronAPI.getCurrentVideoPath = async () => ({
			success: true,
			path: "/recordings/preview.mp4",
		});
		window.electronAPI.getLocalMediaUrl = async () => ({
			success: true,
			url: `${location.origin}/tests/ui/fixtures/preview.mp4`,
		});
		window.electronAPI.downloadCaptionModel = async () => {
			document.documentElement.dataset.speechDownloads = "1";
			await new Promise<void>((resolve) =>
				window.addEventListener("recordly-test-download", () => resolve(), { once: true }),
			);
			return { success: true, path: "/models/parakeet-v3" };
		};
		window.electronAPI.generateAutoCaptions = async () => {
			document.documentElement.dataset.captionGenerations = "1";
			return {
				success: true,
				cues: [{ id: "one", startMs: 0, endMs: 1000, text: "One click captions" }],
			};
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await expect(page.getByText(/First use downloads 670 MB/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Download Model", exact: true })).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath("captions.png"), animations: "disabled" });
	await page.getByRole("button", { name: "Generate Captions", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-speech-downloads", "1");
	await expect(page.getByRole("button", { name: /Downloading/ })).toBeDisabled();
	await page.evaluate(() => window.dispatchEvent(new Event("recordly-test-download")));
	await expect(page.locator("html")).toHaveAttribute("data-caption-generations", "1");
	await expect(
		page.getByRole("button", { name: "Regenerate Captions", exact: true }),
	).toBeEnabled();
	await expect(page.getByText(/First use downloads/)).toHaveCount(0);
	await page.getByRole("switch", { name: "Advanced settings", exact: true }).press("Space");
	await expect(page.getByRole("button", { name: /Parakeet v3 Speech model/ })).toBeVisible();
});

test("export uses defaults and reveals FPS and CUDA only under Advanced", async ({
	page,
}, testInfo) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getNativeExportCapabilities = async () =>
			({
				success: true,
				capabilities: { nvidiaCuda: { available: true } },
			}) as Awaited<ReturnType<typeof window.electronAPI.getNativeExportCapabilities>>;
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await page.getByRole("row", { name: "Save video", exact: true }).click();
	await expect(page.getByRole("grid", { name: "FPS", exact: true })).toHaveCount(0);
	await expect(page.getByRole("switch", { name: "NVIDIA CUDA", exact: true })).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath("export.png"), animations: "disabled" });
	const more = page.getByRole("switch", { name: "Advanced", exact: true });
	await more.press("Space");
	const fps = page.getByRole("grid", { name: "FPS", exact: true });
	await expect(fps).toBeVisible();
	await expect(fps.getByRole("row", { name: "30", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await fps.getByRole("row", { name: "60", exact: true }).click();
	await expect(page.getByRole("switch", { name: "NVIDIA CUDA", exact: true })).toBeVisible();
	await more.press("Space");
	await expect(fps).toHaveCount(0);
	await more.press("Space");
	await expect(fps.getByRole("row", { name: "60", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await more.press("Space");
	await page.getByRole("row", { name: "GIF", exact: true }).click();
	await expect(fps).toHaveCount(0);
	await more.press("Space");
	await expect(fps.getByRole("row", { name: "15", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("switch", { name: "NVIDIA CUDA", exact: true })).toHaveCount(0);
});
