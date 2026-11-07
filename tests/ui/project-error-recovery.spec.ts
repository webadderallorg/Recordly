import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("preview failures use a dismissible popup without replacing the editor", async ({
	page,
}, testInfo) => {
	test.setTimeout(60_000);
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 20_000,
	});
	const preview = page.locator('video[src*="fixtures/preview.mp4"]').first();
	await expect(preview).toBeAttached();
	const originalPreview = await preview.elementHandle();
	if (!originalPreview) throw new Error("Missing preview fixture");
	await preview.dispatchEvent("error");
	// One automatic URL refresh still runs before showing recovery controls.
	await expect.poll(() => originalPreview.evaluate((video) => video.isConnected)).toBe(false);
	const popup = page.getByRole("dialog", {
		name: "The recording couldn’t be played",
		exact: true,
	});
	await expect(popup).toHaveCount(0);
	const currentPreview = await preview.elementHandle();
	if (!currentPreview) throw new Error("Missing recovered preview fixture");
	await preview.dispatchEvent("error");
	await expect(popup).toBeVisible();
	await expect(popup).toContainText("preview.mp4");
	await expect(popup.getByRole("button", { name: "Open Projects", exact: true })).toHaveCount(0);
	await expect(popup.getByRole("button", { name: "Open another file", exact: true })).toHaveCount(
		0,
	);
	expect(await currentPreview.evaluate((video) => video.isConnected)).toBe(true);
	const bounds = await popup.boundingBox();
	expect(bounds?.width).toBeLessThanOrEqual(480);
	expect(bounds?.height).toBeLessThan(600);
	await page.screenshot({
		path: testInfo.outputPath("playback-error-popup.png"),
		animations: "disabled",
	});
	const reports: Record<string, unknown>[] = [];
	await page.route("**/functions/v1/submit-export-error", async (route) => {
		reports.push(route.request().postDataJSON());
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: '{"success":true}',
		});
	});
	await popup.getByRole("button", { name: "Report error", exact: true }).click();
	await expect(popup.getByRole("button", { name: "Report sent", exact: true })).toBeDisabled();
	expect(reports).toHaveLength(1);
	expect(reports[0]).toMatchObject({ schemaVersion: 2, context: "project-load" });
	expect(JSON.parse(reports[0].logs as string).logs.join("\n")).toContain("Video load error");
	await popup.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(popup).toHaveCount(0);
	await preview.dispatchEvent("error");
	await expect(popup).toBeVisible();
	const failedPreview = await preview.elementHandle();
	if (!failedPreview) throw new Error("Missing retry preview fixture");
	await popup.getByRole("button", { name: "Close", exact: true }).click();
	await expect(popup).toHaveCount(0);
	expect(await failedPreview.evaluate((video) => video.isConnected)).toBe(true);
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Parakeet v3 Speech model", exact: true }),
	).toBeVisible();
	// Repeated error callbacks from the same failed preview must not reopen it.
	await preview.dispatchEvent("error");
	await expect(popup).toHaveCount(0);
});

test("failed project opens preserve the editor and retry the selected project", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listProjectFiles = async () => ({
			success: true,
			entries: [
				{
					path: "/projects/demo.recordly",
					name: "Demo project",
					updatedAt: Date.now(),
					thumbnailPath: null,
					isCurrent: false,
					isInProjectsDirectory: true,
				},
			],
		});
		let attempts = 0;
		window.electronAPI.openProjectFileAtPath = async (path) => {
			attempts += 1;
			document.documentElement.dataset.openAttempts = String(attempts);
			if (attempts === 1) throw new Error("EIO: temporary disk read failure");
			return {
				success: true,
				path,
				project: {
					version: 2,
					videoPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
					editor: {},
				},
			};
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard" });
	await home.getByRole("button", { name: "Demo project", exact: true }).click();
	await expect(
		page.getByText("We couldn’t open this file: demo.recordly", { exact: true }),
	).toBeVisible();
	await expect(home).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(home).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await expect(
		page.getByRole("heading", { level: 1, name: "We couldn’t open this file" }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-open-attempts", "2");
	await expect(home).not.toBeVisible();
	await expect(
		page.getByText("We couldn’t open this file: demo.recordly", { exact: true }),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
});

test("startup errors offer details in a compact popup and dismiss back to the editor", async ({
	page,
}, testInfo) => {
	test.setTimeout(60_000);
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getCurrentVideoPath = async () => {
			throw new Error("EACCES: permission denied");
		};
	});
	await page.goto("/?windowType=editor");
	const popup = page.getByRole("dialog", { name: "Access to this file was denied", exact: true });
	await expect(popup).toBeVisible({ timeout: 20_000 });
	await expect(popup.getByRole("button", { name: "Open Projects", exact: true })).toHaveCount(0);
	await expect(popup.getByRole("button", { name: "Open another file", exact: true })).toHaveCount(
		0,
	);
	const details = popup.getByText("Error loading video: Error: EACCES: permission denied", {
		exact: true,
	});
	await expect(details).not.toBeVisible();
	await popup.getByText("Technical details", { exact: true }).click();
	await expect(details).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("startup-error-popup.png"),
		animations: "disabled",
	});
	await page.keyboard.press("Escape");
	await expect(popup).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
});
