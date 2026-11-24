import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest } from "./production";

for (const signedIn of [false, true]) {
	test(`skipping dev onboarding keeps the HUD open (${signedIn ? "signed in" : "signed out"})`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: false });
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
				success: true,
				status: "denied",
			});
			window.electronAPI.getAccessibilityPermissionStatus = async () => ({
				success: true,
				trusted: false,
			});
			window.electronAPI.showRecordingHud = async () => {
				window.location.assign("/?windowType=hud-overlay");
			};
		});
		await page.clock.install();
		await page.goto("/?windowType=onboarding&onboardingPreview=1");
		await page.getByRole("button", { name: "Skip onboarding", exact: true }).click();
		await expect(
			page.getByRole("group", { name: "Recording setup", exact: true }),
		).toBeVisible();
		// Run startup timers before asserting that preview never opens permissions.
		await page.clock.runFor(1000);
		await expect(page.locator("html")).not.toHaveAttribute("data-permissions-opened");
		// Skipping the tour does not allow an actual recording without the required access.
		await page.getByRole("button", { name: "Record", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-permissions-opened", "true");
	});

	productionTest(
		`production HUD still checks access on startup (${signedIn ? "signed in" : "signed out"})`,
		async ({ page }) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: true });
			await installDesktopBridgeOverrides(page, () => {
				window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
					success: true,
					status: "denied",
				});
			});
			await page.goto("/?windowType=hud-overlay");
			await expect(page.locator("html")).toHaveAttribute("data-permissions-opened", "true");
		},
	);
}

for (const signedIn of [false, true]) {
	for (const query of ["", "&onboardingPreview=0"]) {
		test(`dev onboarding preserves the real account (${signedIn ? "signed in" : "signed out"}, ${query || "no query"})`, async ({
			page,
		}) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: false });
			await page.goto(`/?windowType=onboarding${query}`);
			const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
			await expect(tour).toBeVisible();
			await expect(tour.getByRole("button", { name: "Skip onboarding" })).toHaveCount(
				query ? 0 : 1,
			);
			if (signedIn) {
				await expect(
					tour.getByRole("heading", {
						name: query ? "Allow Recordly to record" : "Welcome to Recordly",
						exact: true,
					}),
				).toBeVisible();
				await expect(tour.getByPlaceholder("you@example.com")).toHaveCount(0);
				if (!query)
					await expect(tour.getByText("test@email.com", { exact: true })).toBeVisible();
			} else {
				await expect(tour.getByPlaceholder("you@example.com")).toBeVisible();
				await expect(
					tour.getByRole("button", { name: "Continue as guest", exact: true }),
				).toBeVisible();
				if (query)
					await expect(
						tour.getByRole("button", { name: "Permissions", exact: true }),
					).toBeDisabled();
				else
					await expect(
						tour.getByRole("button", { name: "Permissions", exact: true }),
					).toBeEnabled();
			}
		});
	}
}

test("automatic first-run dev onboarding is optional", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.showOnboardingWindow = async (options) => {
			document.documentElement.dataset.previewRequested = String(options?.preview);
			return false;
		};
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour.getByPlaceholder("you@example.com")).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-preview-requested", "true");
	await expect(tour.getByRole("button", { name: "Skip onboarding" })).toBeVisible();
});

for (const query of ["", "&onboardingPreview=1"]) {
	productionTest(
		`production onboarding offers a guest path (${query || "no query"})`,
		async ({ page }) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
			await page.goto(`/?windowType=onboarding${query}`);
			const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
			await expect(tour.getByPlaceholder("you@example.com")).toBeVisible({ timeout: 30000 });
			await expect(tour.getByRole("button", { name: "Skip onboarding" })).toHaveCount(0);
			await expect(tour.getByRole("button", { name: "Next", exact: true })).toHaveCount(0);
			await expect(
				tour.getByRole("button", { name: "Continue as guest", exact: true }),
			).toBeEnabled();
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
		test(`dev can skip ${stage} onboarding from ${windowType} without permission grants or completion writes`, async ({
			page,
		}) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
			await installDesktopBridgeOverrides(page, () => {
				window.electronAPI.showOnboardingWindow = async () => false;
				window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
					success: true,
					status: "denied",
				});
				window.electronAPI.getAccessibilityPermissionStatus = async () => ({
					success: true,
					trusted: false,
				});
				const setSetting = window.electronAPI.setAppSetting;
				window.electronAPI.setAppSetting = (key, value) => {
					if (key.startsWith("recordly.onboarding."))
						document.documentElement.dataset.onboardingWritten = "true";
					return setSetting(key, value);
				};
			});
			await page.goto(`/?windowType=${windowType}&onboardingPreview=1`);
			const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
			if (stage === "permissions") {
				await tour.getByRole("button", { name: "Continue as guest", exact: true }).click();
				await expect(
					tour.getByRole("button", { name: "Start recording", exact: true }),
				).toBeDisabled();
			}
			await tour.getByRole("button", { name: "Skip onboarding", exact: true }).click();
			await expect(tour).not.toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
			await expect(page.locator("html")).toHaveAttribute("data-onboarding-closed", "true");
			await expect(page.locator("html")).not.toHaveAttribute("data-onboarding-written");
		});
	}
}

test("an explicit real dev editor gives an expired account the guest option", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
	await page.goto("/?windowType=editor&onboardingPreview=0");
	const onboarding = page.getByRole("dialog", { name: "Welcome to Recordly", exact: true });
	await expect(onboarding.getByRole("button", { name: "Continue as guest" })).toBeVisible({
		timeout: 15000,
	});
});

productionTest("guest onboarding resumes macOS permissions after restart", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = (key) => JSON.parse(localStorage.getItem(key) || "null");
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(key, JSON.stringify(value));
			return true;
		};
		window.electronAPI.getScreenRecordingPermissionStatus = async () => {
			document.documentElement.dataset.screenChecked = "true";
			return {
				success: true,
				status: localStorage.getItem("screen-allowed") ? "granted" : "denied",
			};
		};
		window.electronAPI.openScreenRecordingPreferences = async () => {
			localStorage.setItem("screen-allowed", "true");
			return { success: true };
		};
		window.electronAPI.resolveStartupOnboarding = async (action) => {
			document.documentElement.dataset.startupAction = action;
			return true;
		};
	});

	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	const guest = tour.getByRole("button", { name: "Continue as guest", exact: true });
	await expect(guest).toBeEnabled();
	await expect(guest).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await guest.focus();
	await page.keyboard.press("Enter");
	const start = tour.getByRole("button", { name: "Start recording", exact: true });
	await expect(start).toBeDisabled();
	await expect(page.locator("html")).not.toHaveAttribute("data-hud-opened");

	await page.reload();
	await expect(tour).toHaveAttribute("data-onboarding-state", "permissions");
	await expect(start).toBeDisabled();
	await tour.getByRole("button", { name: "Allow Screen Recording", exact: true }).click();
	await expect(start).toBeEnabled();
	await start.click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await expect(tour).not.toBeVisible();

	await page.goto("/?windowType=onboarding&startup=1");
	await expect(page.locator("html")).toHaveAttribute("data-startup-action", "continue");
	await expect(tour).not.toBeVisible();
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator("html")).toHaveAttribute("data-screen-checked", "true");
	await expect(page.locator("html")).not.toHaveAttribute("data-dashboard-opened");
});

for (const platform of ["win32", "linux"]) {
	productionTest(
		`guest onboarding opens recording controls directly on ${platform}`,
		async ({ page }) => {
			await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
			await installDesktopBridgeOverrides(
				page,
				(platform) => {
					window.electronAPI.getPlatform = async () => platform;
					window.electronAPI.getAppSetting = (key) =>
						JSON.parse(localStorage.getItem(key) || "null");
					window.electronAPI.setAppSetting = (key, value) => {
						localStorage.setItem(key, JSON.stringify(value));
						return true;
					};
				},
				platform,
			);
			await page.goto("/?windowType=onboarding");
			const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
			await expect(tour.getByRole("navigation").getByRole("button")).toHaveCount(1);
			await tour.getByRole("button", { name: "Continue as guest", exact: true }).click();
			await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
			await expect(tour).not.toBeVisible();
		},
	);
}

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
	await page.goto("/?windowType=onboarding&onboardingPreview=1");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByRole("button", { name: "Continue as guest", exact: true }).click();
	const start = tour.getByRole("button", { name: "Start recording", exact: true });
	await expect(start).toBeDisabled();
	await tour.getByRole("button", { name: "Allow Screen Recording", exact: true }).click();
	await expect(start).toBeEnabled();
	await start.click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
});
