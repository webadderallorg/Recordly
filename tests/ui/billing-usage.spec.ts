import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

declare global {
	interface Window {
		billingUsageTest: {
			state: {
				statusCalls: number;
				catalogCalls: number;
				holdStatus: boolean;
				recordingsAfterRelease: number;
				pendingStatus: ((value: unknown) => void)[];
			};
			releaseStatus: (recordings: number) => void;
			releaseCatalog: () => void;
			failStatus: () => void;
			releaseLegacy: () => void;
		};
	}
}

async function openUsage(
	page: Page,
	plan: "free" | "paid" | "complimentary" = "free",
	monthlyAmount = 900,
	paidPeriodDays = 1,
	cancelAtPeriodEnd = false,
) {
	await installDesktopBridge(page);
	await page.addInitScript(
		({ plan, monthlyAmount, paidPeriodDays, cancelAtPeriodEnd }) => {
			const prices = [
				{
					interval: "monthly",
					unitAmount: monthlyAmount,
					currency: "usd",
					...(monthlyAmount < 1500
						? { regularUnitAmount: 1500, promotion: "early_bird" }
						: {}),
				},
				{ interval: "yearly", unitAmount: 10800, currency: "usd" },
			];
			const status = (recordings: number) => ({
				success: true,
				billing: {
					plan: plan === "free" ? "free" : "pro",
					subscriptionStatus: plan === "free" ? null : "active",
					currentPeriodEnd:
						plan === "paid"
							? Math.floor(Date.now() / 1000) + 86400 * paidPeriodDays
							: null,
					cancelAtPeriodEnd,
					checkoutAvailable: plan === "free",
					checkoutIntervals: plan === "free" ? ["monthly", "yearly"] : [],
					portalAvailable: plan === "paid",
					prices,
				},
				usage: {
					recordings,
					recordingLimit: plan === "free" ? 5 : null,
					maxRecordingBytes: plan === "free" ? 1e9 : 1e10,
					storageBytes: recordings * 100,
					storageLimitBytes: plan === "free" ? 1e11 : null,
				},
			});
			const catalog = {
				success: true,
				prices,
				limits: {
					freeRecordingLimit: 5,
					freeMaxRecordingBytes: 1e9,
					plusMaxRecordingBytes: 1e10,
					storageLimitBytes: 1e11,
				},
			};
			const state = {
				statusCalls: 0,
				catalogCalls: 0,
				holdStatus: true,
				recordingsAfterRelease: 3,
				holdCatalog: true,
				pendingStatus: [] as ((value: unknown) => void)[],
				pendingCatalog: [] as (() => void)[],
			};
			Object.assign(window, {
				billingUsageTest: {
					state,
					releaseStatus: (recordings: number) => {
						state.holdStatus = false;
						for (const resolve of state.pendingStatus.splice(0))
							resolve(status(recordings));
					},
					releaseLegacy: () => {
						state.holdStatus = false;
						for (const resolve of state.pendingStatus.splice(0))
							resolve({ success: false, httpStatus: 404, error: "Not found" });
					},
					failStatus: () => {
						state.holdStatus = false;
						for (const resolve of state.pendingStatus.splice(0))
							resolve({ success: false, error: "Network unavailable" });
					},
					releaseCatalog: () => {
						state.holdCatalog = false;
						for (const resolve of state.pendingCatalog.splice(0)) resolve();
					},
				},
			});
			window.electronAPI.cloudBilling = async ({ action }) => {
				if (action === "checkout" || action === "portal") {
					document.documentElement.dataset.billingAction = action;
					return { success: true };
				}
				if (action === "catalog") {
					state.catalogCalls++;
					if (state.holdCatalog)
						await new Promise<void>((resolve) => state.pendingCatalog.push(resolve));
					return catalog;
				}
				state.statusCalls++;
				return state.holdStatus
					? ((await new Promise((resolve) =>
							state.pendingStatus.push(resolve),
						)) as ReturnType<typeof status>)
					: status(state.recordingsAfterRelease);
			};
			window.electronAPI.cloudBillingCancel = async () => ({ success: true });
			window.electronAPI.cloudShareManage = async () => ({
				success: true,
				videos: [
					{ code: "legacy-one", size: 100 },
					{ code: "legacy-two", size: 200 },
				],
			});
		},
		{ plan, monthlyAmount, paidPeriodDays, cancelAtPeriodEnd },
	);
	await page.goto("/tests/ui/billing-usage.html");
	await expect.poll(() => page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(1);
}

test("free usage shows the share-link count and progress", async ({ page }) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(0));
	const usage = page.getByLabel("Cloud usage", { exact: true });
	await expect(usage.getByText("0 of 5 share links used", { exact: true })).toBeVisible();
	await expect(usage.getByText("Cloud recordings", { exact: true })).toHaveCount(0);
	await expect(usage.getByText("5 recordings remaining", { exact: true })).toHaveCount(0);
	const progress = usage.getByRole("progressbar", { name: "Share links used" });
	await expect(progress).toHaveAttribute("aria-valuenow", "0");
	await expect(progress).toHaveAttribute("aria-valuemax", "5");
});

test("the export click opens the upgrade modal after 1.5 seconds and respects its cooldown", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(0);
		window.billingUsageTest.releaseCatalog();
	});
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	const startExport = page.getByRole("button", { name: "Start test export" });
	const pricing = page.getByRole("dialog", { name: "Recordly Plus", exact: true });
	const clockAt = Date.now();
	await page.clock.install({ time: clockAt });
	await page.clock.setFixedTime(clockAt);
	await page.clock.pauseAt(clockAt);
	await page.clock.setSystemTime(clockAt);
	await startExport.press("Enter");
	await page.clock.runFor(1_499);
	await expect(pricing).toHaveCount(0);
	await page.clock.runFor(1);
	await expect(pricing).toBeVisible();
	const firstShownAt = await page.evaluate(() => Date.now());
	await page.clock.resume();
	await pricing.getByRole("button", { name: "Close", exact: true }).click();
	await expect(pricing).toHaveCount(0);

	await page.clock.setFixedTime(firstShownAt + 119_999);
	await startExport.click();
	// Run the prompt timer while the wall clock is just before the cooldown expires.
	await page.clock.runFor(1_500);
	await expect(pricing).toHaveCount(0);

	const beforeExpiry = firstShownAt + 119_500;
	await page.clock.setFixedTime(beforeExpiry);
	await page.clock.pauseAt(beforeExpiry);
	await page.clock.setSystemTime(beforeExpiry);
	await startExport.press("Enter");
	// The attempt begins inside the cooldown and becomes eligible when the timer fires.
	await page.clock.runFor(1_500);
	await expect(pricing).toBeVisible();
});

test("export offers a commercial-use tip and Cloud upgrade without the old disclaimer", async ({
	page,
}) => {
	const notice = "Commercial use requires an active Recordly Plus subscription.";
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Plus" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText(notice, { exact: true })).toHaveCount(0);
	await expect(
		dialog.getByText("Use Recordly for commercial projects", { exact: true }),
	).toBeVisible();
	await page.goto("/tests/ui/export-resolution-presets.html?free");
	await expect(page.getByText(notice, { exact: true })).toHaveCount(0);
	await expect(
		page.getByRole("checkbox", { name: "I’ll use this for personal use.", exact: true }),
	).toHaveCount(0);
	await expect(page.getByText("Upgrade for commercial use", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByTestId("export-result")).toHaveText("1920 × 1080");
	await page.goto("/tests/ui/export-resolution-presets.html?free&captions");
	await page.getByRole("button", { name: "Upgrade", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Recordly Plus", exact: true })).toBeVisible();
});

test("regular pricing follows the catalog and hides ended promotions", async ({ page }) => {
	await openUsage(page, "free", 1500);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Plus" });
	await expect(dialog.locator(".pricing-price-offer")).toHaveText("$15 per month");
	await expect(dialog.locator(".split-upgrade-savings")).toHaveCount(0);
	await expect(dialog.locator(".pricing-regular-price")).toHaveCount(0);
	await expect(dialog.locator(".pricing-early-bird-label")).toHaveCount(0);
	await expect(dialog.locator(".pricing-price")).toContainText("$15");
	await expect(dialog.locator(".pricing-renewal")).toHaveCount(0);
	await expect(dialog.getByRole("button", { name: "Get Started", exact: true })).toBeEnabled();
});

for (const plan of ["paid", "complimentary"] as const) {
	test(`${plan} Cloud shows only applicable subscription controls`, async ({ page }) => {
		await openUsage(page, plan);
		await page.evaluate(() => {
			window.billingUsageTest.releaseStatus(2);
			window.billingUsageTest.releaseCatalog();
		});
		await expect(page.getByTestId("verified-plan")).toHaveText("pro");
		await expect(page.getByRole("button", { name: "Manage plan", exact: true })).toHaveCount(0);
		await expect(page.getByRole("button", { name: /^Upgrade\b/ })).toHaveCount(0);
		await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Plus", exact: true })).toBeVisible();
		await expect(page.locator(".pricing-price-offer")).toHaveCount(0);
		await expect(page.locator(".split-upgrade-savings")).toHaveCount(0);
		const portal = page.getByRole("button", { name: "Manage subscription", exact: true });
		if (plan === "paid") {
			await expect(portal).toBeEnabled();
			await expect(page.getByText(/Subscriptions renew automatically/)).toHaveCount(0);
			await expect(page.getByRole("radiogroup", { name: "Billing interval" })).toHaveCount(0);
		} else {
			await expect(portal).toHaveCount(0);
			await expect(page.getByText(/Subscriptions renew automatically/)).toHaveCount(0);
			await expect(page.getByRole("radiogroup", { name: "Billing interval" })).toHaveCount(0);
		}
	});
}

for (const plan of ["free", "paid"] as const) {
	test(`the Share button shows the verified recording quota for the ${plan} plan`, async ({
		page,
	}) => {
		await openUsage(page, plan);
		await page.evaluate(() => {
			window.billingUsageTest.state.recordingsAfterRelease = 0;
			window.billingUsageTest.releaseStatus(0);
			window.billingUsageTest.releaseCatalog();
		});
		await expect(page.getByTestId("verified-plan")).toHaveText(
			plan === "free" ? "free" : "pro",
		);
		await page.getByRole("button", { name: "Open test publish", exact: true }).click();
		if (plan === "free") {
			await expect(
				page.getByRole("button", { name: "Share (0/5)", exact: true }),
			).toBeVisible();
		} else {
			await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
			await expect(page.getByRole("button", { name: /^Share \(/ })).toHaveCount(0);
		}
	});
}

test("publishing refreshes the dashboard usage without requiring an app focus change", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
		window.electronAPI.onCloudShareProgress = () => () => undefined;
		window.electronAPI.cloudShareCancel = async () => ({ success: true });
		window.electronAPI.cloudShareUpload = async () => ({
			success: true,
			shareUrl: "https://example.test/s/new-recording",
		});
	});
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await page.getByRole("button", { name: "Open test publish", exact: true }).click();
	await page.getByRole("button", { name: "Share (2/5)", exact: true }).click();
	await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
		"https://example.test/s/new-recording",
	);
	await expect(page.getByText("3 of 5 share links used")).toBeVisible();
});

test("a library mutation during an in-flight usage read fetches a new snapshot afterward", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await page.evaluate(() => {
		window.billingUsageTest.state.holdStatus = true;
	});
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(2);
	await page.getByRole("button", { name: "Cloud library changed", exact: true }).click();
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await expect(page.getByText("3 of 5 share links used")).toBeVisible();
	expect(await page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(3);
});

test("usage displays before delayed pricing; focus events share pending requests and retain visible usage", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => {
		for (let i = 0; i < 6; i++) {
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
		}
	});
	expect(await page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(1);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	expect(await page.evaluate(() => window.billingUsageTest.state.catalogCalls)).toBe(1);
	await page.evaluate(() => {
		window.billingUsageTest.state.holdStatus = true;
	});
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await page.evaluate(() => {
		window.dispatchEvent(new Event("focus"));
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(await page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(2);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(4));
	await expect(page.getByText("4 of 5 share links used")).toBeVisible();
	await page.evaluate(() => window.billingUsageTest.releaseCatalog());
});

test("fresh usage and pricing survive repeated focus events without more cloud reads", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	for (let i = 0; i < 3; i++) {
		await page.evaluate(async () => {
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		await expect(page.getByTestId("usage-loading")).toHaveText("false");
	}
	expect(await page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(1);
	expect(await page.evaluate(() => window.billingUsageTest.state.catalogCalls)).toBe(1);
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(2);
	await expect
		.poll(() => page.evaluate(() => window.billingUsageTest.state.catalogCalls))
		.toBe(2);
});

test("opening pricing uses preloaded results without waiting on new billing reads", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	await expect(page.getByRole("button", { name: /40% off/ })).toBeVisible();
	await page.evaluate(() => {
		window.billingUsageTest.state.holdStatus = true;
	});
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Plus" });
	await expect(dialog.getByRole("button", { name: "Get Started", exact: true })).toBeEnabled();
	await expect(dialog.getByText("Loading pricing…", { exact: true })).toHaveCount(0);
	expect(await page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(1);
	expect(await page.evaluate(() => window.billingUsageTest.state.catalogCalls)).toBe(1);
});

test("an account change hides cached usage and rejects the old account's late response", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await page.evaluate(() => {
		window.billingUsageTest.state.holdStatus = true;
	});
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await page.route("https://auth.recordly.test/auth/v1/user", (route) =>
		route.fulfill({
			json: {
				id: "second-account",
				email: "second@example.test",
				aud: "authenticated",
				role: "authenticated",
				app_metadata: {},
				user_metadata: {},
				created_at: "2026-10-16T00:00:00Z",
			},
		}),
	);
	await page.getByRole("button", { name: "Switch account", exact: true }).click();
	await expect(page.getByTestId("usage-owner")).toHaveText("second-account");
	await expect(page.getByText("2 of 5 share links used")).toHaveCount(0);
	await expect(page.getByText("Loading usage…")).toBeVisible();
	await page.evaluate(() => {
		const state = window.billingUsageTest.state;
		const old = state.pendingStatus.shift();
		old?.({ success: true, billing: { plan: "pro" } });
	});
	await expect(page.getByText("Loading usage…")).toBeVisible();
	await page.evaluate(() => window.billingUsageTest.releaseStatus(1));
	await expect(page.getByText("1 of 5 share links used")).toBeVisible();
	await expect(page.getByText("Cloud storage")).toHaveCount(0);
});

async function usageCacheKey(page: Page) {
	const endpoint = await page.getByTestId("usage-endpoint").textContent();
	const user = await page.getByTestId("usage-owner").textContent();
	return `recordly:cloud-usage:v1:${encodeURIComponent(endpoint ?? "")}:${encodeURIComponent(user ?? "")}`;
}

test("a second renderer session shows saved usage before internet responds and then saves the correction", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	const key = await usageCacheKey(page);
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull();
	await page.reload();
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await expect(page.getByText("Loading usage…")).toHaveCount(0);
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
	await expect(page.getByTestId("verified-checkout")).toHaveText("false");
	await page.evaluate(() => window.billingUsageTest.releaseStatus(4));
	await expect(page.getByText("4 of 5 share links used")).toBeVisible();
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
	await page.reload();
	await expect(page.getByText("4 of 5 share links used")).toBeVisible();
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
});

test("an offline renderer keeps the last saved usage without granting billing access", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await page.reload();
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await page.evaluate(() => window.billingUsageTest.failStatus());
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
	await expect(page.getByTestId("verified-checkout")).toHaveText("false");
});

test("editing a saved Cloud preview cannot authorize Cloud and the server replaces it", async ({
	page,
}) => {
	await openUsage(page);
	const key = await usageCacheKey(page);
	await page.evaluate(
		(key) =>
			localStorage.setItem(
				key,
				JSON.stringify({
					version: 1,
					updatedAt: Date.now(),
					plan: "pro",
					usage: {
						recordings: 10,
						recordingLimit: null,
						maxRecordingBytes: 1e10,
						storageBytes: 1000,
						storageLimitBytes: 1e11,
					},
				}),
			),
		key,
	);
	await page.reload();
	await expect(page.getByTestId("usage-owner")).not.toHaveText("signed-out");
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
	await expect(page.getByTestId("verified-checkout")).toHaveText("false");
	await page.evaluate(() => window.billingUsageTest.releaseStatus(1));
	await expect(page.getByText("1 of 5 share links used")).toBeVisible();
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
	await expect(page.getByText("Cloud storage")).toHaveCount(0);
});

test("invalid saved usage is ignored while the account read is pending", async ({ page }) => {
	await openUsage(page);
	const key = await usageCacheKey(page);
	await page.evaluate(
		(key) =>
			localStorage.setItem(
				key,
				JSON.stringify({
					version: 1,
					updatedAt: Date.now(),
					plan: "free",
					usage: {
						recordings: -1,
						recordingLimit: 5,
						maxRecordingBytes: 1e9,
						storageBytes: 0,
						storageLimitBytes: 1e11,
					},
				}),
			),
		key,
	);
	await page.reload();
	await expect(page.getByText("Loading usage…")).toBeVisible();
	await expect(page.getByText(/of 5 share links used/)).toHaveCount(0);
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
	await page.evaluate(() => window.billingUsageTest.releaseStatus(3));
	await expect(page.getByText("3 of 5 share links used")).toBeVisible();
});

test("legacy billing fallback also saves usage for the next renderer session", async ({ page }) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseLegacy());
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
	const key = await usageCacheKey(page);
	await expect
		.poll(() =>
			page.evaluate((key) => {
				const raw = localStorage.getItem(key);
				return raw ? JSON.parse(raw).usage.recordings : null;
			}, key),
		)
		.toBe(2);
	await page.reload();
	await expect(page.getByText("2 of 5 share links used")).toBeVisible();
	await expect(page.getByText("Loading usage…")).toHaveCount(0);
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
	await expect(page.getByTestId("verified-checkout")).toHaveText("false");
});

test("Cloud displays unlimited storage without a capacity bar", async ({ page }) => {
	await openUsage(page, "paid");
	await page.evaluate(() => window.billingUsageTest.releaseStatus(8));
	await expect(page.getByText("Cloud storage", { exact: true })).toBeVisible();
	await expect(page.getByText(/used · Unlimited storage/)).toBeVisible();
	await expect(page.getByRole("progressbar", { name: "Cloud storage used" })).toHaveCount(0);
});

test("changed offer amounts update price, renewal copy and promotion percentage", async ({
	page,
}) => {
	await openUsage(page, "free", 1200);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Plus" });
	await expect(dialog.locator(".pricing-price")).toHaveText("$12");
	await expect(dialog.locator("s.pricing-regular-price")).toHaveText("$15");
	await expect(dialog.locator(".split-upgrade-savings")).toHaveText(
		"20% off with early bird pricing",
	);
	await expect(dialog.locator(".pricing-renewal")).toHaveCount(0);
});

test("pending catalog does not advertise a fabricated price or promotion", async ({ page }) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Plus" });
	await expect(dialog.locator(".pricing-price")).toHaveCount(0);
	await expect(dialog.locator(".split-upgrade-savings")).toHaveCount(0);
	await expect(dialog.locator(".pricing-renewal")).toHaveCount(0);
	const checkout = dialog.getByRole("button", { name: "Get Started", exact: true });
	await expect(checkout).toBeDisabled();
	const loading = dialog.getByRole("status").filter({ hasText: "Loading pricing…" });
	await expect(loading).toBeVisible();
	await page.evaluate(() => window.billingUsageTest.releaseCatalog());
	await expect(loading).toHaveCount(0);
	await expect(checkout).toBeEnabled();
});

test("checkout return stays Free until confirmed, then enables subscription management", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
		const read = window.electronAPI.cloudBilling;
		const state = { actions: [] as string[], paid: false, cancelAtPeriodEnd: false };
		Object.assign(window, { billingFlowTest: state });
		window.electronAPI.cloudBilling = async (input) => {
			if (input.action === "checkout" || input.action === "portal") {
				state.actions.push(input.action);
				return { success: true };
			}
			const result = await read(input);
			if (input.action === "status" && state.paid && result.billing && result.usage) {
				return {
					...result,
					billing: {
						...result.billing,
						plan: "pro",
						subscriptionStatus: "active",
						currentPeriodEnd: Math.floor(Date.now() / 1000) + 86400,
						cancelAtPeriodEnd: state.cancelAtPeriodEnd,
						checkoutAvailable: false,
						checkoutIntervals: [],
						portalAvailable: true,
					},
					usage: {
						...result.usage,
						recordingLimit: null,
						storageLimitBytes: null,
						maxRecordingBytes: 1e10,
					},
				};
			}
			return result;
		};
	});
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog");
	for (const name of ["Visa / Mastercard", "Apple Pay", "Google Pay", "Link"]) {
		const icon = dialog.getByRole("img", { name, exact: true });
		await expect(icon).toBeVisible();
		await expect
			.poll(() => icon.evaluate((node: HTMLImageElement) => node.naturalWidth))
			.toBeGreaterThan(0);
	}
	await dialog.getByRole("button", { name: "Get Started", exact: true }).click();
	await expect(
		dialog.getByText(
			"Complete checkout in your browser, then return here. Your plan will update after payment is confirmed.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
	await expect(
		dialog.getByRole("button", { name: "Manage subscription", exact: true }),
	).toHaveCount(0);
	await page.evaluate(() => {
		(window as Window & { billingFlowTest: { paid: boolean } }).billingFlowTest.paid = true;
	});
	await dialog.getByRole("button", { name: "Check payment status", exact: true }).click();
	await expect(page.getByTestId("verified-plan")).toHaveText("pro");
	await expect(dialog.getByText(/Your Plus plan is active/)).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Get Started", exact: true })).toHaveCount(0);
	await dialog.getByRole("button", { name: "Manage subscription", exact: true }).click();
	expect(
		await page.evaluate(
			() =>
				(window as Window & { billingFlowTest: { actions: string[] } }).billingFlowTest
					.actions,
		),
	).toEqual(["checkout", "portal"]);
	await page.evaluate(() => {
		(
			window as Window & { billingFlowTest: { cancelAtPeriodEnd: boolean } }
		).billingFlowTest.cancelAtPeriodEnd = true;
	});
	await dialog.getByRole("button", { name: "Manage subscription", exact: true }).click();
	await expect(dialog.getByText(/It ends on/)).toBeVisible();
	await expect(page.getByTestId("verified-plan")).toHaveText("pro");
});

test("a failed checkout preserves Free and offers retry without claiming payment success", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
		const read = window.electronAPI.cloudBilling;
		window.electronAPI.cloudBilling = async (input) =>
			input.action === "checkout"
				? { success: false, error: "Checkout could not open. Please retry." }
				: read(input);
	});
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Get Started", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("connect to secure billing");
	let reports = 0;
	await page.route("**/functions/v1/submit-export-error", async (route) => {
		reports++;
		expect(route.request().postDataJSON().context).toBe("billing");
		await route.fulfill({
			status: reports === 1 ? 503 : 200,
			json: reports === 1 ? { success: false } : { success: true },
		});
	});
	const report = dialog.getByRole("button", { name: "Report Error", exact: true });
	await expect(report).toHaveCSS("text-decoration-line", "underline");
	await expect(report).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await expect(report).toHaveCSS("border-top-width", "0px");
	await expect(report).toHaveCSS("padding-top", "0px");
	await report.click();
	await expect(dialog.getByRole("button", { name: "Report sent", exact: true })).toHaveCount(0);
	await dialog.getByRole("button", { name: "Retry report", exact: true }).click();
	await expect(dialog.getByRole("button", { name: "Report sent", exact: true })).toBeDisabled();
	expect(reports).toBe(2);
	await expect(dialog.getByRole("button", { name: "Get Started", exact: true })).toBeEnabled();
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
	await expect(dialog.getByText(/Complete checkout in your browser/)).toHaveCount(0);
	await page.evaluate(() => {
		const read = window.electronAPI.cloudBilling;
		window.electronAPI.cloudBilling = async (input) =>
			input.action === "checkout" ? { success: true } : read(input);
	});
	await dialog.getByRole("button", { name: "Get Started", exact: true }).click();
	await expect(dialog.getByText(/Complete checkout in your browser/)).toBeVisible();
	await expect(dialog.getByRole("alert")).toHaveCount(0);
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
});

test("unavailable checkout offers a pricing refresh without starting payment", async ({ page }) => {
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
		const read = window.electronAPI.cloudBilling;
		window.electronAPI.cloudBilling = async (input) => {
			const result = await read(input);
			return input.action === "status" && result.billing
				? {
						...result,
						billing: {
							...result.billing,
							checkoutAvailable: false,
							checkoutIntervals: [],
						},
					}
				: result;
		};
	});
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Plus" });
	const retry = dialog.getByRole("button", { name: "Retry loading pricing" });
	await expect(retry).toBeEnabled();
	await expect(dialog.getByRole("button", { name: "Get Started" })).toHaveCount(0);
	await expect(page.getByTestId("verified-checkout")).toHaveText("false");
	await expect(page.locator("html")).not.toHaveAttribute("data-billing-action");
	const statusCalls = await page.evaluate(() => window.billingUsageTest.state.statusCalls);
	await retry.click();
	await expect
		.poll(() => page.evaluate(() => window.billingUsageTest.state.statusCalls))
		.toBeGreaterThan(statusCalls);
	await expect(retry).toBeEnabled();
	await expect(page.locator("html")).not.toHaveAttribute("data-billing-action");
});

for (const subscription of [
	{ label: "legacy annual", periodDays: 365, cancelAtPeriodEnd: true },
	{ label: "legacy monthly", periodDays: 30, cancelAtPeriodEnd: false },
]) {
	test(`${subscription.label} subscribers manage their plan without being shown the new monthly offer as their price`, async ({
		page,
	}) => {
		await openUsage(page, "paid", 900, subscription.periodDays, subscription.cancelAtPeriodEnd);
		await page.evaluate(() => {
			window.billingUsageTest.releaseStatus(2);
			window.billingUsageTest.releaseCatalog();
		});
		await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Recordly Plus", exact: true });
		await expect(
			dialog.getByText("Your Plus plan is active.", { exact: false }),
		).toBeVisible();
		await expect(dialog.locator(".pricing-price-offer")).toHaveCount(0);
		await expect(dialog.locator(".split-upgrade-savings")).toHaveCount(0);
		await expect(dialog.getByText(/USD \/ month/)).toHaveCount(0);
		if (subscription.cancelAtPeriodEnd) {
			await expect(dialog.getByText(/It ends on/)).toBeVisible();
		} else {
			await expect(dialog.getByText(/It ends on/)).toHaveCount(0);
		}
		await dialog
			.getByRole("button", { name: "Manage subscription", exact: true })
			.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: test.info().outputPath("existing-subscription.png"),
			animations: "disabled",
		});
		await dialog.getByRole("button", { name: "Manage subscription", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-billing-action", "portal");
	});
}
