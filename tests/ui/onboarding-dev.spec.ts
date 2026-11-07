import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest } from "./production";

for (const signedIn of [false, true]) {
	test(`skipping dev onboarding keeps the HUD open (${signedIn ? "signed in" : "signed out"})`, async ({ page }) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: false });
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getScreenRecordingPermissionStatus = async () => ({ success: true, status: "denied" });
			window.electronAPI.getAccessibilityPermissionStatus = async () => ({ success: true, trusted: false });
			window.electronAPI.showRecordingHud = async () => {
				window.location.assign("/?windowType=hud-overlay");
			};
		});
		await page.clock.install();
		await page.goto("/?windowType=onboarding");
		await page.getByRole("button", { name: "Skip onboarding", exact: true }).click();
		await expect(page.getByRole("group", { name: "Recording setup", exact: true })).toBeVisible();
		// Run startup timers before asserting that preview never opens permissions.
		await page.clock.runFor(1000);
		await expect(page.locator("html")).not.toHaveAttribute("data-permissions-opened");
		// Skipping the tour does not allow an actual recording without the required access.
		await page.getByRole("button", { name: "Record", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-permissions-opened", "true");
	});

	productionTest(`production HUD still checks access on startup (${signedIn ? "signed in" : "signed out"})`, async ({ page }) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: true });
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getScreenRecordingPermissionStatus = async () => ({ success: true, status: "denied" });
		});
		await page.goto("/?windowType=hud-overlay");
		await expect(page.locator("html")).toHaveAttribute("data-permissions-opened", "true");
	});
}

for (const signedIn of [false, true]) {
	for (const query of ["", "&onboardingPreview=0"]) {
		test(`dev onboarding advances without an explicit preview flag (${signedIn ? "signed in" : "signed out"}, ${query || "no query"})`, async ({
			page,
		}) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: false });
			await page.goto(`/?windowType=onboarding${query}`);
			const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
			await expect(tour.getByPlaceholder("you@example.com")).toBeVisible({ timeout: 30000 });
			await tour.getByRole("button", { name: "Continue", exact: true }).click();
			await expect(
				tour.getByRole("heading", { name: "Allow Recordly to record" }),
			).toBeVisible();
			await tour.getByRole("button", { name: "Back to account" }).click();
			await expect(tour.getByPlaceholder("you@example.com")).toBeVisible();
			await tour.getByRole("button", { name: "Permissions", exact: true }).click();
			await tour.getByRole("button", { name: "Start recording", exact: true }).click();
			await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
			await expect(page.locator("html")).toHaveAttribute("data-onboarding-closed", "true");
		});
	}
}

test("automatic first-run onboarding uses preview without writing completion", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.showOnboardingWindow = async (options) => {
			document.documentElement.dataset.previewRequested = String(options?.preview);
			return false;
		};
		const setSetting = window.electronAPI.setAppSetting;
		window.electronAPI.setAppSetting = (key, value) => {
			if (key.startsWith("recordly.onboarding."))
				document.documentElement.dataset.onboardingWritten = "true";
			return setSetting(key, value);
		};
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour).toBeVisible({ timeout: 30000 });
	await expect(page.locator("html")).toHaveAttribute("data-preview-requested", "true");
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	await tour.getByRole("button", { name: "Start recording", exact: true }).click();
	await expect(tour).not.toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-onboarding-written");
});

for (const query of ["", "&onboardingPreview=1"]) {
	productionTest(
		`production onboarding requires sign-in (${query || "no query"})`,
		async ({ page }) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
			await page.goto(`/?windowType=onboarding${query}`);
			const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
			await expect(tour.getByPlaceholder("you@example.com")).toBeVisible({ timeout: 30000 });
			await expect(tour.getByRole("button", { name: "Skip onboarding" })).toHaveCount(0);
			await expect(tour.getByRole("button", { name: "Continue", exact: true })).toHaveCount(
				0,
			);
			await expect(
				tour.getByRole("button", { name: "Permissions", exact: true }),
			).toBeDisabled();
			await expect(
				tour.getByRole("button", { name: "Start recording", exact: true }),
			).toHaveCount(0);
		},
	);
}

for (const windowType of ["onboarding", "editor"]) {
	for (const stage of ["account", "permissions"]) {
		test(`dev can skip ${stage} onboarding from ${windowType} without permission grants or completion writes`, async ({ page }) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
			await installDesktopBridgeOverrides(page, () => {
				window.electronAPI.showOnboardingWindow = async () => false;
				window.electronAPI.getScreenRecordingPermissionStatus = async () => ({ success: true, status: "denied" });
				window.electronAPI.getAccessibilityPermissionStatus = async () => ({ success: true, trusted: false });
				const setSetting = window.electronAPI.setAppSetting;
				window.electronAPI.setAppSetting = (key, value) => {
					if (key.startsWith("recordly.onboarding."))
						document.documentElement.dataset.onboardingWritten = "true";
					return setSetting(key, value);
				};
			});
			await page.goto(`/?windowType=${windowType}`);
			const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
			if (stage === "permissions") {
				await tour.getByRole("button", { name: "Continue", exact: true }).click();
				await expect(tour.getByRole("button", { name: "Start recording", exact: true })).toBeDisabled();
			}
			await tour.getByRole("button", { name: "Skip onboarding", exact: true }).click();
			await expect(tour).not.toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
			await expect(page.locator("html")).toHaveAttribute("data-onboarding-closed", "true");
			await expect(page.locator("html")).not.toHaveAttribute("data-onboarding-written");
		});
	}
}

test("a dev editor with completed onboarding does not reopen mandatory sign-in", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 30000,
	});
	await expect(
		page.getByRole("dialog", { name: "Sign in to Recordly", exact: true }),
	).not.toBeVisible();
});

test("signed-out dev onboarding still waits for real recording permissions", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		let allowed = false;
		window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
			success: true,
			status: allowed ? "granted" : "denied",
		});
		window.electronAPI.openScreenRecordingPreferences = async () => {
			allowed = true;
			return { success: true };
		};
	});
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	const start = tour.getByRole("button", { name: "Start recording", exact: true });
	await expect(start).toBeDisabled();
	await tour.getByRole("button", { name: "Allow Screen Recording", exact: true }).click();
	await expect(start).toBeEnabled();
	await start.click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
});
