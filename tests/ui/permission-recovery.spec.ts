import { expect } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest as test } from "./production";

test("a pending permission request still requires an expired session to sign in", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.onboarding.permissionsRequested" ||
			key === "recordly.onboarding.v1.seen";
	});
	await page.goto("/?windowType=onboarding");
	await expect(page.getByPlaceholder("you@example.com")).toBeVisible({ timeout: 15000 });
	await expect(page.getByRole("dialog", { name: "Permissions", exact: true })).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Start recording", exact: true })).toHaveCount(0);
});

test("startup clears a pending permission request when both macOS grants already exist", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: true, onboarded: true });
	await installDesktopBridgeOverrides(page, () => {
		const key = "recordly.onboarding.permissionsRequested";
		const { getAppSetting, setAppSetting } = window.electronAPI;
		window.electronAPI.getAppSetting = (name) =>
			name === key ? localStorage.getItem(key) !== "false" : getAppSetting(name);
		window.electronAPI.setAppSetting = (name, value) => {
			if (name === key) localStorage.setItem(key, String(value));
			return setAppSetting(name, value);
		};
		window.electronAPI.showOnboardingWindow = async () => {
			document.documentElement.dataset.permissionWindowOpened = "true";
			return false;
		};
	});
	await page.goto("/?windowType=editor");
	await expect
		.poll(() =>
			page.evaluate(() => localStorage.getItem("recordly.onboarding.permissionsRequested")),
		)
		.toBe("false");
	await expect(page.locator("html")).not.toHaveAttribute("data-permission-window-opened");
	await expect(page.getByRole("dialog", { name: "Permissions", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
});

test("a recording permission request opens recovery and can be closed and reopened", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: true, onboarded: true });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.closeOnboardingWindow = async () => {
			window.location.assign("/?windowType=hud-overlay");
			return true;
		};
	});
	const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
	for (let attempt = 0; attempt < 2; attempt++) {
		await page.goto("/?windowType=onboarding&permissionsOnly=1");
		await expect(permissions).toBeVisible({ timeout: 15000 });
		await expect(permissions.getByRole("navigation")).toHaveCount(0);
		await expect(permissions.getByRole("button", { name: "Back to account" })).toHaveCount(0);
		await permissions.getByRole("button", { name: "Close", exact: true }).click();
		await expect(page).toHaveURL(/windowType=hud-overlay$/);
		await expect(permissions).not.toBeVisible();
		await expect(page.getByRole("dialog", { name: "Welcome to Recordly" })).not.toBeVisible();
	}
});

for (const standalone of [false, true]) {
	test(`permission recovery is separate from onboarding (${standalone ? "window" : "inline"})`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await installDesktopBridge(page, "preview.mp4", { signedIn: true, onboarded: true });
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getAppSetting = (key) => {
				if (key === "recordly.onboarding.v1.seen") return true;
				if (key === "recordly.onboarding.permissionsRequested")
					return localStorage.getItem("permission-recovery-done") !== "true";
				return null;
			};
			window.electronAPI.setAppSetting = (key, value) => {
				if (key === "recordly.onboarding.v1.seen")
					document.documentElement.dataset.onboardingRewritten = "true";
				if (key === "recordly.onboarding.permissionsRequested" && value === false)
					localStorage.setItem("permission-recovery-done", "true");
				return true;
			};
			let screenAllowed = false;
			let accessibilityAllowed = false;
			window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
				success: true,
				status: screenAllowed ? "granted" : "denied",
			});
			window.electronAPI.openScreenRecordingPreferences = async () => {
				screenAllowed = true;
				return { success: true };
			};
			window.electronAPI.getAccessibilityPermissionStatus = async () => ({
				success: true,
				trusted: accessibilityAllowed,
			});
			window.electronAPI.openAccessibilityPreferences = async () => {
				accessibilityAllowed = true;
				return { success: true };
			};
		});
		await page.setViewportSize({ width: 760, height: 760 });
		await page.goto(`/?windowType=${standalone ? "onboarding" : "editor"}`);
		const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
		await expect(permissions).toBeVisible({ timeout: 15000 });
		await expect(
			permissions.getByRole("heading", { name: "Allow Recordly to record" }),
		).toBeVisible();
		await expect(
			permissions.locator("[data-onboarding-artwork] .recordly-banner-preview"),
		).toBeInViewport();
		await expect(permissions.getByRole("navigation")).toHaveCount(0);
		await expect(permissions.getByRole("button", { name: "Back to account" })).toHaveCount(0);
		await expect(permissions.getByPlaceholder("you@example.com")).toHaveCount(0);
		await expect(permissions.getByRole("button", { name: "Mute welcome music" })).toHaveCount(
			0,
		);
		const start = permissions.getByRole("button", { name: "Start recording", exact: true });
		await expect(start).toBeDisabled();
		expect((await start.boundingBox())!.height).toBe(44);
		expect(
			(await permissions
				.getByRole("button", { name: "Allow Screen Recording", exact: true })
				.boundingBox())!.height,
		).toBe(44);
		await permissions
			.getByRole("button", { name: "Allow Screen Recording", exact: true })
			.click();
		await expect(
			permissions.getByRole("status", { name: "Screen Recording: Allowed" }),
		).toBeVisible();
		await expect(start).toBeDisabled();
		await permissions.getByRole("button", { name: "Allow Accessibility", exact: true }).click();
		await expect(start).toBeEnabled();
		await permissions.screenshot({ path: test.info().outputPath("permission-recovery.png") });
		await start.click();
		await expect(permissions).not.toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
		await expect(page.locator("html")).toHaveAttribute("data-onboarding-closed", "true");
		await expect(page.locator("html")).not.toHaveAttribute("data-onboarding-rewritten");
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem("permission-recovery-done")))
			.toBe("true");
		await page.reload();
		await expect(permissions).not.toBeVisible();
	});
}
