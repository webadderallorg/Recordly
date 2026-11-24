import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

// The finished-export prompt is covered per plan in gif-optimization.spec.ts.

/** Opens the editor signed in, with Cloud billing reporting the given plan and share count. */
async function openEditor(page: Page, plan: "free" | "pro", recordings: number) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		({ plan, recordings }) => {
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
				if (action !== "status") return { success: true };
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

const pricing = (page: Page) => page.getByRole("dialog", { name: "Recordly Cloud", exact: true });

test("opening the editor does not show the upgrade modal", async ({ page }) => {
	await openEditor(page, "free", 0);
	await page.waitForTimeout(2500);
	await expect(pricing(page)).toHaveCount(0);
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
