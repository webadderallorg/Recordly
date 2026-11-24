import { expect, type Page } from "@playwright/test";
import { SAVED_SIGN_IN_LOCKED } from "../../src/lib/auth/savedSignIn";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest } from "./production";

const startupOnboarding = "/?windowType=onboarding&startup=1";

async function mockStartup(page: Page, signedIn: boolean, onboarded = true) {
	await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.resolveStartupOnboarding = async (action) => {
			document.documentElement.dataset.startupAction = action;
			return true;
		};
	});
}

productionTest(
	"a fresh Windows installation uses the shared welcome screen for an existing profile",
	async ({ page }) => {
		await mockStartup(page, false);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getPlatform = async () => "win32";
		});
		await page.goto(`${startupOnboarding}&welcomeSoundtrack=intro`);
		const root = page.locator("html");
		const dialog = page.getByRole("dialog", { name: "Welcome to Recordly", exact: true });
		await expect(dialog.getByRole("button", { name: "Continue as guest" })).toBeEnabled();
		await expect(dialog.getByRole("navigation")).toBeVisible();
		await dialog.getByPlaceholder("you@example.com").fill("test@email.com");
		await dialog.getByRole("button", { name: "Email me a code" }).click();
		await dialog.locator('input[autocomplete="one-time-code"]').fill("123456", { force: true });
		await dialog.getByRole("button", { name: "Verify and continue" }).click();
		await dialog.getByRole("button", { name: "Start recording" }).click();
		await expect(root).toHaveAttribute("data-startup-action", "continue");
		await expect(page.getByRole("dialog")).toHaveCount(0);
	},
);

productionTest(
	"launch waits for a saved session, then opens the HUD without showing onboarding",
	async ({ page }) => {
		await mockStartup(page, true);
		await installDesktopBridgeOverrides(page, () => {
			const originalGet = window.electronAPI.authStorageGetItem;
			const release = new Promise<void>((resolve) =>
				window.addEventListener("release-session", () => resolve(), { once: true }),
			);
			window.electronAPI.authStorageGetItem = async (key) => {
				document.documentElement.dataset.restoringSession = "true";
				await release;
				return originalGet(key);
			};
		});
		await page.goto(startupOnboarding);
		const root = page.locator("html");
		await expect(root).toHaveAttribute("data-restoring-session", "true");
		await expect(root).not.toHaveAttribute("data-startup-action");
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await page.evaluate(() => window.dispatchEvent(new Event("release-session")));
		await expect(root).toHaveAttribute("data-startup-action", "continue");
		await expect(page.getByRole("dialog")).toHaveCount(0);
	},
);

productionTest(
	"signed-out users with an existing profile can choose guest access or sign in",
	async ({ page }) => {
		await mockStartup(page, false);
		await installDesktopBridgeOverrides(page, () => {
			const release = new Promise<void>((resolve) =>
				window.addEventListener("release-callback-ack", () => resolve(), { once: true }),
			);
			window.electronAPI.ackAuthCallbackUrl = async () => {
				document.documentElement.dataset.callbackAck = "pending";
				await release;
			};
			window.electronAPI.openExternalUrl = async (url) => {
				const redirect = new URL(url).searchParams.get("redirect_to");
				if (!redirect) throw new Error("Missing OAuth redirect");
				document.documentElement.dataset.oauthRedirect = redirect;
				return { success: true };
			};
		});
		await page.goto(startupOnboarding);
		const root = page.locator("html");
		const dialog = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(dialog).toBeVisible();
		await expect(root).toHaveAttribute("data-startup-action", "show");
		await expect(dialog).toHaveAttribute("data-onboarding-state", "login");
		await expect(
			dialog.locator("[data-onboarding-artwork] [data-recordly-demo]"),
		).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Continue as guest" })).toBeEnabled();
		await expect(dialog.getByRole("navigation")).toBeVisible();
		await dialog.getByRole("button", { name: "Continue with Google", exact: true }).click();
		await expect(root).toHaveAttribute("data-oauth-redirect", /auth\/callback/);
		await page.evaluate(() => {
			const callback = new URL(document.documentElement.dataset.oauthRedirect!);
			callback.searchParams.set("code", "ui-auth-code");
			window.dispatchEvent(
				new CustomEvent("recordly-test-auth-callback", {
					detail: callback.toString(),
				}),
			);
		});
		await expect(root).toHaveAttribute("data-callback-ack", "pending");
		await expect(root).toHaveAttribute("data-startup-action", "show");
		await page.evaluate(() => window.dispatchEvent(new Event("release-callback-ack")));
		await dialog.getByRole("button", { name: "Start recording" }).click();
		await expect(root).toHaveAttribute("data-startup-action", "continue");
	},
);

productionTest(
	"denied Keychain access shows the saved sign-in recovery instead of the HUD",
	async ({ page }) => {
		await mockStartup(page, true);
		await installDesktopBridgeOverrides(
			page,
			(message) => {
				window.electronAPI.authStorageGetItem = async () => {
					throw new Error(
						`Error invoking remote method 'auth-storage:get': Error: ${message}`,
					);
				};
			},
			SAVED_SIGN_IN_LOCKED,
		);
		await page.goto(startupOnboarding);
		const dialog = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(dialog.getByText("Unlock saved sign-in", { exact: true })).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-startup-action", "show");
		await expect(dialog).toHaveAttribute("data-onboarding-state", "login");
		await dialog.getByRole("button", { name: "Restart Recordly" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-startup-action", "restart");
	},
);

productionTest(
	"signed-in users missing recording access advance to the shared permissions page",
	async ({ page }) => {
		await mockStartup(page, true);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getAccessibilityPermissionStatus = async () => ({
				success: true,
				trusted: false,
			});
		});
		await page.goto(startupOnboarding);
		const dialog = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(
			dialog.getByRole("heading", { name: "Allow Recordly to record" }),
		).toBeVisible();
		await expect(
			dialog.locator("[data-onboarding-artwork] [data-recordly-demo]"),
		).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Start recording" })).toBeDisabled();
		await expect(page.locator("html")).toHaveAttribute("data-startup-action", "show");
		await expect(dialog).toHaveAttribute("data-onboarding-state", "permissions");
	},
);

for (const duringPermissionCheck of [true, false]) {
	productionTest(
		duringPermissionCheck
			? "startup waits when permissions resolve as an OAuth callback arrives"
			: "Start recording waits for an OAuth callback while permissions are visible",
		async ({ page }) => {
			await mockStartup(page, true);
			await installDesktopBridgeOverrides(
				page,
				(duringPermissionCheck) => {
					let dispatchDuringCheck = duringPermissionCheck;
					let access = duringPermissionCheck;
					const startCallback = () => {
						window.dispatchEvent(
							new CustomEvent("recordly-test-auth-callback", {
								detail: "recordly://auth/callback?code=ui-auth-code",
							}),
						);
					};
					const release = new Promise<void>((resolve) =>
						window.addEventListener("release-callback-ack", () => resolve(), {
							once: true,
						}),
					);
					window.addEventListener("test-allow-access", () => {
						access = true;
						window.dispatchEvent(new Event("focus"));
					});
					window.addEventListener("test-start-oauth", startCallback);
					window.electronAPI.getAccessibilityPermissionStatus = async () => {
						if (dispatchDuringCheck) {
							dispatchDuringCheck = false;
							startCallback();
						}
						return { success: true, trusted: access };
					};
					window.electronAPI.ackAuthCallbackUrl = async () => {
						document.documentElement.dataset.callbackAck = "pending";
						await release;
					};
				},
				duringPermissionCheck,
			);
			await page.goto(startupOnboarding);
			const root = page.locator("html");
			const start = page.getByRole("button", { name: "Start recording" });
			if (!duringPermissionCheck) {
				await expect(start).toBeDisabled();
				await page.evaluate(() => window.dispatchEvent(new Event("test-allow-access")));
				await expect(start).toBeEnabled();
				await page.evaluate(() => window.dispatchEvent(new Event("test-start-oauth")));
			}
			await expect(root).toHaveAttribute("data-callback-ack", "pending");
			await expect(root).not.toHaveAttribute("data-startup-action", "continue");
			if (!duringPermissionCheck) await expect(start).toBeDisabled();
			await page.evaluate(() => window.dispatchEvent(new Event("release-callback-ack")));
			if (!duringPermissionCheck) await start.click();
			await expect(root).toHaveAttribute("data-startup-action", "continue");
		},
	);
}
