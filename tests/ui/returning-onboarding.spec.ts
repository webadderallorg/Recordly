import { expect, type Page } from "@playwright/test";
import { SAVED_SIGN_IN_LOCKED } from "../../src/lib/auth/savedSignIn";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest } from "./production";

const returningOnboarding = "/?windowType=onboarding&returning=1";

async function mockStartup(page: Page, signedIn: boolean) {
	await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: true });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.resolveStartupOnboarding = async (action) => {
			document.documentElement.dataset.startupAction = action;
			return true;
		};
	});
}

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
		await page.goto(returningOnboarding);
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
	"returning signed-out users sign in before getting the recording controls",
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
		});
		await page.goto(returningOnboarding);
		const root = page.locator("html");
		const dialog = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(dialog).toBeVisible();
		await expect(root).toHaveAttribute("data-startup-action", "show");
		await expect(dialog).toHaveAttribute("data-onboarding-state", "login");
		await expect(
			dialog.locator("[data-onboarding-artwork] [data-recordly-demo]"),
		).toBeVisible();
		await expect(dialog.getByRole("navigation")).toHaveCount(0);
		await dialog.getByPlaceholder("you@example.com").fill("test@email.com");
		await dialog.getByRole("button", { name: "Email me a code" }).click();
		await expect(dialog.getByText("Enter code sent to test@email.com")).toBeVisible();
		await page.evaluate(() => {
			window.dispatchEvent(
				new CustomEvent("recordly-test-auth-callback", {
					detail: "recordly://auth/callback?code=ui-auth-code",
				}),
			);
		});
		await expect(root).toHaveAttribute("data-callback-ack", "pending");
		await expect(root).toHaveAttribute("data-startup-action", "show");
		await page.evaluate(() => window.dispatchEvent(new Event("release-callback-ack")));
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
		await page.goto(returningOnboarding);
		const dialog = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(dialog.getByText("Unlock saved sign-in", { exact: true })).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-startup-action", "show");
		await expect(dialog).toHaveAttribute("data-onboarding-state", "login");
		await dialog.getByRole("button", { name: "Restart Recordly" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-startup-action", "restart");
	},
);

productionTest(
	"signed-in returning users missing recording access see only the permissions page",
	async ({ page }) => {
		await mockStartup(page, true);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getAccessibilityPermissionStatus = async () => ({
				success: true,
				trusted: false,
			});
		});
		await page.goto(returningOnboarding);
		const dialog = page.getByRole("dialog", { name: "Permissions" });
		await expect(
			dialog.getByRole("heading", { name: "Allow Recordly to record" }),
		).toBeVisible();
		await expect(
			dialog.locator("[data-onboarding-artwork] [data-recordly-demo]"),
		).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Start recording" })).toBeDisabled();
		await expect(page.locator("html")).toHaveAttribute("data-startup-action", "show");
		await expect(page.getByRole("dialog", { name: "Welcome to Recordly" })).toHaveCount(0);
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
			await page.goto(returningOnboarding);
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
			await expect(root).toHaveAttribute("data-startup-action", "continue");
		},
	);
}
