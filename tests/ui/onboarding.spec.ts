import { expect, type Page, test } from "@playwright/test";
import { completeSupabaseSignIn } from "./auth";
import { productionTest } from "./production";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openDevSettings(page: Page) {
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page
		.getByRole("dialog", { name: "Settings", exact: true })
		.getByRole("tab", { name: "Dev", exact: true })
		.click();
}

test("dedicated onboarding route fills its own window", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.setViewportSize({ width: 760, height: 760 });
	await page.goto("/?windowType=onboarding");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour).toBeVisible();
	await expect(page.locator("[data-startup-intro]")).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-window-type", "onboarding");
	await expect(tour.locator("[data-onboarding-window-drag]")).toBeVisible();
	await expect(tour.getByRole("button", { name: "Close onboarding window" })).toBeVisible();
	await expect
		.poll(async () => {
			const bounds = await tour.boundingBox();
			return (
				bounds &&
				bounds.x >= -1 &&
				bounds.y >= -1 &&
				bounds.width >= 758 &&
				bounds.height >= 758
			);
		})
		.toBe(true);
	await tour.getByRole("button", { name: "Close onboarding window" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-onboarding-closed", "true");
});

test("Show onboarding opens directly after onboarding was completed", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.onboarding.v1.seen" ? true : null;
		window.electronAPI.showOnboardingWindow = async (options) => {
			document.documentElement.dataset.previewRequested = String(options?.preview);
			return false;
		};
	});
	await page.goto("/?windowType=editor");
	await openDevSettings(page);
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await expect(
		page.getByRole("heading", { name: "Welcome to Recordly", exact: true }),
	).toBeVisible();
	await page
		.getByRole("dialog", { name: "Welcome to Recordly" })
		.getByRole("button", { name: "Continue", exact: true })
		.click();
	await expect(page.locator("[data-startup-intro]")).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-preview-requested", "true");
	await expect(page.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
});

test("settings opens permissions and both pages keep the same layout", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 15000,
	});
	await openDevSettings(page);
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await expect(
		page.getByRole("heading", { name: "Welcome to Recordly", exact: true }),
	).toBeVisible();
	await page
		.getByRole("dialog", { name: "Welcome to Recordly" })
		.getByRole("button", { name: "Continue", exact: true })
		.click();
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
	await expect(banner.locator("[data-recordly-demo]")).toBeVisible();
	await expect
		.poll(() =>
			banner
				.locator("[data-recordly-demo] .recordly-banner-light")
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
	await expect(tour.getByPlaceholder("you@example.com")).toBeVisible();
	const loginHeading = (await tour.getByRole("heading", { level: 2 }).boundingBox())!;
	await expect(tour.locator("[data-onboarding-brand]")).toHaveCount(0);
	const accountBannerBounds = (await banner.boundingBox())!;
	expect(accountBannerBounds.height).toBeGreaterThanOrEqual(64);
	expect(accountBannerBounds.width).toBe(bannerBounds.width);
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
	expect(loginHeading.x + loginHeading.width / 2).toBeCloseTo(
		permissionBounds.x + permissionBounds.width / 2,
		0,
	);
	const titleLogo = tour
		.getByRole("heading", { name: "Allow Recordly to record" })
		.locator(".onboarding-title-logo");
	await expect(titleLogo).toHaveCount(1);
	const titleLogoBounds = (await titleLogo.boundingBox())!;
	expect(titleLogoBounds.y).toBeGreaterThanOrEqual(permissionHeading.y - 1);
	expect(titleLogoBounds.y + titleLogoBounds.height).toBeLessThanOrEqual(
		permissionHeading.y + permissionHeading.height + 1,
	);
	await expect(tour.locator("[data-onboarding-brand]")).toHaveCount(0);
	const navigationBounds = (await pages.boundingBox())!;
	expect(navigationBounds.y).toBeGreaterThan(startBounds.y + startBounds.height);
	await expect
		.poll(() =>
			tour.getByRole("button", { name: "Start recording", exact: true }).boundingBox(),
		)
		.toEqual(startBounds);
	await tour.getByRole("button", { name: "Start recording", exact: true }).click();
	await expect(tour).not.toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await openDevSettings(page);
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await expect(
		page.getByRole("heading", { name: "Welcome to Recordly", exact: true }),
	).toBeVisible();
	await page
		.getByRole("dialog", { name: "Welcome to Recordly" })
		.getByRole("button", { name: "Continue", exact: true })
		.click();
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
});

productionTest(
	"first launch opens permissions directly for signed-in users and persists completion",
	async ({ page }) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getAppSetting = (key) =>
				JSON.parse(localStorage.getItem(key) || "null");
			window.electronAPI.setAppSetting = (key, value) => {
				localStorage.setItem(key, JSON.stringify(value));
				return true;
			};
		});
		await page.goto("/?windowType=editor");
		const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(tour).toBeVisible({ timeout: 15000 });
		await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
		await expect(page.locator("[data-permissions-confetti]")).toBeVisible();
		await tour.getByRole("button", { name: "Start recording", exact: true }).click();
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem("recordly.onboarding.v1.seen")))
			.toBe("true");
		await page.reload();
		await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
			timeout: 15000,
		});
		await expect(tour).not.toBeVisible();
	},
);

test("onboarding fits a compact window with reduced motion", async ({ page }) => {
	await installDesktopBridge(page);
	await page.setViewportSize({ width: 620, height: 740 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
		timeout: 15000,
	});
	await openDevSettings(page);
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await expect(
		page.getByRole("heading", { name: "Welcome to Recordly", exact: true }),
	).toBeVisible();
	await page
		.getByRole("dialog", { name: "Welcome to Recordly" })
		.getByRole("button", { name: "Continue", exact: true })
		.click();
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(
		tour.getByRole("button", { name: "Start recording", exact: true }),
	).toBeInViewport();
	await expect(tour.locator("[data-onboarding-artwork] [data-recordly-demo]")).toBeInViewport();
	for (const size of [
		{ width: 450, height: 450 },
		{ width: 390, height: 390 },
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
		await expect(
			tour.getByRole("button", { name: "Start recording", exact: true }),
		).toBeInViewport();
		await expect(tour.getByRole("navigation", { name: "Onboarding pages" })).toBeInViewport();
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
	await openDevSettings(page);
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await expect(
		page.getByRole("heading", { name: "Welcome to Recordly", exact: true }),
	).toBeVisible();
	await page
		.getByRole("dialog", { name: "Welcome to Recordly" })
		.getByRole("button", { name: "Continue", exact: true })
		.click();
	await page.setViewportSize({ width: 390, height: 600 });
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
	await expect(
		tour.getByRole("button", { name: "Start recording", exact: true }),
	).toBeInViewport();
	const body = tour.locator("[data-onboarding-body]");
	await expect(body).toHaveCSS("overflow-y", "auto");
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
	await expect(page.locator("[data-permissions-confetti]")).toHaveCount(0);
	await page.screenshot({ path: "test-results/onboarding-narrow-permissions.png" });
	await tour.getByRole("button", { name: "Back to account" }).click();
	const bounds = await tour.boundingBox();
	await expect(tour.getByRole("button", { name: "Continue", exact: true })).toBeInViewport();
	await expect(tour.locator("[data-onboarding-artwork] [data-recordly-demo]")).toBeInViewport();
	expect(await tour.boundingBox()).toEqual(bounds);
	await expect(tour).toHaveJSProperty("scrollWidth", bounds!.width);
	await page.screenshot({ path: "test-results/onboarding-narrow-account.png" });
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
});

productionTest(
	"square onboarding uses consistent typography and scrolls permissions above fixed actions",
	async ({ page }) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
		await page.setViewportSize({ width: 450, height: 450 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/?windowType=onboarding");
		const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
		const typography = () =>
			tour.getByRole("heading", { level: 2 }).evaluate((element) => {
				const heading = getComputedStyle(element);
				const logo = element.querySelector<HTMLImageElement>(".onboarding-title-logo")!;
				const header = element.closest<HTMLElement>(".onboarding-header")!;
				return {
					fontFamily: heading.fontFamily,
					fontSize: heading.fontSize,
					fontWeight: heading.fontWeight,
					lineHeight: heading.lineHeight,
					letterSpacing: heading.letterSpacing,
					logoWidth: logo.getBoundingClientRect().width,
					logoHeight: logo.getBoundingClientRect().height,
					headerGap: getComputedStyle(header).gap,
				};
			});
		await expect(tour.getByRole("heading", { name: "Welcome to Recordly" })).toBeVisible();
		const accountTypography = await typography();
		const accountBanner = await tour.locator("[data-onboarding-artwork]").boundingBox();
		await tour.getByPlaceholder("you@example.com").fill("test@email.com");
		await tour.getByRole("button", { name: "Email me a code" }).click();
		await expect(tour.getByText(/Enter code sent to/)).toBeVisible();
		await completeSupabaseSignIn(page);
		await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
		expect(await typography()).toEqual(accountTypography);
		const permissionBanner = (await tour.locator("[data-onboarding-artwork]").boundingBox())!;
		// The banner grows into spare space, so its height can change when the page content does.
		expect(permissionBanner.width).toBe(accountBanner!.width);
		expect(permissionBanner.height).toBeGreaterThanOrEqual(64);
		const body = tour.locator("[data-onboarding-body]");
		await expect(body).toHaveCSS("overflow-y", "auto");
		await expect
			.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight))
			.toBeGreaterThan(0);
		await body.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		await expect(
			tour.getByText("Microphone and camera access are requested when you use them.", {
				exact: false,
			}),
		).toBeInViewport();
		await expect(tour.getByRole("button", { name: "Start recording" })).toBeInViewport();
		await expect(tour.getByRole("navigation", { name: "Onboarding pages" })).toBeInViewport();
		const bodyBounds = (await body.boundingBox())!;
		const footerBounds = (await tour.locator(".onboarding-footer").boundingBox())!;
		expect(bodyBounds.y + bodyBounds.height).toBeLessThanOrEqual(footerBounds.y);
		await page.screenshot({ path: "test-results/onboarding-square-permissions.png" });
	},
);

productionTest("sign-in is mandatory even after onboarding was completed", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
	await page.addInitScript(() => sessionStorage.setItem("recordly.demo-session", "1"));
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Sign in to Recordly", exact: true });
	await expect(tour).toBeVisible();
	await expect(tour.getByRole("button", { name: "Continue without signing in" })).toHaveCount(0);
	await expect(tour.getByText("Optional", { exact: true })).toHaveCount(0);
	await expect(tour.getByText("Sign in to continue", { exact: true })).toHaveCount(0);
	const pages = tour.getByRole("navigation", { name: "Onboarding pages" });
	await expect(pages).toHaveCount(0);
	await expect(tour.getByRole("button", { name: "Start recording" })).toHaveCount(0);
	await expect(tour.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.mouse.click(5, 5);
	await expect(tour).toBeVisible();
	await page.reload();
	await expect(tour).toBeVisible();
});

productionTest(
	"Supabase email callback advances to permissions only after a session is returned",
	async ({ page }) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getAppSetting = (key) =>
				JSON.parse(localStorage.getItem(key) || "null");
			window.electronAPI.setAppSetting = (key, value) => {
				localStorage.setItem(key, JSON.stringify(value));
				return true;
			};
		});
		await page.goto("/?windowType=editor");
		const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await tour.getByPlaceholder("you@example.com").fill("test@email.com");
		const otpRequest = page.waitForRequest((request) => request.url().includes("/auth/v1/otp"));
		await tour.getByRole("button", { name: "Email me a code" }).click();
		expect((await otpRequest).postDataJSON()).toMatchObject({
			email: "test@email.com",
			create_user: true,
		});
		await expect(tour.getByText(/Enter code sent to/)).toBeVisible();
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
		await expect(
			tour.getByRole("button", { name: "Start recording", exact: true }),
		).toBeEnabled();
		await tour.getByRole("button", { name: "Start recording", exact: true }).click();
		await expect(tour).not.toBeVisible();
		await page.reload();
		await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible({
			timeout: 15000,
		});
		await expect(tour).not.toBeVisible();
	},
);

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
	await openDevSettings(page);
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await expect(
		page.getByRole("heading", { name: "Welcome to Recordly", exact: true }),
	).toBeVisible();
	await page
		.getByRole("dialog", { name: "Welcome to Recordly" })
		.getByRole("button", { name: "Continue", exact: true })
		.click();
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
	await expect(page.locator("[data-permissions-confetti]")).toHaveCount(0);
	await expect(page.locator("html")).not.toHaveAttribute("data-screen-settings");
	await tour.getByRole("button", { name: "Allow Screen Recording", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-screen-settings", "true");
	await expect(start).toBeDisabled();
	await tour.getByRole("button", { name: "Allow Accessibility", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-accessibility-settings", "true");
	await expect(tour.getByText("Allowed", { exact: true })).toHaveCount(2);
	await expect(start).toBeEnabled();
	await expect(page.locator("[data-permissions-confetti]")).toBeVisible();
	await expect(page.locator("[data-permissions-confetti]")).toHaveCount(0, { timeout: 5000 });
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(page.locator("[data-permissions-confetti]")).toHaveCount(0);
	await tour.getByRole("button", { name: "Back to account" }).click();
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(page.locator("[data-permissions-confetti]")).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator("[data-permissions-confetti] canvas")
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
		await installDesktopBridgeOverrides(
			page,
			(platform) => {
				window.electronAPI.getPlatform = async () => platform;
				window.electronAPI.getScreenRecordingPermissionStatus = async () => {
					throw new Error("macOS-only check");
				};
				window.electronAPI.getAccessibilityPermissionStatus = async () => {
					throw new Error("macOS-only check");
				};
			},
			platform,
		);
		await page.goto("/?windowType=editor");
		await openDevSettings(page);
		await page.getByRole("button", { name: "Show onboarding" }).click();
		await expect(
			page.getByRole("heading", { name: "Welcome to Recordly", exact: true }),
		).toBeVisible();
		await page
			.getByRole("dialog", { name: "Welcome to Recordly" })
			.getByRole("button", { name: "Continue", exact: true })
			.click();
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

productionTest(
	"a permission request opens its page even after onboarding was already completed",
	async ({ page }) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
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
		const tour = page.getByRole("dialog", { name: "Permissions", exact: true });
		await expect(tour).toBeVisible({ timeout: 15000 });
		await expect(tour.getByRole("navigation")).toHaveCount(0);
		await expect(tour.getByRole("button", { name: "Back to account" })).toHaveCount(0);
		await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
		await expect(
			tour.getByRole("button", { name: "Continue without signing in" }),
		).not.toBeVisible();
	},
);

for (const platform of ["darwin", "win32", "linux"]) {
	test(`${platform} HUD requires a Supabase session before recording`, async ({ page }) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
		await page.addInitScript((platform) => {
			window.electronAPI.getPlatform = async () => platform;
		}, platform);
		await page.goto("/?windowType=hud-overlay");
		await expect(page.locator("html")).toHaveAttribute("data-permissions-opened", "true");
	});
}

for (const signedIn of [true, false]) {
	test(`dev preview replays welcome and music with signedIn=${signedIn}`, async ({ page }) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: true });
		await page.addInitScript(() => {
			localStorage.setItem("recordly.first-boot-music.v1.played", "true");
			window.electronAPI.getAppSetting = (key) =>
				key === "recordly.onboarding.v1.seen" ||
				key === "recordly.first-boot-music.v1.played"
					? true
					: null;
			window.electronAPI.setAppSetting = (key, value) => {
				localStorage.setItem(`test-write:${key}`, JSON.stringify(value));
				return true;
			};
			HTMLMediaElement.prototype.play = async function () {
				if (this instanceof HTMLAudioElement)
					document.documentElement.dataset.welcomeMusic = this.src;
			};
			HTMLMediaElement.prototype.pause = function () {
				if (this instanceof HTMLAudioElement)
					document.documentElement.dataset.welcomeMusicStopped = "true";
			};
		});
		await page.goto("/?windowType=onboarding&onboardingPreview=1");
		const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(tour).toHaveAttribute("data-onboarding-state", "login");
		await expect(tour.getByRole("heading", { name: "Welcome to Recordly" })).toBeVisible();
		await expect(tour.getByPlaceholder("you@example.com")).toBeVisible();
		await expect(tour.getByText("Your account", { exact: true })).toHaveCount(0);
		await expect(page.locator("html")).toHaveAttribute(
			"data-welcome-music",
			/audio\/first-boot.m4a$/,
		);
		const music = tour.getByRole("button", { name: "Mute welcome music" });
		await expect(music).toHaveAttribute("aria-pressed", "true");
		const soundBounds = await music.boundingBox();
		expect(soundBounds).not.toBeNull();
		expect(soundBounds!.x).toBeLessThan(64);
		expect(soundBounds!.y).toBeLessThan(64);
		await page.screenshot({
			path: `test-results/onboarding-sound-toggle-${signedIn}.png`,
			animations: "disabled",
		});
		await music.click();
		const pausedMusic = tour.getByRole("button", { name: "Unmute welcome music" });
		await expect(pausedMusic).toBeVisible();
		await expect(pausedMusic).toHaveAttribute("aria-pressed", "false");
		await expect(page.locator("html")).toHaveAttribute("data-welcome-music-stopped", "true");
		await pausedMusic.click();
		await expect(music).toHaveAttribute("aria-pressed", "true");
		await tour.getByRole("button", { name: "Continue", exact: true }).click();
		await expect(tour).toHaveAttribute("data-onboarding-state", "permissions");
		await tour.getByRole("button", { name: "Back to account" }).click();
		await tour
			.getByRole("navigation")
			.getByRole("button", { name: "Permissions", exact: true })
			.click();
		await expect(tour).toHaveAttribute("data-onboarding-state", "permissions");
		await tour.getByRole("button", { name: "Start recording", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
		await expect(page.locator("html")).toHaveAttribute("data-onboarding-closed", "true");
		await expect(page.locator("html")).toHaveAttribute("data-welcome-music-stopped", "true");
		expect(
			await page.evaluate(() =>
				localStorage.getItem("test-write:recordly.onboarding.v1.seen"),
			),
		).toBeNull();
		expect(
			await page.evaluate(() =>
				localStorage.getItem("test-write:recordly.first-boot-music.v1.played"),
			),
		).toBeNull();
		await page.reload();
		await expect(tour.getByRole("heading", { name: "Welcome to Recordly" })).toBeVisible();
		await expect(tour.getByRole("button", { name: "Mute welcome music" })).toBeVisible();
	});
}

test("Review permission setup uses onboarding preview in development", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.showOnboardingWindow = async (options) => {
			document.documentElement.dataset.previewRequested = String(options?.preview);
			return false;
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await page
		.getByRole("dialog", { name: "Settings", exact: true })
		.getByRole("tab", { name: "Recording", exact: true })
		.click();
	await page.getByRole("button", { name: "Review permission setup", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-preview-requested", "true");
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly", exact: true });
	await expect(tour.getByPlaceholder("you@example.com")).toBeVisible();
	await tour.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(tour.getByRole("navigation")).toBeVisible();
	await expect(tour.getByRole("button", { name: "Back to account" })).toBeVisible();
	await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
});

test("welcome mark and video blend into floating blue blobs regardless of reduced motion", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
	await page.setViewportSize({ width: 760, height: 760 });
	await page.goto("/?windowType=onboarding&onboardingPreview=1");
	await expect(page.getByRole("heading", { name: "Welcome to Recordly" })).toBeVisible();
	const styles = await page.locator(".onboarding-title-logo").evaluate((logo) => {
		const style = getComputedStyle(logo);
		const root = document.querySelector(".onboarding-layout")!;
		const pulse = getComputedStyle(root.querySelector(".onboarding-blob")!);
		const artwork = getComputedStyle(document.querySelector(".onboarding-artwork")!);
		return {
			color: style.backgroundColor,
			mask: style.maskImage,
			pulse: pulse.animationName,
			duration: pulse.animationDuration,
			fade: artwork.maskImage,
		};
	});
	expect(styles.color).not.toBe("rgba(0, 0, 0, 0)");
	expect(styles.mask).toContain("recordly-mark.svg");
	expect(styles.pulse).toBe("onboarding-blob-one");
	expect(styles.duration).toBe("12s");
	expect(styles.fade).toContain("rgba(0, 0, 0, 0) 100%");
	await expect(page.locator(".onboarding-blob")).toHaveCount(3);
	const position = () =>
		page.locator(".onboarding-blob-one").evaluate((el) => el.getBoundingClientRect().x);
	const initialPosition = await position();
	await expect
		.poll(async () => Math.abs((await position()) - initialPosition), { timeout: 6000 })
		.toBeGreaterThan(8);
	await page.screenshot({ path: test.info().outputPath("welcome-pulse-preview.png") });
});
