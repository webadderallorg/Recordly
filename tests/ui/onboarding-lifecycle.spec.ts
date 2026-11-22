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

for (const failure of ["hud", "close"] as const) {
	test(`permission recovery stays usable after ${failure} failure and retries the native handoff`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await installDesktopBridge(page, "preview.mp4", { signedIn: true, onboarded: true });
		await installDesktopBridgeOverrides(
			page,
			(failure) => {
				const settings = new Map<string, unknown>([
					["recordly.onboarding.v1.seen", true],
					["recordly.onboarding.permissionsRequested", true],
					["recordly.dev.onboardingDismissed", false],
				]);
				window.electronAPI.getAppSetting = (key) => settings.get(key) ?? null;
				window.electronAPI.getAppSettingWithStatus = (key) => ({
					success: true,
					found: settings.has(key),
					value: settings.get(key) ?? null,
				});
				window.electronAPI.setAppSetting = (key, value) => {
					settings.set(key, value);
					return true;
				};
				let hudCalls = 0;
				let closeCalls = 0;
				window.electronAPI.showRecordingHud = async () => {
					document.documentElement.dataset.hudCalls = String(++hudCalls);
					if (failure === "hud" && hudCalls === 1) throw new Error("HUD unavailable");
				};
				window.electronAPI.closeOnboardingWindow = async () => {
					document.documentElement.dataset.closeCalls = String(++closeCalls);
					if (failure === "close" && closeCalls === 1)
						throw new Error("Close unavailable");
					document.documentElement.dataset.onboardingClosed = "true";
					return true;
				};
			},
			failure,
		);
		const pageErrors: string[] = [];
		const consoleErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		await page.goto("/?windowType=onboarding&onboardingPreview=0");
		const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
		const finish = permissions.getByRole("button", { name: "Start recording", exact: true });
		await expect(
			permissions.getByRole("heading", { name: "Allow Recordly to record", exact: true }),
		).toBeVisible();
		await expect(finish).toBeEnabled();
		await finish.click();
		await expect(page.locator("html")).toHaveAttribute("data-hud-calls", "1");
		if (failure === "close")
			await expect(page.locator("html")).toHaveAttribute("data-close-calls", "1");
		await expect
			.poll(() => consoleErrors)
			.toContain("[onboarding] Could not return to the recording HUD.");
		await expect(permissions).toBeVisible();
		await expect(finish).toBeEnabled();
		await expect
			.poll(() =>
				page.evaluate(() => ({
					seen: window.electronAPI.getAppSetting("recordly.onboarding.v1.seen"),
					permissionsRequested: window.electronAPI.getAppSetting(
						"recordly.onboarding.permissionsRequested",
					),
					previewDismissed: window.electronAPI.getAppSetting(
						"recordly.dev.onboardingDismissed",
					),
				})),
			)
			.toEqual({ seen: true, permissionsRequested: true, previewDismissed: false });
		await expect(page.locator("html")).not.toHaveAttribute("data-onboarding-closed", "true");
		if (failure === "hud")
			await expect(page.locator("html")).not.toHaveAttribute("data-close-calls", /.+/);
		await finish.click();
		await expect(page.locator("html")).toHaveAttribute("data-hud-calls", "2");
		await expect(page.locator("html")).toHaveAttribute(
			"data-close-calls",
			failure === "close" ? "2" : "1",
		);
		await expect(page.locator("html")).toHaveAttribute("data-onboarding-closed", "true");
		await expect(permissions).toHaveCount(0);
		expect(
			await page.evaluate(() => ({
				seen: window.electronAPI.getAppSetting("recordly.onboarding.v1.seen"),
				permissionsRequested: window.electronAPI.getAppSetting(
					"recordly.onboarding.permissionsRequested",
				),
				previewDismissed: window.electronAPI.getAppSetting(
					"recordly.dev.onboardingDismissed",
				),
			})),
		).toEqual({ seen: true, permissionsRequested: false, previewDismissed: false });
		expect(pageErrors).toEqual([]);
	});
}
