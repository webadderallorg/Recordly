import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
import { completeSupabaseSignIn } from "./auth";

test("settings opens permissions and the carousel banner adapts to each page", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 15000,
	});
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(tour.getByText("Allowed", { exact: true })).toHaveCount(2);
	await expect
		.poll(() =>
			tour
				.locator(".onboarding-permissions")
				.evaluate((element) => element.scrollHeight - element.clientHeight),
		)
		.toBeLessThanOrEqual(1);
	const pages = tour.getByRole("navigation", { name: "Onboarding pages" });
	await expect(pages.getByRole("button", { name: "Permissions", exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(pages.getByRole("button")).toHaveCount(2);
	await expect(tour.getByRole("listitem")).toHaveCount(0);
	await expect(pages).toBeInViewport();
	await expect(page.locator(".modal__container")).not.toHaveAttribute("data-entering", "true");
	const permissionBounds = (await tour.boundingBox())!;
	const banner = tour.locator("[data-onboarding-artwork]");
	const bannerBounds = (await banner.boundingBox())!;
	await expect(banner.locator('img[src$="login-banner.png"]')).toBeVisible();
	await expect
		.poll(() =>
			banner
				.locator('img[src$="login-banner.png"]')
				.evaluate((image: HTMLImageElement) => image.naturalWidth),
		)
		.toBeGreaterThan(0);
	const startBounds = (await tour
		.getByRole("button", { name: "Start recording", exact: true })
		.boundingBox())!;
	await expect(tour.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
	await pages.getByRole("button", { name: "Account", exact: true }).click();
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
	await expect(pages.getByRole("button", { name: "Account", exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(tour.getByText("test@email.com", { exact: true })).toBeVisible();
	const loginHeading = (await tour.getByRole("heading", { level: 2 }).boundingBox())!;
	const brand = tour.locator("[data-onboarding-brand]");
	const brandBounds = (await brand.boundingBox())!;
	const accountBannerBounds = (await banner.boundingBox())!;
	expect(accountBannerBounds.height).toBeGreaterThan(bannerBounds.height);
	expect(accountBannerBounds.width).toBe(bannerBounds.width);
	expect(brandBounds.y).toBeGreaterThanOrEqual(
		accountBannerBounds.y + accountBannerBounds.height,
	);
	expect(brandBounds.y + brandBounds.height).toBeLessThan(loginHeading.y);
	await expect(banner.locator('img[src$="recordly-128.png"]')).toHaveCount(0);
	expect(await tour.boundingBox()).toEqual(permissionBounds);
	expect(await banner.boundingBox()).toEqual(accountBannerBounds);
	await page.screenshot({ path: "test-results/onboarding-login.png", animations: "disabled" });
	await pages.getByRole("button", { name: "Permissions", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(tour).toHaveAttribute("data-onboarding-state", "permissions");
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	expect(await tour.boundingBox()).toEqual(permissionBounds);
	expect(await banner.boundingBox()).toEqual(bannerBounds);
	const permissionHeading = (await tour.getByRole("heading", { level: 2 }).boundingBox())!;
	expect(permissionHeading.x).toBe(loginHeading.x);
	const permissionBrandBounds = (await brand.boundingBox())!;
	expect(permissionBrandBounds.y + permissionBrandBounds.height).toBeLessThan(
		permissionHeading.y,
	);
	expect(permissionBrandBounds.width).toBe(brandBounds.width);
	expect(permissionBrandBounds.height).toBe(brandBounds.height);
	const navigationBounds = (await pages.boundingBox())!;
	expect(navigationBounds.y).toBeGreaterThan(startBounds.y + startBounds.height);
	expect(
		await tour.getByRole("button", { name: "Start recording", exact: true }).boundingBox(),
	).toEqual(startBounds);
	await tour.getByRole("button", { name: "Start recording", exact: true }).click();
	await expect(tour).not.toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
});

test("first launch persists completion and signed-in users can continue", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getAppSetting = (key) => JSON.parse(localStorage.getItem(key) || "null");
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(key, JSON.stringify(value));
			return true;
		};
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(tour.locator("[data-permissions-confetti]")).toBeVisible();
	await tour.getByRole("button", { name: "Start recording", exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("recordly.onboarding.v1.seen")))
		.toBe("true");
	await page.reload();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 15000,
	});
	await expect(tour).not.toBeVisible();
});

test("onboarding fits a compact window with reduced motion", async ({ page }) => {
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
	await expect(
		tour.getByRole("button", { name: "Start recording", exact: true }),
	).toBeInViewport();
	await expect(
		tour.locator('[data-onboarding-artwork] img[src$="login-banner.png"]'),
	).toBeInViewport();
	for (const size of [
		{ width: 720, height: 780 },
		{ width: 640, height: 650 },
		{ width: 390, height: 600 },
		{ width: 620, height: 740 },
	]) {
		await page.setViewportSize(size);
		await expect
			.poll(() =>
				tour
					.locator(".onboarding-permissions")
					.evaluate((element) => element.scrollHeight - element.clientHeight),
			)
			.toBeLessThanOrEqual(1);
	}
	await page.screenshot({ path: "test-results/onboarding-compact.png" });
	await tour.getByRole("button", { name: "Back to account" }).click();
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
});

test("short dark windows keep the banner and navigation visible while the account form scrolls", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await page.setViewportSize({ width: 390, height: 600 });
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(
		tour.getByRole("button", { name: "Start recording", exact: true }),
	).toBeInViewport();
	const body = tour.locator("[data-onboarding-body]");
	await expect
		.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight))
		.toBeLessThanOrEqual(1);
	await expect
		.poll(() =>
			body.evaluate(
				(element) =>
					element.parentElement!.scrollHeight - element.parentElement!.clientHeight,
			),
		)
		.toBeLessThanOrEqual(1);
	const bodyBounds = (await body.boundingBox())!;
	const footerBounds = (await tour
		.getByRole("button", { name: "Back to account" })
		.boundingBox())!;
	expect(bodyBounds.y + bodyBounds.height).toBeLessThanOrEqual(footerBounds.y);
	await expect(tour.locator("[data-permissions-confetti]")).toHaveCount(0);
	await page.screenshot({ path: "test-results/onboarding-narrow-permissions.png" });
	await tour.getByRole("button", { name: "Back to account" }).click();
	const bounds = await tour.boundingBox();
	await expect(tour.getByRole("button", { name: "Continue", exact: true })).toBeInViewport();
	await expect(
		tour.locator('[data-onboarding-artwork] img[src$="login-banner.png"]'),
	).toBeInViewport();
	expect(await tour.boundingBox()).toEqual(bounds);
	await expect(tour).toHaveJSProperty("scrollWidth", bounds!.width);
	await page.screenshot({ path: "test-results/onboarding-narrow-account.png" });
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
});

test("sign-in is mandatory even after onboarding was completed", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false });
	await page.addInitScript(() => sessionStorage.setItem("recordly.demo-session", "1"));
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
	await expect(tour.getByRole("button", { name: "Continue without signing in" })).toHaveCount(0);
	await expect(tour.getByText("Optional", { exact: true })).toHaveCount(0);
	await expect(tour.getByText("Sign in to continue", { exact: true })).toHaveCount(0);
	const pages = tour.getByRole("navigation", { name: "Onboarding pages" });
	await expect(pages).toBeInViewport();
	await expect(pages.getByRole("button", { name: "Account", exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(pages.getByRole("button", { name: "Permissions", exact: true })).toBeDisabled();
	await expect(tour.getByRole("button", { name: "Start recording" })).toHaveCount(0);
	await expect(tour.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.mouse.click(5, 5);
	await expect(tour).toBeVisible();
	await page.reload();
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
});

test("Supabase email callback advances to permissions only after a session is returned", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false });
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await tour.getByPlaceholder("you@example.com").fill("test@email.com");
	const otpRequest = page.waitForRequest((request) => request.url().includes("/auth/v1/otp"));
	await tour.getByRole("button", { name: "Email me a magic link" }).click();
	expect((await otpRequest).postDataJSON()).toMatchObject({
		email: "test@email.com",
		create_user: true,
	});
	await expect(tour.getByText(/Check your inbox to verify your email/)).toBeVisible();
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
	const exchange = page.waitForRequest((request) => request.url().includes("/auth/v1/token"));
	await completeSupabaseSignIn(page);
	expect((await exchange).postDataJSON()).toMatchObject({
		auth_code: "ui-auth-code",
		code_verifier: expect.any(String),
	});
	await expect(tour).toHaveAttribute("data-onboarding-state", "permissions");
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(
		tour
			.getByRole("navigation", { name: "Onboarding pages" })
			.getByRole("button", { name: "Permissions", exact: true }),
	).toBeEnabled();
	await expect(tour.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
	await tour.getByRole("button", { name: "Start recording", exact: true }).click();
	await expect(tour).not.toBeVisible();
	await page.reload();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 15000,
	});
	await expect(tour).not.toBeVisible();
});

test("missing macOS permissions gate Start recording until access is allowed", async ({ page }) => {
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
	const start = tour.getByRole("button", { name: "Start recording", exact: true });
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(start).toBeDisabled();
	await page.setViewportSize({ width: 390, height: 600 });
	await expect
		.poll(() =>
			tour
				.locator(".onboarding-permissions")
				.evaluate((element) => element.scrollHeight - element.clientHeight),
		)
		.toBeLessThanOrEqual(1);
	await expect(tour.locator("[data-permissions-confetti]")).toHaveCount(0);
	await expect(page.locator("html")).not.toHaveAttribute("data-screen-settings");
	await tour.getByRole("button", { name: "Allow Screen Recording", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-screen-settings", "true");
	await expect(start).toBeDisabled();
	await tour.getByRole("button", { name: "Allow Accessibility", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-accessibility-settings", "true");
	await expect(tour.getByText("Allowed", { exact: true })).toHaveCount(2);
	await expect(start).toBeEnabled();
	await expect(tour.locator("[data-permissions-confetti]")).toBeVisible();
	await expect(tour.locator("[data-permissions-confetti]")).toHaveCount(0, { timeout: 5000 });
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(tour.locator("[data-permissions-confetti]")).toHaveCount(0);
	await tour.getByRole("button", { name: "Back to account" }).click();
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(tour.locator("[data-permissions-confetti]")).toBeVisible();
	await expect
		.poll(() =>
			tour
				.locator("[data-permissions-confetti] span")
				.first()
				.evaluate((element) => Number(getComputedStyle(element).opacity)),
		)
		.toBeGreaterThan(0.5);
	await page.screenshot({
		path: "test-results/onboarding-permissions.png",
		animations: "disabled",
	});
	await start.click();
	await expect(tour).not.toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
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
		await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
		await expect(
			tour.getByRole("button", { name: "Start recording", exact: true }),
		).toBeEnabled();
		await expect(tour.getByText("Screen Recording", { exact: true })).toHaveCount(0);
		await expect(tour.getByText("macOS System Settings", { exact: false })).toHaveCount(0);
		await tour.getByRole("button", { name: "Start recording", exact: true }).click();
		await expect(tour).not.toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
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

for (const platform of ["darwin", "win32", "linux"]) {
	test(`${platform} HUD requires a Supabase session before recording`, async ({ page }) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn: false });
		await page.addInitScript((platform) => {
			window.electronAPI.getPlatform = async () => platform;
		}, platform);
		await page.goto("/?windowType=hud-overlay");
		await expect(page.locator("html")).toHaveAttribute("data-permissions-opened", "true");
	});
}
