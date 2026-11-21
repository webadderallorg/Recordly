import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest } from "./production";

test("dev startup shows onboarding and waits for an explicit skip", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.showRecordingHud = async () => {
			document.documentElement.dataset.hudOpened = "true";
		};
	});
	await page.goto("/?windowType=onboarding&onboardingPreview=1");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	const skip = tour.getByRole("button", { name: "Skip onboarding", exact: true });
	await expect(skip).toBeVisible({ timeout: 15000 });
	await expect(page.locator("html")).not.toHaveAttribute("data-hud-opened");
	await skip.click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
});

for (const dev of [true, false]) {
	const modeTest = dev ? test : productionTest;
	modeTest(
		`${dev ? "dev" : "production"} Record opens Permissions without Home`,
		async ({ page }) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn: !dev, onboarded: true });
			await installDesktopBridgeOverrides(page, () => {
				let screenAllowed = false;
				window.electronAPI.getPlatform = async () => "darwin";
				window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
					success: true,
					status: screenAllowed ? "granted" : "denied",
				});
				window.electronAPI.getAccessibilityPermissionStatus = async () => ({
					success: true,
					trusted: true,
				});
				window.electronAPI.openScreenRecordingPreferences = async () => {
					screenAllowed = true;
					return { success: true };
				};
				window.electronAPI.closeOnboardingWindow = async () => {
					document.documentElement.dataset.permissionsClosed = "true";
					return true;
				};
				window.electronAPI.setAppSetting = (key) => {
					if (key.startsWith("recordly.onboarding."))
						document.documentElement.dataset.changedOnboarding = key;
					return true;
				};
			});
			await page.goto("/?windowType=hud-overlay");
			await page.getByRole("button", { name: "Record", exact: true }).click();
			await expect(page.locator("html")).toHaveAttribute("data-permissions-opened", "true");
			await expect(page.locator("html")).not.toHaveAttribute("data-dashboard-opened");
			await page.goto("/?windowType=onboarding&permissionsOnly=1");
			const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
			await expect(permissions).toBeVisible({ timeout: 15000 });
			await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);
			await expect(permissions.getByText("Skip onboarding", { exact: true })).toHaveCount(0);
			const start = permissions.getByRole("button", { name: "Start recording", exact: true });
			await expect(start).toBeDisabled();
			await permissions.getByRole("button", { name: /allow screen recording/i }).click();
			await start.click();
			await expect(page.locator("html")).toHaveAttribute("data-permissions-closed", "true");
			await expect(page.locator("html")).not.toHaveAttribute("data-changed-onboarding");
		},
	);
}

test("dev skip survives editor reloads and stale production permission requests", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		const getSetting = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) => {
			if (key === "recordly.dev.onboardingDismissed")
				return localStorage.getItem(key) === "true";
			if (key === "recordly.onboarding.permissionsRequested") return true;
			return getSetting(key);
		};
		window.electronAPI.setAppSetting = (key, value) => {
			if (key === "recordly.dev.onboardingDismissed")
				localStorage.setItem(key, String(value));
			else if (key.startsWith("recordly.onboarding."))
				throw new Error("Production settings changed");
			return true;
		};
		window.electronAPI.showOnboardingWindow = async () => false;
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByRole("button", { name: "Skip onboarding", exact: true }).click();
	await expect(tour).not.toBeVisible();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("recordly.dev.onboardingDismissed")))
		.toBe("true");
	await page.reload();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await expect(tour).not.toBeVisible();
	await expect(
		page.getByRole("dialog", { name: "Sign in to Recordly", exact: true }),
	).not.toBeVisible();
});

for (const dev of [true, false]) {
	const modeTest = dev ? test : productionTest;
	modeTest(
		`${dev ? "dev records without an account" : "production requires an account"} with recording permissions granted`,
		async ({ page }) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
			await installDesktopBridgeOverrides(page, () => {
				window.electronAPI.getCountdownDelay = async () => ({ success: true, delay: 0 });
				window.electronAPI.startNativeScreenRecording = async () => {
					document.documentElement.dataset.captureStarted = "true";
					return { success: true };
				};
			});
			await page.goto("/?windowType=hud-overlay");
			await page.getByRole("button", { name: "Record", exact: true }).click();
			if (dev) {
				await expect(page.locator("html")).toHaveAttribute("data-capture-started", "true");
				await expect(page.locator("html")).not.toHaveAttribute("data-permissions-opened");
			} else {
				await expect(page.locator("html")).toHaveAttribute("data-dashboard-opened", "true");
				await expect(page.locator("html")).not.toHaveAttribute("data-permissions-opened");
				await expect(page.locator("html")).not.toHaveAttribute("data-capture-started");
			}
		},
	);
}

for (const dev of [true, false]) {
	const modeTest = dev ? test : productionTest;
	modeTest(
		`${dev ? "dev does not refresh" : "production still refreshes"} the account on a background timer`,
		async ({ page }) => {
			await page.clock.install();
			await installDesktopBridge(page, "preview.mp4", { signedIn: true, onboarded: true });
			const tokenRequests: string[] = [];
			page.on("request", (request) => {
				if (request.url().includes("/auth/v1/token")) tokenRequests.push(request.url());
			});
			await page.goto("/?windowType=editor");
			await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
			await page.clock.fastForward(3_660_000);
			if (dev) {
				await page.waitForTimeout(100);
				expect(tokenRequests).toEqual([]);
			} else await expect.poll(() => tokenRequests.length).toBeGreaterThan(0);
		},
	);
}

productionTest("production ignores a saved dev dismissal", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		const getSetting = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.dev.onboardingDismissed" ? true : getSetting(key);
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour).toBeVisible();
	await expect(tour.getByRole("button", { name: "Skip onboarding", exact: true })).toHaveCount(0);
	await expect(tour.getByRole("button", { name: "Permissions", exact: true })).toBeDisabled();
});
