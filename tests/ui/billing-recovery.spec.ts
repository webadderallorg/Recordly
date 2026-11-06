import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function prepare(
	page: Parameters<typeof installDesktopBridge>[0],
	mode:
		| "recover"
		| "unauthorized"
		| "unavailable"
		| "past_due"
		| "unpaid"
		| "held"
		| "canceled"
		| "action_failure"
		| "portal_failure"
		| "catalog_failure"
		| "price_mismatch"
		| "slow_catalog"
		| "paid_no_portal"
		| "checkout_needs_attention",
) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		({ mode }) => {
			let calls = 0;
			const prices = [{ interval: "monthly", unitAmount: 900, currency: "usd" }];
			window.electronAPI.cloudBilling = async ({ action }) => {
				if (action === "catalog") {
					if (
						mode === "catalog_failure" &&
						document.documentElement.dataset.recovered !== "true"
					)
						return { success: false, error: "catalog provider diagnostic" };
					if (
						mode === "slow_catalog" &&
						document.documentElement.dataset.recovered !== "true"
					)
						await new Promise((resolve) =>
							document.addEventListener("release-pricing-catalog", resolve, {
								once: true,
							}),
						);
					return {
						success: true,
						prices,
						limits: {
							freeRecordingLimit: 5,
							freeMaxRecordingBytes: 1e9,
							plusMaxRecordingBytes: 1e10,
							storageLimitBytes: 1e11,
						},
					};
				}
				if (action === "status") {
					calls++;
					document.documentElement.dataset.billingStatusCalls = String(calls);
					if (mode === "unauthorized" || (mode === "recover" && calls === 1))
						return {
							success: false,
							httpStatus: 401,
							error: "Sign in again to manage your cloud plan.",
						};
					const needsAttention =
						mode === "checkout_needs_attention" &&
						document.documentElement.dataset.billingAction === "checkout";
					return {
						success: true,
						billing: {
							plan: mode === "paid_no_portal" ? "pro" : "free",
							subscriptionStatus:
								mode === "paid_no_portal"
									? "active"
									: [
												"past_due",
												"unpaid",
												"held",
												"canceled",
												"portal_failure",
											].includes(mode)
										? mode === "held" || mode === "portal_failure"
											? "active"
											: mode
										: null,
							currentPeriodEnd:
								mode === "paid_no_portal"
									? Math.floor(Date.now() / 1000) + 86400
									: null,
							cancelAtPeriodEnd: false,
							checkoutAvailable:
								![
									"unavailable",
									"past_due",
									"unpaid",
									"held",
									"portal_failure",
								].includes(mode) ||
								document.documentElement.dataset.recovered === "true",
							checkoutIntervals:
								![
									"unavailable",
									"past_due",
									"unpaid",
									"held",
									"portal_failure",
								].includes(mode) ||
								document.documentElement.dataset.recovered === "true"
									? ["monthly"]
									: [],
							portalAvailable: [
								"past_due",
								"unpaid",
								"held",
								"canceled",
								"portal_failure",
							].includes(mode),
							prices:
								mode === "price_mismatch" &&
								document.documentElement.dataset.recovered !== "true"
									? [{ ...prices[0], unitAmount: 1500 }]
									: prices,
							...(needsAttention
								? {
										subscriptionStatus: "past_due",
										checkoutAvailable: false,
										checkoutIntervals: [],
										portalAvailable: true,
									}
								: {}),
						},
						usage: {
							recordings: 0,
							recordingLimit: mode === "paid_no_portal" ? null : 5,
							maxRecordingBytes: 1e9,
							storageBytes: 0,
							storageLimitBytes: 1e11,
						},
					};
				}
				document.documentElement.dataset.billingAction = action;
				document.documentElement.dataset.billingActionCount = String(
					Number(document.documentElement.dataset.billingActionCount ?? 0) + 1,
				);
				if (mode === "action_failure" || mode === "portal_failure")
					return { success: false, error: "provider diagnostic must not appear" };
				return { success: true };
			};
		},
		{ mode },
	);
	await page.goto("/tests/ui/billing-usage.html");
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	return page.getByRole("dialog", { name: "Recordly Cloud", exact: true });
}

test("billing recovers a rejected session without showing background errors", async ({ page }) => {
	const dialog = await prepare(page, "recover");
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toBeEnabled();
	await expect
		.poll(() => page.locator("html").getAttribute("data-billing-status-calls"))
		.not.toBe("1");
	await expect(dialog.getByText("Sign in again to manage your cloud plan.")).toHaveCount(0);
	await expect(dialog.getByText("Cloud checkout is not available yet.")).toHaveCount(0);
	await expect(dialog.locator(".pricing-error")).toHaveCount(0);
});

test("unverified checkout can refresh without exposing diagnostics or opening billing", async ({
	page,
}) => {
	const dialog = await prepare(page, "unavailable");
	const refresh = dialog.getByRole("button", { name: "Get started", exact: true });
	await expect(refresh).toBeEnabled();
	await expect(dialog.getByText(/We couldn’t load your billing options/)).toHaveCount(0);
	await refresh.click();
	await expect(page.locator("html")).not.toHaveAttribute("data-billing-action");
	await page.evaluate(() => {
		document.documentElement.dataset.recovered = "true";
	});
	await refresh.click();
	await expect(page.getByTestId("verified-checkout")).toHaveText("true");
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toBeEnabled();
	await expect(dialog.getByText("Cloud checkout is not available yet.")).toHaveCount(0);
	await page.screenshot({
		path: test.info().outputPath("pricing-recovered.png"),
		animations: "disabled",
	});
});

test("persistent authorization failures offer sign-in without error banners", async ({ page }) => {
	const dialog = await prepare(page, "unauthorized");
	await expect(
		dialog.getByRole("button", { name: "Sign in to continue", exact: true }),
	).toBeEnabled();
	await expect(dialog.locator(".pricing-error")).toHaveCount(0);
	await expect(dialog.getByText("Cloud checkout is not available yet.")).toHaveCount(0);
	await dialog.getByRole("button", { name: "Sign in to continue", exact: true }).click();
	await expect(dialog).not.toBeVisible();
});

for (const mode of ["past_due", "unpaid", "held"] as const) {
	test(`${mode} subscriptions retain portal access after paid entitlement is lost`, async ({
		page,
	}) => {
		const dialog = await prepare(page, mode);
		await expect(dialog.locator(".pricing-price-offer")).toHaveCount(0);
		await expect(dialog.locator(".pricing-heading-offer")).toHaveCount(0);
		await dialog.getByRole("button", { name: "Manage subscription", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-billing-action", "portal");
		await expect(dialog.getByText(/Your subscription needs attention/)).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toHaveCount(
			0,
		);
	});
}

test("canceled customers can resubscribe without duplicate billing management", async ({
	page,
}) => {
	const dialog = await prepare(page, "canceled");
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toBeEnabled();
	await expect(dialog.getByRole("button", { name: "Manage previous subscription", exact: true })).toHaveCount(0);
	await dialog.getByRole("button", { name: "Get started", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-billing-action", "checkout");
});

test("checkout failures show safe feedback and keep retry available", async ({ page }) => {
	const dialog = await prepare(page, "action_failure");
	await dialog.getByRole("button", { name: "Get started", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("We couldn’t connect to secure billing");
	await expect(dialog.getByText("provider diagnostic must not appear")).toHaveCount(0);
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toBeEnabled();
	await expect(dialog.locator(".pricing-renewal")).toHaveCount(0);
	await expect(dialog.getByRole("navigation", { name: "Legal and support" })).toHaveCount(0);
	await expect(dialog.locator(".pricing-legal-consent")).toHaveCount(0);
});

test("portal failures keep subscription management available with safe retry feedback", async ({
	page,
}) => {
	const dialog = await prepare(page, "portal_failure");
	await dialog.getByRole("button", { name: "Manage subscription", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-billing-action", "portal");
	await expect(dialog.getByRole("alert")).toContainText("We couldn’t connect to secure billing");
	await expect(dialog.getByText("provider diagnostic must not appear")).toHaveCount(0);
	await expect(
		dialog.getByRole("button", { name: "Manage subscription", exact: true }),
	).toBeEnabled();
});

for (const mode of ["catalog_failure", "price_mismatch"] as const) {
	test(`${mode} blocks checkout until verified pricing recovers`, async ({ page }) => {
		const dialog = await prepare(page, mode);
		const retry = dialog.getByRole("button", { name: "Get started", exact: true });
		await expect(retry).toBeEnabled();
		await retry.click();
		await expect(page.locator("html")).not.toHaveAttribute("data-billing-action");
		await expect(dialog.getByText("catalog provider diagnostic", { exact: true })).toHaveCount(
			0,
		);
		await expect(page.locator("html")).not.toHaveAttribute("data-billing-action");
		await page.evaluate(() => {
			document.documentElement.dataset.recovered = "true";
		});
		await retry.click();
		await expect(dialog.locator(".pricing-price")).toContainText("$9");
		await expect(retry).toBeEnabled();
		await retry.click();
		await expect(page.locator("html")).toHaveAttribute("data-billing-action", "checkout");
	});
}

test("a slow catalog shows disabled loading instead of an unavailable or checkout action", async ({
	page,
}) => {
	const dialog = await prepare(page, "slow_catalog");
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toBeDisabled();
	await expect(dialog.getByText(/We couldn’t load your billing options/)).toHaveCount(0);
	await page.evaluate(() => {
		document.documentElement.dataset.recovered = "true";
		document.dispatchEvent(new Event("release-pricing-catalog"));
	});
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toBeEnabled();
});

test("returning from checkout checks payment without creating another checkout", async ({
	page,
}) => {
	const dialog = await prepare(page, "recover");
	await dialog.getByRole("button", { name: "Get started", exact: true }).click();
	const check = dialog.getByRole("button", { name: "Check payment status", exact: true });
	await expect(check).toBeEnabled();
	await expect(dialog.getByText(/Complete checkout in your browser/)).toBeVisible();
	await check.click();
	await expect(check).toBeEnabled();
	await expect(page.locator("html")).toHaveAttribute("data-billing-action-count", "1");
	await dialog.getByRole("button", { name: "Return to checkout", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-billing-action-count", "2");
});

test("an existing paid customer cannot start a second subscription when the portal is unavailable", async ({
	page,
}) => {
	const dialog = await prepare(page, "paid_no_portal");
	await expect(
		dialog.getByRole("button", { name: "Manage subscription", exact: true }),
	).toBeEnabled();
	await expect(dialog.getByText(/Your Cloud plan is active/)).toBeVisible();
	await expect(dialog.locator(".pricing-price-offer")).toHaveCount(0);
	await expect(dialog.locator(".pricing-heading-offer")).toHaveCount(0);
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toHaveCount(0);
	await dialog.getByRole("button", { name: "Manage subscription", exact: true }).click();
	await expect(page.locator("html")).not.toHaveAttribute("data-billing-action");
});

test("a subscription needing attention after checkout retains management access", async ({
	page,
}) => {
	const dialog = await prepare(page, "checkout_needs_attention");
	await dialog.getByRole("button", { name: "Get started", exact: true }).click();
	const manage = dialog.getByRole("button", { name: "Manage subscription", exact: true });
	await expect(manage).toBeEnabled();
	await expect(
		dialog.getByRole("button", { name: "Check payment status", exact: true }),
	).toHaveCount(0);
	await manage.click();
	await expect(page.locator("html")).toHaveAttribute("data-billing-action", "portal");
});
