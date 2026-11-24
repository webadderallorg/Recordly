import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

// The local-export prompt is covered per plan in gif-optimization.spec.ts.

/** Opens the editor with Cloud billing reporting the given plan and share count. */
async function openEditor(page: Page, plan: "free" | "pro", recordings: number, signedIn = true) {
	await installDesktopBridge(page, "preview.mp4", { signedIn, onboarded: true });
	await installDesktopBridgeOverrides(
		page,
		({ plan, recordings }) => {
			const getAppSetting = window.electronAPI.getAppSetting;
			window.electronAPI.getAppSetting = (key) =>
				key === "recordly.dev.onboardingDismissed" ? true : getAppSetting(key);
			const prices = [{ interval: "monthly" as const, unitAmount: 900, currency: "usd" }];
			window.electronAPI.cloudBilling = async ({ action }) => {
				if (action === "catalog")
					return {
						success: true,
						prices,
						limits: {
							freeRecordingLimit: 5,
							freeMaxRecordingBytes: 1e9,
							plusMaxRecordingBytes: 1e10,
							plusWeeklyUploadLimit: 200,
							storageLimitBytes: 1e11,
						},
					};
				if (action !== "status") {
					if (action === "checkout") document.documentElement.dataset.checkout = "true";
					return { success: true };
				}
				return {
					success: true,
					billing: {
						plan,
						subscriptionStatus: plan === "pro" ? "active" : null,
						currentPeriodEnd: null,
						cancelAtPeriodEnd: false,
						checkoutAvailable: true,
						checkoutIntervals: ["monthly"],
						portalAvailable: plan === "pro",
						prices,
					},
					usage: {
						recordings,
						recordingLimit: plan === "pro" ? null : 5,
						maxRecordingBytes: 1e9,
						storageBytes: 0,
						storageLimitBytes: 1e11,
					},
				};
			};
		},
		{ plan, recordings },
	);
	await page.goto("/?windowType=editor");
	await expect(page.locator("video").first()).toBeAttached({ timeout: 20000 });
}

async function openShareLink(page: Page) {
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	const publish = page.getByRole("dialog", { name: "Publish", exact: true });
	await publish.getByRole("row", { name: "Create share link", exact: true }).click();
	return publish;
}

const pricing = (page: Page) => page.getByRole("dialog", { name: "Recordly Plus", exact: true });

test("opening the editor does not show the upgrade modal", async ({ page }) => {
	await openEditor(page, "free", 0);
	await page.waitForTimeout(2500);
	await expect(pricing(page)).toHaveCount(0);
});

test("signing in from Get Started returns to pricing before checkout", async ({ page }) => {
	await openEditor(page, "free", 0, false);
	const upgrade = page.getByRole("button", { name: "Upgrade", exact: true });
	const modal = pricing(page);
	const getStarted = modal.getByRole("button", { name: "Get Started", exact: true });
	const signIn = page.getByRole("dialog", { name: "Sign in to Recordly", exact: true });

	await upgrade.click();
	await getStarted.click();
	await expect(signIn).toBeVisible();
	await signIn.getByRole("button", { name: "Close", exact: true }).click();
	await expect(signIn).toHaveCount(0);
	await expect(modal).toHaveCount(0);

	await upgrade.click();
	await getStarted.click();
	await signIn.getByRole("textbox", { name: /^Email\*?$/ }).fill("test@email.com");
	await signIn.getByRole("button", { name: "Email me a code" }).click();
	await signIn.getByRole("textbox", { name: "Enter code sent to test@email.com" }).fill("123456");
	await signIn.getByRole("button", { name: "Verify and continue", exact: true }).click();
	await expect(signIn).toHaveCount(0);
	await expect(modal).toBeVisible();
	await expect(getStarted).toBeEnabled();
	await expect(page.locator("html")).not.toHaveAttribute("data-checkout");
	await getStarted.click();
	await expect(page.locator("html")).toHaveAttribute("data-checkout", "true");
});

test("free users see how many of their shares they have used", async ({ page }) => {
	await openEditor(page, "free", 2);
	const publish = await openShareLink(page);
	await expect(publish.getByRole("button", { name: "Share (2/5)", exact: true })).toBeEnabled();
	await expect(pricing(page)).toHaveCount(0);
});

test("Pro users see a plain Share button", async ({ page }) => {
	await openEditor(page, "pro", 12);
	const publish = await openShareLink(page);
	await expect(publish.getByRole("button", { name: "Share", exact: true })).toBeVisible();
	await expect(publish.getByRole("button", { name: /^Share \(/ })).toHaveCount(0);
});

test("asking for a sixth share on the free plan opens the upgrade modal", async ({ page }) => {
	await openEditor(page, "free", 5);
	const publish = await openShareLink(page);
	const share = publish.getByRole("button", { name: "Share (5/5)", exact: true });
	await expect(share).toBeEnabled();
	await share.click();
	await expect(pricing(page)).toBeVisible({ timeout: 5000 });
});
