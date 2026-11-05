import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const platform of ["darwin", "win32"] as const) {
	test(`primary B splits a clip on ${platform}, including saved C-default settings`, async ({
		page,
	}) => {
		test.setTimeout(180000);
		await installDesktopBridge(page, "filmstrip.mp4");
		await installDesktopBridgeOverrides(
			page,
			(platform) => {
				window.electronAPI.getPlatform = async () => platform;
				window.electronAPI.getShortcuts = async () => ({ splitClip: { key: "c" } });
			},
			platform,
		);
		await page.goto("/?windowType=editor");
		const clips = page.locator('[data-variant="clip"]');
		await expect(clips).toHaveAttribute("data-end-ms", "6000", { timeout: 30000 });
		await expect(
			page.getByRole("button", {
				name: platform === "darwin" ? "Split Clip (⌘ + B)" : "Split Clip (Ctrl + B)",
				exact: true,
			}),
		).toBeVisible();
		await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 60000 });
		await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, {
			timeout: 60000,
		});
		const block = (await clips.locator(".timeline-block").boundingBox())!;
		const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
		await page.mouse.click(block.x + block.width / 2, row.y - 8);
		await page.getByTestId("timeline-scroll").focus();
		await page.keyboard.press("c");
		await expect(clips).toHaveCount(1);
		await page.keyboard.press(platform === "darwin" ? "Meta+b" : "Control+b");
		await expect(clips).toHaveCount(2);
		await expect(clips.first()).toHaveAttribute("data-end-ms", "3000");
		await expect(clips.nth(1)).toHaveAttribute("data-start-ms", "3000");
	});
}
