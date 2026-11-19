import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

type PlanMode =
	| "free"
	| "paid"
	| "ending"
	| "complimentary"
	| "past_due"
	| "unavailable"
	| "loading"
	| "portal_failure"
	| "paid_no_portal";

async function openPlan(page: Page, mode: PlanMode) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		({ mode }) => {
			const prices = [{ interval: "monthly" as const, unitAmount: 900, currency: "usd" }];
			let failedPortal = false;
			window.electronAPI.cloudBilling = async ({ action }) => {
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
				if (action === "portal" || action === "checkout") {
					document.documentElement.dataset.billingAction = action;
					if (mode === "portal_failure" && !failedPortal) {
						failedPortal = true;
						return { success: false, error: "private provider diagnostic" };
					}
					return { success: true };
				}
				if (mode === "loading" && document.documentElement.dataset.planReady !== "true")
					await new Promise<void>((resolve) =>
						document.addEventListener("release-plan", () => resolve(), { once: true }),
					);
				if (mode === "unavailable" && document.documentElement.dataset.planReady !== "true")
					return { success: false, error: "Network unavailable" };
				const plus = [
					"paid",
					"ending",
					"complimentary",
					"portal_failure",
					"paid_no_portal",
				].includes(mode);
				return {
					success: true,
					billing: {
						plan: plus ? "pro" : "free",
						subscriptionStatus:
							mode === "past_due" ? "past_due" : plus ? "active" : null,
						currentPeriodEnd: plus && mode !== "complimentary" ? 1893456000 : null,
						cancelAtPeriodEnd: mode === "ending",
						portalAvailable: ["paid", "ending", "portal_failure", "past_due"].includes(
							mode,
						),
						checkoutAvailable: !plus && mode !== "past_due",
						checkoutIntervals: !plus && mode !== "past_due" ? ["monthly"] : [],
						prices,
					},
					usage: {
						recordings: 2,
						recordingLimit: plus ? null : 5,
						maxRecordingBytes: plus ? 1e10 : 1e9,
						storageBytes: 200,
						storageLimitBytes: plus ? null : 1e11,
					},
				};
			};
			window.electronAPI.cloudBillingCancel = async () => ({ success: true });
		},
		{ mode },
	);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Manage account", exact: true })
		.click();
	const account = page.getByRole("dialog", { name: "Account settings", exact: true });
	await account.getByRole("tab", { name: "Plan & billing", exact: true }).click();
	return { account, card: account.locator(".account-plan-card") };
}

test("Free accounts can view their plan and upgrade options without starting checkout", async ({
	page,
}) => {
	const { account, card } = await openPlan(page, "free");
	await expect(card.getByText("Free", { exact: true })).toBeVisible();
	const usage = account.getByLabel("Cloud usage", { exact: true });
	expect(
		Math.abs((await usage.boundingBox())!.width - (await card.boundingBox())!.width),
	).toBeLessThan(1);
	await expect(
		account.getByLabel("Cloud usage", { exact: true }).getByText("2 of 5 used"),
	).toBeVisible();
	await card.getByRole("button", { name: "Upgrade", exact: true }).click();
	const pricing = page.getByRole("dialog", { name: "Recordly Cloud", exact: true });
	await expect(pricing).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-billing-action");
	await pricing.getByRole("button", { name: "Close", exact: true }).click();
	await expect(account.getByRole("tab", { name: "Plan & billing", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await account.screenshot({
		path: test.info().outputPath("account-plan-free.png"),
		animations: "disabled",
	});
});

for (const mode of ["paid", "ending"] as const) {
	test(`${mode} Cloud accounts can manage their existing subscription directly`, async ({
		page,
	}) => {
		const { account, card } = await openPlan(page, mode);
		await expect(card.getByText("Your Cloud plan is active.")).toBeVisible();
		await expect(
			card.getByText(mode === "ending" ? /^It ends on / : /^Current billing period ends on /),
		).toBeVisible();
		await expect(card.getByRole("button", { name: /^Upgrade\b/ })).toHaveCount(0);
		await card.getByRole("button", { name: "Manage subscription", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-billing-action", "portal");
		await expect(
			page.getByRole("dialog", { name: "Recordly Cloud", exact: true }),
		).not.toBeVisible();
		await account.screenshot({
			path: test.info().outputPath(`account-plan-${mode}.png`),
			animations: "disabled",
		});
	});
}

test("complimentary Cloud has no invented billing period or portal", async ({ page }) => {
	const { card } = await openPlan(page, "complimentary");
	await expect(card.getByText("Your Cloud plan is active.")).toBeVisible();
	await expect(
		card.getByRole("button", { name: "Manage subscription", exact: true }),
	).toHaveCount(0);
	await expect(
		card.getByText(/period ends|It ends on|Subscription management is not available/),
	).toHaveCount(0);
});

for (const mode of ["unavailable", "loading"] as const) {
	test(`${mode} billing never labels an unverified account Free and can recover`, async ({
		page,
	}) => {
		const { card } = await openPlan(page, mode);
		await expect(
			card.getByText(
				mode === "loading"
					? "Loading your plan…"
					: "We couldn’t load your plan. Refresh to try again.",
				{ exact: true },
			),
		).toBeVisible();
		await expect(card.getByText("Free", { exact: true })).toHaveCount(0);
		await expect(card.getByRole("button", { name: /^Upgrade\b/ })).toHaveCount(0);
		await page.evaluate(() => {
			document.documentElement.dataset.planReady = "true";
			document.dispatchEvent(new Event("release-plan"));
		});
		if (mode === "unavailable")
			await card.getByRole("button", { name: "Refresh plan", exact: true }).click();
		await expect(card.getByText("Free", { exact: true })).toBeVisible();
	});
}

test("a subscription needing attention opens its existing portal", async ({ page }) => {
	const { card } = await openPlan(page, "past_due");
	await expect(card.getByText(/Your subscription needs attention/)).toBeVisible();
	await card.getByRole("button", { name: "Manage subscription", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-billing-action", "portal");
	await expect(card.getByRole("button", { name: /^Upgrade\b/ })).toHaveCount(0);
});

test("portal errors keep management available for retry without exposing provider diagnostics", async ({
	page,
}) => {
	const { card } = await openPlan(page, "portal_failure");
	const manage = card.getByRole("button", { name: "Manage subscription", exact: true });
	await manage.click();
	await expect(card.getByRole("alert")).toContainText("We couldn’t connect to secure billing.");
	await expect(card.getByRole("alert")).not.toContainText("private provider diagnostic");
	await expect(manage).toBeEnabled();
	await manage.click();
	await expect(card.getByRole("alert")).toHaveCount(0);
});

test("a paid plan without a portal explains the limitation and offers refresh", async ({
	page,
}) => {
	const { card } = await openPlan(page, "paid_no_portal");
	await expect(
		card.getByText("Subscription management is not available yet. Try refreshing your plan."),
	).toBeVisible();
	await expect(
		card.getByRole("button", { name: "Manage subscription", exact: true }),
	).toHaveCount(0);
	await expect(card.getByRole("button", { name: "Refresh plan", exact: true })).toBeEnabled();
});
