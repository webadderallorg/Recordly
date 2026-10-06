import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("settings button replays login and the recording overview", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 15000,
	});
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
	await expect(tour.getByText("Sign in to get started", { exact: true })).toBeVisible();
	await expect(tour.getByRole("button", { name: "Email me a magic link" })).toBeVisible();
	await tour.getByPlaceholder("you@example.com").fill("hello@example.com");
	await expect(tour.getByRole("button", { name: "Email me a magic link" })).toBeVisible();
	await expect
		.poll(() => tour.evaluate((element) => getComputedStyle(element).opacity))
		.toBe("1");
	await page.screenshot({ path: "test-results/onboarding-login.png", animations: "disabled" });
	const artwork = tour.locator("[data-onboarding-artwork]");
	const loginWidth = (await artwork.boundingBox())!.width;
	await tour.getByRole("button", { name: "Continue without signing in" }).click();
	await expect(tour).toHaveAttribute("data-onboarding-state", "feature");
	await expect(tour.getByRole("heading", { name: "Your next great recording" })).toBeVisible();
	await expect
		.poll(async () => (await artwork.boundingBox())!.width)
		.toBeGreaterThan(loginWidth * 1.7);
	await expect(artwork).toHaveCSS("transform", "none");
	await expect(artwork.locator(":scope > img")).toHaveCSS("transform", "none");
	await page.screenshot({ path: "test-results/onboarding-record.png", animations: "disabled" });
	for (const name of ["Record", "Preview", "Share"])
		await expect(tour.getByRole("heading", { name, exact: true })).toBeVisible();
	await tour.getByRole("button", { name: "Start recording" }).click();
	await expect(tour).not.toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
});

test("first launch persists completion and signed-in users can continue", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getAppSetting = (key) => JSON.parse(localStorage.getItem(key) || "null");
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(key, JSON.stringify(value));
			return true;
		};
		sessionStorage.setItem("recordly.demo-session", "1");
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	await tour.getByRole("button", { name: "Start recording" }).click();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("recordly.onboarding.v1.seen")))
		.toBe("true");
	await page.reload();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 15000,
	});
	await expect(tour).not.toBeVisible();
});

test("feature banner fits a compact window with reduced motion", async ({ page }) => {
	await installDesktopBridge(page);
	await page.setViewportSize({ width: 620, height: 740 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 15000,
	});
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByRole("button", { name: "Continue without signing in" }).click();
	await expect(
		tour.getByRole("button", { name: "Start recording", exact: true }),
	).toBeInViewport();
	await page.screenshot({ path: "test-results/onboarding-compact.png" });
	await tour.getByRole("button", { name: "Back to sign in" }).click();
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
});

test("successful sign-in advances to Feature without closing onboarding", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 15000,
	});
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByPlaceholder("you@example.com").fill("test@email.com");
	await tour.locator('input[type="password"]').fill("1234");
	await tour.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(tour).toHaveAttribute("data-onboarding-state", "feature");
	await expect(tour.getByRole("heading", { name: "Your next great recording" })).toBeVisible();
});

test("missing macOS permissions lead to explicit access controls before the overview", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		let screen = false;
		let accessibility = false;
		Object.assign(window.electronAPI, {
			getScreenRecordingPermissionStatus: async () => ({
				success: true,
				status: screen ? "granted" : "denied",
			}),
			getAccessibilityPermissionStatus: async () => ({
				success: true,
				trusted: accessibility,
				prompted: false,
			}),
			openScreenRecordingPreferences: async () => {
				screen = true;
				document.documentElement.dataset.screenSettings = "true";
				return { success: true };
			},
			openAccessibilityPreferences: async () => {
				accessibility = true;
				document.documentElement.dataset.accessibilitySettings = "true";
				return { success: true };
			},
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByRole("button", { name: "Continue without signing in" }).click();
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(tour.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
	await expect(page.locator("html")).not.toHaveAttribute("data-screen-settings");
	await tour.getByRole("button", { name: "Allow Screen Recording", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-screen-settings", "true");
	await expect(tour.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
	await tour.getByRole("button", { name: "Allow Accessibility", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-accessibility-settings", "true");
	await expect(tour.getByText("Allowed", { exact: true })).toHaveCount(2);
	await page.screenshot({
		path: "test-results/onboarding-permissions.png",
		animations: "disabled",
	});
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(tour.getByRole("button", { name: "Start recording" })).toBeVisible();
});

for (const platform of ["win32", "linux"]) {
	test(`${platform} onboarding skips macOS permission APIs`, async ({ page }) => {
		await installDesktopBridge(page);
		await page.addInitScript((platform) => {
			window.electronAPI.getPlatform = async () => platform;
			window.electronAPI.getScreenRecordingPermissionStatus = async () => {
				throw new Error("macOS-only check");
			};
			window.electronAPI.getAccessibilityPermissionStatus = async () => {
				throw new Error("macOS-only check");
			};
		}, platform);
		await page.goto("/?windowType=editor");
		await page.getByRole("radio", { name: "Settings", exact: true }).click();
		await page.getByRole("button", { name: "Show onboarding" }).click();
		const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await tour.getByRole("button", { name: "Continue without signing in" }).click();
		await expect(tour.getByRole("button", { name: "Start recording" })).toBeVisible();
		await expect(
			tour.getByRole("heading", { name: "Allow Recordly to record" }),
		).not.toBeVisible();
	});
}

test("HUD routes missing permissions to onboarding without opening System Settings on launch", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
			success: true,
			status: "denied",
		});
		window.electronAPI.openScreenRecordingPreferences = async () => {
			document.documentElement.dataset.settingsOpened = "true";
			return { success: true };
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator("html")).toHaveAttribute("data-permissions-opened", "true");
	await expect(page.locator("html")).not.toHaveAttribute("data-settings-opened");
});

test("a permission request opens its page even after onboarding was already completed", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.onboarding.v1.seen" ||
			key === "recordly.onboarding.permissionsRequested"
				? true
				: null;
		window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
			success: true,
			status: "denied",
		});
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(
		tour.getByRole("button", { name: "Continue without signing in" }),
	).not.toBeVisible();
});
