import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const webcam of [false, true]) {
	test(`idle HUD ${webcam ? "with camera" : "without camera"} passes transparent side areas through and keeps popup panels usable`, async ({
		page,
	}) => {
		test.setTimeout(60000);
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(webcam) => {
				window.electronAPI.getRecordingPreferences = async () => ({
					success: true,
					webcamEnabled: webcam,
					microphoneEnabled: false,
					systemAudioEnabled: false,
				});
				window.electronAPI.hudOverlaySetIgnoreMouse = (ignore) => {
					document.documentElement.dataset.ignoreMouse = String(ignore);
				};
				navigator.mediaDevices.getUserMedia = async () => {
					const canvas = document.createElement("canvas");
					canvas.width = 320;
					canvas.height = 320;
					return canvas.captureStream(30);
				};
				navigator.mediaDevices.enumerateDevices = async () => [];
			},
			webcam,
		);
		await page.goto("/?windowType=hud-overlay");
		const bar = page.locator("[data-hud-surface]");
		await expect(bar).toBeVisible({ timeout: 20000 });
		if (webcam) await expect(page.locator("[data-floating-webcam-preview]")).toBeVisible();
		await expect
			.poll(() =>
				bar.evaluate(
					(node) =>
						node
							.getAnimations({ subtree: true })
							.filter((a) => a.playState === "running").length,
				),
			)
			.toBe(0);
		const bounds = (await bar.boundingBox())!;
		const y = bounds.y + bounds.height / 2;
		await page.mouse.move(bounds.x + bounds.width / 2, y);
		await expect(page.locator("html")).toHaveAttribute("data-ignore-mouse", "false");
		await page.mouse.move(bounds.x + bounds.width + 30, y);
		await expect(page.locator("html")).toHaveAttribute("data-ignore-mouse", "true");
		await page.mouse.move(20, y);
		await expect(page.locator("html")).toHaveAttribute("data-ignore-mouse", "true");
		const microphone = page.getByRole("button", { name: "Enable microphone", exact: true });
		await microphone.click();
		// The marker is on the complete popover, including blank panel padding.
		const popup = page
			.locator("[data-hud-interactive]")
			.filter({ has: page.getByText("Microphone", { exact: true }) })
			.first();
		await expect(popup).toBeVisible();
		const popupBounds = (await popup.boundingBox())!;
		await page.mouse.move(popupBounds.x + 3, popupBounds.y + 3);
		await expect(page.locator("html")).toHaveAttribute("data-ignore-mouse", "false");
		await expect(
			page.getByRole("button", { name: "Enable system audio", exact: true }),
		).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(popup).toHaveCount(0);
		await page.mouse.move(bounds.x + bounds.width + 30, y);
		await expect(page.locator("html")).toHaveAttribute("data-ignore-mouse", "true");
		if (webcam) {
			const camera = (await page.locator("[data-floating-webcam-preview]").boundingBox())!;
			await page.mouse.move(camera.x + camera.width / 2, camera.y + camera.height / 2);
			await expect(page.locator("html")).toHaveAttribute("data-ignore-mouse", "false");
			await page.mouse.move(camera.x + 1, camera.y + 1);
			await expect(page.locator("html")).toHaveAttribute("data-ignore-mouse", "true");
		}
	});
}
for (const ending of ["start failure", "discard"] as const) {
	test(`${ending} does not request Home or editor foreground`, async ({ page }) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(
			page,
			(ending) => {
				const foreground = async () => {
					document.documentElement.dataset.foregroundRequests = String(
						Number(document.documentElement.dataset.foregroundRequests ?? "0") + 1,
					);
					return { success: true };
				};
				Object.assign(window.electronAPI, {
					getPlatform: async () => "darwin",
					getCountdownDelay: async () => ({ success: true, delay: 0 }),
					getRecordingPreferences: async () => ({
						success: true,
						webcamEnabled: false,
						microphoneEnabled: false,
						systemAudioEnabled: false,
					}),
					startNativeScreenRecording: async () =>
						ending === "start failure"
							? { success: false, userNotified: true }
							: { success: true },
					stopNativeScreenRecording: async () => ({
						success: true,
						path: "/discarded.mp4",
					}),
					deleteRecordingFile: async () => {
						document.documentElement.dataset.discarded = "true";
						return { success: true };
					},
					openLoadingRecordingEditor: foreground,
					switchToEditor: foreground,
					showProjectDashboard: foreground,
				});
			},
			ending,
		);
		await page.goto("/?windowType=hud-overlay");
		await page.getByRole("button", { name: "Record", exact: true }).click();
		if (ending === "discard") {
			await page.getByRole("button", { name: "Discard recording", exact: true }).click();
			await expect(page.locator("html")).toHaveAttribute("data-discarded", "true");
		}
		await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
		await expect(page.locator("html")).not.toHaveAttribute("data-foreground-requests");
	});
}
