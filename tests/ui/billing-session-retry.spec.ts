import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function prepare(page: Page, mode: "transient" | "rejected") {
	await installDesktopBridge(page);
	// Exercise the real provider around a controlled recovery boundary. Tokens never
	// reach a service: the desktop bridge below implements the authenticated reads.
	await page.route("**/src/lib/auth/recoverBillingSession.ts*", (route) =>
		route.fulfill({
			contentType: "text/javascript",
			body: `export async function recoverBillingSession(_token, owner) {
				const calls = Number(document.documentElement.dataset.recoveryCalls || 0) + 1;
				document.documentElement.dataset.recoveryCalls = String(calls);
				document.documentElement.dataset.recoveryOwners = [document.documentElement.dataset.recoveryOwners, owner].filter(Boolean).join(",");
				if (${JSON.stringify(mode)} === "rejected" || owner === "second-account") return undefined;
				if (calls === 1) throw new Error("Temporary connection failure");
				return new Promise((resolve, reject) => window.addEventListener("release-session-recovery", event => {
					if (event.detail === "fail") reject(new Error("Old account connection failure"));
					else resolve("recovered-session-fixture");
				}, { once: true }));
			}`,
		}),
	);
	await installDesktopBridgeOverrides(page, () => {
		const prices = [{ interval: "monthly", currency: "usd", unitAmount: 900 }];
		window.electronAPI.cloudBilling = async ({ action, token }) => {
			if (action === "catalog")
				return {
					success: true,
					prices,
					limits: {
						freeRecordingLimit: 5,
						freeMaxRecordingBytes: 1e9,
						plusMaxRecordingBytes: 1e10,
						storageLimitBytes: null,
					},
				};
			if (action !== "status") throw new Error("No billing mutation expected");
			if (token !== "recovered-session-fixture")
				return { success: false, httpStatus: 401, error: "Sign in again" };
			return {
				success: true,
				billing: {
					plan: "pro",
					subscriptionStatus: "active",
					currentPeriodEnd: Math.floor(Date.now() / 1000) + 86400,
					cancelAtPeriodEnd: false,
					checkoutAvailable: false,
					checkoutIntervals: [],
					portalAvailable: true,
					prices,
				},
				usage: {
					recordings: 1,
					recordingLimit: null,
					maxRecordingBytes: 1e10,
					storageBytes: 100,
					storageLimitBytes: null,
				},
			};
		};
	});
	await page.goto("/tests/ui/billing-usage.html");
	await expect(page.locator("html")).toHaveAttribute("data-recovery-calls", "1");
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
}

test("explicit retry recovers after a transient refresh failure and shares concurrent reads", async ({
	page,
}) => {
	await prepare(page, "transient");
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-recovery-calls", "2");
	await page.evaluate(() => {
		for (let i = 0; i < 4; i++) {
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
		}
	});
	await expect(page.getByTestId("usage-loading")).toHaveText("true");
	await expect(page.locator("html")).toHaveAttribute("data-recovery-calls", "2");
	await page.evaluate(() => window.dispatchEvent(new Event("release-session-recovery")));
	await expect(page.getByTestId("verified-plan")).toHaveText("pro");
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
});

test("definitively rejected recovery is not repeated by manual refresh", async ({ page }) => {
	await prepare(page, "rejected");
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	await expect(page.locator("html")).toHaveAttribute("data-recovery-calls", "1");
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Sign in to continue", exact: true }),
	).toBeVisible();
});

test("a late old-account failure cannot reset the new account's recovery rejection", async ({
	page,
}) => {
	await prepare(page, "transient");
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-recovery-calls", "2");
	await page.route("https://auth.recordly.test/auth/v1/user", (route) =>
		route.fulfill({
			json: {
				id: "second-account",
				email: "second@example.test",
				aud: "authenticated",
				role: "authenticated",
				app_metadata: {},
				user_metadata: {},
				created_at: "2026-10-25T00:00:00Z",
			},
		}),
	);
	await page.getByRole("button", { name: "Switch account", exact: true }).click();
	await expect(page.getByTestId("usage-owner")).toHaveText("second-account");
	await expect(page.locator("html")).toHaveAttribute("data-recovery-calls", "3");
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("release-session-recovery", { detail: "fail" })),
	);
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	await expect(page.locator("html")).toHaveAttribute("data-recovery-calls", "3");
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
});

test("an obsolete account's delayed 401 cannot consume the current account's recovery attempt", async ({
	page,
}) => {
	await prepare(page, "rejected");
	await page.evaluate(() => {
		window.electronAPI.cloudBilling = async ({ action, token }) => {
			if (action !== "status") throw new Error("Only status reads expected");
			const owner = JSON.parse(atob(token!.split(".")[1])).sub;
			const second = owner === "second-account";
			document.documentElement.dataset.pendingStatusOwner = owner;
			await new Promise((resolve) =>
				window.addEventListener(
					second ? "release-current-status" : "release-obsolete-status",
					resolve,
					{ once: true },
				),
			);
			return { success: false, httpStatus: 401, error: "Sign in again" };
		};
	});
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect(page.getByTestId("usage-loading")).toHaveText("true");
	await page.route("https://auth.recordly.test/auth/v1/user", (route) =>
		route.fulfill({
			json: {
				id: "second-account",
				email: "second@example.test",
				aud: "authenticated",
				role: "authenticated",
				app_metadata: {},
				user_metadata: {},
				created_at: "2026-10-25T00:00:00Z",
			},
		}),
	);
	await page.getByRole("button", { name: "Switch account", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-pending-status-owner",
		"second-account",
	);
	await page.evaluate(() => window.dispatchEvent(new Event("release-obsolete-status")));
	// Separate browser tasks allow the obsolete response's promise chain to settle
	// before the current account's rejected response is delivered.
	await page.evaluate(() => window.dispatchEvent(new Event("release-current-status")));
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	await expect(page.locator("html")).toHaveAttribute(
		"data-recovery-owners",
		"00000000-0000-4000-8000-000000000001,second-account",
	);
});
