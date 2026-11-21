import path from "node:path";
import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("caption model is available in standard settings and the bin clears captions directly", async ({
	page,
}, testInfo) => {
	test.setTimeout(60000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => ({
			success: true,
			path: "/recordings/caption-test.mp4",
		});
		window.electronAPI.getLocalMediaUrl = async () => ({
			success: true,
			url: `${location.origin}/video?path=%2Frecordings%2Fcaption-test.mp4`,
		});
		window.electronAPI.getCaptionModelStatus = async () => ({ success: true, exists: false });
		window.electronAPI.onCaptionModelDownloadProgress = (callback) => {
			const listener = (event: Event) => callback((event as CustomEvent).detail);
			window.addEventListener("caption-model-progress", listener);
			return () => window.removeEventListener("caption-model-progress", listener);
		};
		window.electronAPI.downloadCaptionModel = (modelId) =>
			new Promise((resolve) => {
				window.addEventListener(
					"complete-caption-model-download",
					() => resolve({ success: true, path: `/models/${modelId}` }),
					{ once: true },
				);
			});
		window.electronAPI.generateAutoCaptions = async (options) => {
			document.documentElement.dataset.captionGenerationCount = String(
				Number(document.documentElement.dataset.captionGenerationCount ?? 0) + 1,
			);
			document.documentElement.dataset.captionGeneratedModel = options.captionModelId;
			return {
				success: true,
				cues: [
					{
						id: "caption-1",
						startMs: 0,
						endMs: 5000,
						text: "Captions follow your words",
						words: [
							{ text: "Captions", startMs: 0, endMs: 1000 },
							{ text: "follow", startMs: 1000, endMs: 2000, leadingSpace: true },
							{ text: "your", startMs: 2000, endMs: 3000, leadingSpace: true },
							{ text: "words", startMs: 3000, endMs: 5000, leadingSpace: true },
						],
					},
				],
			};
		};
		window.electronAPI.deleteCaptionModel = async (modelId) => {
			document.documentElement.dataset.captionModelDeleted = modelId;
			return { success: true };
		};
	});
	await page.route("**/video?path=*", (route) =>
		route.fulfill({
			path: path.resolve("tests/ui/fixtures/filmstrip.mp4"),
			contentType: "video/mp4",
		}),
	);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await expect(page.getByRole("button", { name: "Reveal", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(
		page.getByRole("group", { name: "Caption style", exact: true }).getByRole("button"),
	).toHaveCount(2);
	await expect(page.getByRole("switch", { name: "Advanced settings" })).not.toBeChecked();
	await expect(
		page.getByRole("button", { name: "Download 670 MB & generate captions", exact: true }),
	).toBeEnabled();
	await expect(page.getByRole("button", { name: "Clear Captions", exact: true })).toBeDisabled();
	await expect(
		page.getByText("Captions are generated on this device. Your recording is not uploaded.", {
			exact: true,
		}),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Caption actions", exact: true })).toHaveCount(0);
	const sidebar = page.getByRole("complementary");
	for (const label of ["Generation", "Appearance"])
		await expect(sidebar.getByText(label, { exact: true })).toHaveCount(0);
	await expect(sidebar.getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: /Speech model/ }).click();
	for (const label of ["Parakeet v3", "Whisper Base", "Whisper Small"])
		await expect(page.getByRole("option", { name: label, exact: true })).toBeVisible();
	await page.getByRole("option", { name: "Whisper Base", exact: true }).click();

	await page
		.getByRole("button", { name: "Download 148 MB & generate captions", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Downloading... 0%", exact: true }),
	).toBeDisabled();
	await page.evaluate(() =>
		window.dispatchEvent(
			new CustomEvent("caption-model-progress", {
				detail: { modelId: "whisper-base", status: "downloading", progress: 47 },
			}),
		),
	);
	await expect(
		page.getByRole("progressbar", { name: "Downloading...", exact: true }),
	).toHaveAttribute("aria-valuenow", "47");
	await page.evaluate(() => window.dispatchEvent(new Event("complete-caption-model-download")));

	await expect(
		page.getByRole("button", { name: "Regenerate Captions", exact: true }),
	).toBeVisible();
	const show = page.getByRole("switch", { name: "Show", exact: true });
	await expect(show).toBeChecked();
	await expect(page.locator("html")).toHaveAttribute("data-caption-generation-count", "1");
	await expect(page.locator("html")).toHaveAttribute(
		"data-caption-generated-model",
		"whisper-base",
	);
	await expect(sidebar.getByText("1 caption", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Classic", exact: true }).click();
	await expect(page.getByRole("button", { name: "Classic", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	const presets = await sidebar
		.getByRole("group", { name: "Caption style" })
		.getByRole("button")
		.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y));
	expect(new Set(presets).size).toBe(1);
	expect(await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
	await expect(page.getByRole("button", { name: "Clear Captions", exact: true })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Delete Model", exact: true })).toHaveCount(0);
	await page.getByRole("complementary").screenshot({
		path: testInfo.outputPath("captions-ui.png"),
		animations: "disabled",
	});
	await page.getByRole("button", { name: "Clear Captions", exact: true }).click();
	await expect(page.getByRole("menu")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Clear Captions", exact: true })).toBeDisabled();
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Generate Captions", exact: true }),
	).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-caption-model-deleted");
	await page.getByRole("switch", { name: "Advanced settings" }).press("Space");
	await expect(page.getByRole("slider", { name: "Rows", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /Speech model/ })).toBeVisible();
	await page.getByRole("button", { name: "Delete Model", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-caption-model-deleted",
		"whisper-base",
	);
	await expect(
		page.getByRole("button", { name: "Download 148 MB & generate captions", exact: true }),
	).toBeEnabled();
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect(page.getByText("Cursor Size", { exact: true })).toHaveClass(/sr-only/);
	const cursorSize = page.getByRole("slider", { name: "Cursor Size", exact: true });
	await cursorSize.focus();
	const previousCursorSize = Number(await cursorSize.inputValue());
	await cursorSize.press("ArrowRight");
	await expect(cursorSize).toHaveValue(String(Number((previousCursorSize + 0.05).toFixed(2))));
	expect(errors).toEqual([]);
});
