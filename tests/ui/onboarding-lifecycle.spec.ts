import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const pending of [false, true]) {
	test(`a stopped dev recording opens its editor without replaying dismissed onboarding (pending=${pending})`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn: true, onboarded: false });
		await installDesktopBridgeOverrides(page, () => {
			const get = window.electronAPI.getAppSetting;
			window.electronAPI.getAppSetting = (key) => {
				const saved = localStorage.getItem(`test-lifecycle:${key}`);
				return saved === null ? get(key) : JSON.parse(saved);
			};
			window.electronAPI.setAppSetting = (key, value) => {
				localStorage.setItem(`test-lifecycle:${key}`, JSON.stringify(value));
				return true;
			};
			window.electronAPI.showRecordingHud = async () =>
				window.location.assign("/?windowType=hud-overlay");
			window.electronAPI.showOnboardingWindow = async () => {
				localStorage.setItem("test-unexpected-onboarding", "true");
				return false;
			};
			Object.assign(window.electronAPI, {
				startCountdown: async () => ({ success: true }),
				startNativeScreenRecording: async () => ({ success: true }),
				pauseNativeScreenRecording: async () => ({ success: true }),
				resumeNativeScreenRecording: async () => ({ success: true }),
				stopNativeScreenRecording: async () => ({ success: true, path: "/preview.mp4" }),
				openLoadingRecordingEditor: async () => {
					window.location.assign("/?windowType=editor");
					return { success: true };
				},
			});
		});
		await page.goto("/?windowType=onboarding");
		const tour = page.getByRole("dialog", { name: "Welcome to Recordly", exact: true });
		await expect(tour.getByText("test@email.com", { exact: true })).toBeVisible();
		await expect(tour.getByPlaceholder("you@example.com")).toHaveCount(0);
		await tour.getByRole("button", { name: "Skip onboarding", exact: true }).click();
		await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
		await page.evaluate(
			(value) =>
				window.electronAPI.setAppSetting("recordly.onboarding.permissionsRequested", value),
			pending,
		);
		await page.getByRole("button", { name: "Record", exact: true }).click();
		await expect(
			page.getByRole("group", { name: "Recording controls", exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Stop", exact: true }).click();
		await expect(page).toHaveURL(/windowType=editor/);
		await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
			timeout: 15000,
		});
		await expect(tour).toHaveCount(0);
		expect(
			await page.evaluate(() => localStorage.getItem("test-unexpected-onboarding")),
		).toBeNull();
	});
}
