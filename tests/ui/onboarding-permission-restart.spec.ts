import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("explicit real dev onboarding restores account and permission progress after an OS restart", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: true, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		const get = window.electronAPI.getAppSetting;
		const set = window.electronAPI.setAppSetting;
		window.electronAPI.getAppSetting = (key) => {
			const saved = localStorage.getItem(`test-onboarding:${key}`);
			return saved === null ? get(key) : JSON.parse(saved);
		};
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(`test-onboarding:${key}`, JSON.stringify(value));
			return set(key, value);
		};
		window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
			success: true,
			status: localStorage.getItem("test-screen-granted") === "true" ? "granted" : "denied",
		});
		window.electronAPI.getAccessibilityPermissionStatus = async () => ({
			success: true, trusted: localStorage.getItem("test-accessibility-granted") === "true",
		});
		window.electronAPI.requestAccessibilityPermission = async () => ({ success: true, trusted: false, prompted: true });
		window.electronAPI.openScreenRecordingPreferences = async () => {
			localStorage.setItem("test-screen-granted", "true");
			return { success: true };
		};
		window.electronAPI.openAccessibilityPreferences = async () => {
			localStorage.setItem("test-accessibility-granted", "true");
			await new Promise<void>((resolve) => window.addEventListener("test-settings-closed", () => resolve(), { once: true }));
			return { success: true };
		};
	});
	await page.goto("/?windowType=onboarding&onboardingPreview=0");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(tour.getByPlaceholder("you@example.com")).toHaveCount(0);
	await expect(tour.getByRole("button", { name: "Skip onboarding" })).toHaveCount(0);
	await tour.getByRole("button", { name: "Allow Screen Recording", exact: true }).click();
	await expect(tour.getByRole("status", { name: "Screen Recording: Allowed" })).toBeVisible();
	await expect(page.locator("[data-permissions-confetti]")).toHaveCount(0);
	await page.reload();
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(tour.getByPlaceholder("you@example.com")).toHaveCount(0);
	await expect(tour.getByRole("status", { name: "Screen Recording: Allowed" })).toBeVisible();
	await tour.getByRole("button", { name: "Allow Accessibility", exact: true }).click();
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(tour.getByText("Allowed", { exact: true })).toHaveCount(2);
	await expect(tour.getByRole("button", { name: "Start recording", exact: true })).toBeDisabled();
	await expect(page.locator("[data-permissions-confetti]")).toHaveCount(0);
	await page.evaluate(() => window.dispatchEvent(new Event("test-settings-closed")));
	await expect(tour.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
	await expect(page.locator("[data-permissions-confetti]")).toBeVisible();
	await tour.getByRole("button", { name: "Start recording", exact: true }).click();
	await expect.poll(() => page.evaluate(() => localStorage.getItem("test-onboarding:recordly.onboarding.v1.seen"))).toBe("true");
	await expect.poll(() => page.evaluate(() => localStorage.getItem("test-onboarding:recordly.onboarding.permissionsRequested"))).toBe("false");
});
