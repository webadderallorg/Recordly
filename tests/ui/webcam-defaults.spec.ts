import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const savedRoundness of [undefined, 69]) {
	test(`new recording webcam uses ${savedRoundness === undefined ? "100% by default" : "saved roundness"}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(roundness) => {
				if (roundness !== undefined) {
					window.electronAPI.getAppSetting = (key) =>
						key === "recordly.editor.preferences" ? { webcam: { roundness } } : null;
				}
				window.electronAPI.getCurrentRecordingSession = async () => ({
					success: true,
					session: {
						videoPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
						webcamPath: `${location.origin}/tests/ui/fixtures/preview.mp4`,
						timeOffsetMs: 0,
					},
				});
			},
			savedRoundness,
		);
		await page.goto("/?windowType=editor");
		await page.getByRole("radio", { name: "Webcam", exact: true }).click();
		const expected = savedRoundness ?? 100;
		await expect(page.getByRole("slider", { name: "Webcam Roundness" })).toHaveValue(
			String(expected),
		);
		const mask = page.locator('div[style*="clip-path"][style*="contain: paint"]:has(video)');
		await expect(mask).toHaveCount(1);
		await expect
			.poll(async () =>
				mask.evaluate((node) => {
					const radius = Number(
						getComputedStyle(node).clipPath.match(/M\s+([\d.]+)/)?.[1],
					);
					const box = node.getBoundingClientRect();
					return Math.round(100 * (radius / (Math.min(box.width, box.height) / 2)) ** 2);
				}),
			)
			.toBe(expected);
		await page.screenshot({
			path: `test-results/webcam-new-recording-${expected}.png`,
			animations: "disabled",
		});
	});
}
