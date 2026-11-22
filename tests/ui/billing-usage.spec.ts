import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

declare global {
	interface Window {
		billingUsageTest: {
			state: {
				statusCalls: number;
				catalogCalls: number;
				holdStatus: boolean;
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
					: status(3);
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
	// Keep regression coverage of the original design retained as a fallback.
	await page.goto("/tests/ui/billing-usage.html?upgradeModal=classic");
	await expect.poll(() => page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(1);
}

test("export offers a commercial-use tip and Cloud upgrade without the old disclaimer", async ({
	page,
}) => {
	const notice = "Commercial use requires an active Recordly Cloud subscription.";
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Cloud" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText(notice, { exact: true })).toHaveCount(0);
	await expect(dialog.getByText("Commercial use included", { exact: true })).toBeVisible();
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
	await expect(page.getByRole("dialog", { name: "Recordly Cloud", exact: true })).toBeVisible();
});

for (const viewport of [
	{ width: 1440, height: 1000 },
	{ width: 390, height: 844 },
]) {
	test(`upgrade benefits are browsable at ${viewport.width}px`, async ({ page }) => {
		await page.setViewportSize(viewport);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await openUsage(page);
		await page.evaluate(() => {
			window.billingUsageTest.releaseStatus(2);
			window.billingUsageTest.releaseCatalog();
		});
		await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Recordly Cloud" });
		await expect(dialog.locator(".pricing-heading-offer")).toContainText("40% OFF");
		await expect(dialog.locator(".pricing-heading-offer")).toHaveCSS("transform", "none");
		await expect(
			dialog.getByRole("heading", { name: "Commercial use included" }),
		).toBeVisible();
		await expect(dialog.locator(".upgrade-modal-head .plus-badge")).toHaveCount(0);
		await expect(
			dialog.getByText("Commercial Use, Shareable Links, Cloud Storage and More."),
		).toBeVisible();
		const benefits = dialog.getByRole("region", { name: "Cloud benefits", exact: true });
		await expect(benefits.getByRole("heading")).toHaveText([
			"Commercial use included",
			"SRT and VTT caption-file exports",
			"Share without limits",
			"Keep your links alive",
		]);
		await expect(dialog.getByRole("radiogroup", { name: "Billing interval" })).toHaveCount(0);
		await expect(dialog.locator(".pricing-price")).toHaveText("$9 USD / month");
		await expect(dialog.locator(".pricing-period")).toHaveCount(0);
		await expect(dialog.getByText("More features to come...", { exact: true })).toBeVisible();
		const features = dialog.getByRole("region", { name: "Cloud benefits and pricing" });
		await expect(
			features.getByText("Commercial use requires an active Recordly Cloud subscription.", {
				exact: true,
			}),
		).toHaveCount(0);
		await expect(dialog.getByText(/4K/)).toHaveCount(0);
		await expect(features.locator(".plus-badge")).toHaveText("CLOUD");
		await expect(dialog.locator(".pricing-regular-price del")).toHaveText("$15");
		await expect(
			dialog.getByText("Save 40% with early bird pricing", { exact: true }),
		).toHaveCount(0);
		await expect(features.locator(".pricing-price-banner")).toHaveText("EARLY BIRD 40% OFF");
		await expect(features.locator(".pricing-early-bird-label")).toHaveCount(0);
		await expect(dialog.locator(".pricing-heading-offer")).toHaveText("EARLY BIRD 40% OFF");
		await expect(dialog.locator(".pricing-heading-offer")).toHaveCSS("font-family", /DM Sans/);
		expect(
			await page.evaluate(async () => {
				await document.fonts.ready;
				return Array.from(document.fonts).some(
					(font) => font.family === "DM Sans" && font.status === "loaded",
				);
			}),
		).toBe(true);
		expect(
			await features.evaluate((section) => {
				const badge = section.querySelector(".plus-plan-badges")!;
				const price = section.querySelector(".plus-plan-pricing")!;
				const action = section.querySelector(".plus-plan-action")!;
				const list = section.querySelector(".plus-feature-group")!;
				const feature = section.querySelector("li")!;
				const icon = feature.querySelector("svg")!;
				const currentPrice = section.querySelector(".pricing-price")!;
				return (
					badge.nextElementSibling === price &&
					price.nextElementSibling === action &&
					action.nextElementSibling === list &&
					getComputedStyle(currentPrice).color === getComputedStyle(feature).color &&
					getComputedStyle(icon).color === getComputedStyle(feature).color
				);
			}),
		).toBe(true);
		await expect(
			features.getByRole("list", { name: "Your Cloud benefits" }).locator("li"),
		).toHaveCount(8);
		await expect(features.getByRole("list")).toHaveCount(1);
		await expect(dialog.getByText(/Renews automatically until cancelled/)).toHaveCount(0);
		await expect(features.getByRole("heading")).toHaveCount(0);
		await expect(benefits.getByRole("heading", { name: "Share without limits" })).toHaveCount(
			1,
		);
		await expect(
			benefits.getByRole("heading", { name: "Support solo development" }),
		).toHaveCount(0);
		expect(
			await benefits
				.locator("article")
				.first()
				.evaluate((element) => element.getBoundingClientRect().width),
		).toBe(240);
		await expect(
			dialog.getByText("Unlimited cloud storage and bandwidth", { exact: true }),
		).toHaveCount(1);
		await expect(
			dialog.getByText("Upload recordings up to 10 GB each", { exact: true }),
		).toHaveCount(1);
		await page.screenshot({ path: test.info().outputPath("upgrade-features.png") });
		await dialog.getByRole("button", { name: "Next benefits" }).click();
		await expect
			.poll(() => benefits.evaluate((element) => element.scrollLeft))
			.toBeGreaterThan(0);
		await expect(
			dialog.getByRole("button", { name: "Get started", exact: true }),
		).toBeEnabled();
		await dialog
			.getByRole("button", { name: "Get started", exact: true })
			.scrollIntoViewIfNeeded();
		await features.scrollIntoViewIfNeeded();
		await page.screenshot({ path: test.info().outputPath("upgrade-plan-features.png") });
	});

	test(`bento community posts are browsable at ${viewport.width}px`, async ({ page }) => {
		await page.setViewportSize(viewport);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await openUsage(page);
		await page.evaluate(() => {
			window.billingUsageTest.releaseStatus(2);
			window.billingUsageTest.releaseCatalog();
		});
		await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Recordly Cloud" });
		const posts = dialog.getByRole("region", { name: "Community testimonials" });
		await expect(dialog.locator(".pricing-legal-consent")).toHaveCount(0);
		await expect(dialog.getByText(/By continuing, you agree/)).toHaveCount(0);
		await posts.scrollIntoViewIfNeeded();
		await expect(posts.getByText("Excerpt", { exact: false })).toHaveCount(0);
		await expect(posts.locator("figure").filter({ visible: true })).toHaveCount(9);
		const redditPosts = posts.locator(
			'.testimonial-group:not(.testimonial-duplicates) figure[data-platform="Reddit"]',
		);
		await expect(redditPosts).toHaveCount(6);
		for (const card of await redditPosts.all()) {
			await expect(card.locator(".testimonial-avatar img")).toHaveAttribute(
				"src",
				/^https:\/\//,
			);
			await expect(card.locator(".testimonial-author a")).toHaveCount(0);
		}
		const cardSizes = await posts
			.locator(".testimonial-group:not(.testimonial-duplicates) figure")
			.evaluateAll((cards) =>
				cards.map((card) => ({
					height: card.getBoundingClientRect().height,
					width: card.getBoundingClientRect().width,
					fits: card.scrollHeight <= card.clientHeight,
				})),
			);
		expect(new Set(cardSizes.map((card) => card.height)).size).toBeGreaterThan(3);
		expect(
			Math.max(...cardSizes.map((card) => card.width)) -
				Math.min(...cardSizes.map((card) => card.width)),
		).toBeLessThan(1);
		await expect(dialog.locator(".upgrade-testimonials")).toHaveCSS("border-top-width", "0px");
		expect(cardSizes.every((card) => card.fits)).toBe(true);
		for (const author of ["d3mueller", "MaterialWooden9544", "Ihtesham Ali"]) {
			await expect(posts.locator("figure").filter({ hasText: author })).toHaveCount(0);
		}
		await expect(posts.locator(".testimonial-column")).toHaveCount(3);
		const xPosts = posts.locator(
			'.testimonial-group:not(.testimonial-duplicates) figure[data-platform="X"]',
		);
		await expect(xPosts).toHaveCount(3);
		const likeCounts = await xPosts
			.locator(".testimonial-post-engagement > span:first-child")
			.evaluateAll((elements) =>
				elements.map((element) =>
					Number(element.getAttribute("aria-label")?.split(" ")[0].replace(/,/g, "")),
				),
			);
		expect(likeCounts.every((count) => count > 500)).toBe(true);
		await expect(xPosts.getByLabel("4,695 likes", { exact: true })).toHaveText("4,695 likes");
		const popularPost = posts
			.locator(".testimonial-group:not(.testimonial-duplicates) figure")
			.filter({ hasText: "Peter Agboola" })
			.first();
		await expect(popularPost.getByLabel("4,695 likes", { exact: true })).toHaveText(
			"4,695 likes",
		);
		expect(
			await popularPost.evaluate((card) => {
				const engagement = card
					.querySelector(".testimonial-post-engagement")!
					.getBoundingClientRect();
				const quote = card.querySelector("blockquote")!.getBoundingClientRect();
				const bounds = card.getBoundingClientRect();
				return engagement.top >= quote.bottom && engagement.bottom <= bounds.bottom;
			}),
		).toBe(true);
		await expect(
			posts
				.locator(".testimonial-column")
				.first()
				.locator(".testimonial-group:not(.testimonial-duplicates) figure")
				.first(),
		).toContainText("Peter Agboola");
		await expect(posts.locator("a")).toHaveCount(0);
		await expect(popularPost.locator("time")).toHaveAttribute(
			"datetime",
			"2026-09-06T21:05:38.000Z",
		);
		await expect(dialog.getByRole("button", { name: /testimonial scrolling/ })).toHaveCount(0);
		await page.screenshot({ path: test.info().outputPath("upgrade-testimonials.png") });
		await posts.screenshot({ path: test.info().outputPath("testimonial-bento.png") });
		await page.evaluate(() => {
			document.documentElement.classList.add("dark");
			document.documentElement.dataset.theme = "dark";
		});
		await page.screenshot({ path: test.info().outputPath("upgrade-testimonials-dark.png") });
		await page.evaluate(() => {
			document.documentElement.classList.remove("dark");
			document.documentElement.dataset.theme = "light";
		});
		const column = posts.getByRole("region", { name: "Testimonial column 1", exact: true });
		await column.focus();
		await page.keyboard.press("ArrowDown");
		await expect(column).toHaveCSS("overflow-y", "clip");
		await expect(posts).toHaveCSS("overflow-x", "clip");
		expect(
			await column.evaluate((element) => {
				element.scrollTop = 100;
				return element.scrollTop;
			}),
		).toBe(0);
		expect(
			await posts.evaluate((element) => {
				element.scrollLeft = 100;
				return element.scrollLeft;
			}),
		).toBe(0);
		await expect(dialog.getByRole("heading", { name: "Loved by the community" })).toHaveCount(
			0,
		);
		await expect(dialog.getByRole("heading", { name: "Your Cloud benefits" })).toHaveCount(0);
		const size = await dialog.evaluate((element) => ({
			width: element.getBoundingClientRect().width,
			viewport: window.innerWidth,
		}));
		expect(size.width).toBeLessThanOrEqual(size.viewport);

		if (viewport.width === 1440) {
			await page.emulateMedia({ reducedMotion: "no-preference" });
			await dialog.locator(".pricing-close").focus();
			await page.mouse.move(0, 0);
			const track = column.locator(".testimonial-track");
			const before = await track.evaluate((element) => getComputedStyle(element).transform);
			await expect
				.poll(() => track.evaluate((element) => getComputedStyle(element).transform))
				.not.toBe(before);
			// Pointer hover leaves the marquee moving.
			await column.hover({ force: true });
			await expect
				.poll(() =>
					track.evaluate((element) => getComputedStyle(element).animationPlayState),
				)
				.toBe("running");
			await page.mouse.move(0, 0);
			await expect
				.poll(() =>
					track.evaluate((element) => getComputedStyle(element).animationPlayState),
				)
				.toBe("running");
		}
	});
}

test("bento testimonials keep moving on hover and pause for keyboard focus", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Cloud" });
	const posts = dialog.getByRole("region", { name: "Community testimonials" });
	await dialog.locator(".pricing-close").focus();
	await page.mouse.move(0, 0);
	for (const [index, column] of (await posts.locator(".testimonial-column").all()).entries()) {
		const track = column.locator(".testimonial-track");
		await column.scrollIntoViewIfNeeded();
		const motion = await track.evaluate((element) => {
			const animation = element.getAnimations()[0];
			const duration = Number(animation.effect!.getTiming().duration);
			animation.currentTime = duration * 0.25;
			const before = new DOMMatrixReadOnly(getComputedStyle(element).transform);
			animation.currentTime = duration * 0.3;
			const after = new DOMMatrixReadOnly(getComputedStyle(element).transform);
			return { x: after.m41 - before.m41, y: after.m42 - before.m42, duration };
		});
		expect(motion.x).toBe(0);
		expect(motion.duration).toBeLessThanOrEqual(24000);
		if (index === 1) expect(motion.y).toBeLessThan(0);
		else expect(motion.y).toBeGreaterThan(0);
		// Hover must also leave the loop moving while its copies are visible.
		await track.evaluate((element) => {
			const animation = element.getAnimations()[0];
			const duration = Number(animation.effect!.getTiming().duration);
			animation.currentTime = duration * 0.95;
		});
		await column
			.locator(".testimonial-duplicates .testimonial-card")
			.first()
			.hover({ force: true });
		await expect(track).toHaveCSS("animation-play-state", "running");
		const positions = await track.evaluate(async (element) => {
			const before = getComputedStyle(element).transform;
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			);
			return [before, getComputedStyle(element).transform];
		});
		expect(positions[1]).not.toBe(positions[0]);
		await page.mouse.move(0, 0);
		await expect(track).toHaveCSS("animation-play-state", "running");
		await expect
			.poll(() => track.evaluate((element) => getComputedStyle(element).transform))
			.not.toBe(positions[1]);
		await column.focus();
		await expect(track).toHaveCSS("animation-play-state", "paused");
		await dialog.locator(".pricing-close").focus();
	}
});

test("regular pricing follows the catalog and hides ended promotions", async ({ page }) => {
	await openUsage(page, "free", 1500);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Cloud" });
	await expect(dialog.locator(".pricing-price")).toHaveText("$15 USD / month");
	await expect(dialog.locator(".pricing-heading-offer")).toHaveCount(0);
	await expect(dialog.locator(".pricing-regular-price")).toHaveCount(0);
	await expect(dialog.locator(".pricing-early-bird-label")).toHaveCount(0);
	await expect(dialog.locator(".pricing-price")).toContainText("$15");
	await expect(dialog.locator(".pricing-renewal")).toHaveCount(0);
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toBeEnabled();
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
		await expect(
			page.getByRole("heading", { name: "Unlock the full power of Recordly" }),
		).toBeVisible();
		await expect(page.locator(".pricing-price-offer")).toHaveCount(0);
		await expect(page.locator(".pricing-heading-offer")).toHaveCount(0);
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
	await expect(page.getByText("2 of 5 used")).toBeVisible();
	await page.getByRole("button", { name: "Open test publish", exact: true }).click();
	await page.getByRole("button", { name: "Share", exact: true }).click();
	await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
		"https://example.test/s/new-recording",
	);
	await expect(page.getByText("3 of 5 used")).toBeVisible();
});

test("a library mutation during an in-flight usage read fetches a new snapshot afterward", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => {
		window.billingUsageTest.releaseStatus(2);
		window.billingUsageTest.releaseCatalog();
	});
	await expect(page.getByText("2 of 5 used")).toBeVisible();
	await page.evaluate(() => {
		window.billingUsageTest.state.holdStatus = true;
	});
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(2);
	await page.getByRole("button", { name: "Cloud library changed", exact: true }).click();
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await expect(page.getByText("3 of 5 used")).toBeVisible();
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
	await expect(page.getByText("2 of 5 used")).toBeVisible();
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	expect(await page.evaluate(() => window.billingUsageTest.state.catalogCalls)).toBe(1);
	await page.evaluate(() => {
		window.billingUsageTest.state.holdStatus = true;
	});
	await page.getByRole("button", { name: "Refresh usage", exact: true }).click();
	await expect(page.getByText("2 of 5 used")).toBeVisible();
	await page.evaluate(() => {
		window.dispatchEvent(new Event("focus"));
		document.dispatchEvent(new Event("visibilitychange"));
	});
	expect(await page.evaluate(() => window.billingUsageTest.state.statusCalls)).toBe(2);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(4));
	await expect(page.getByText("4 of 5 used")).toBeVisible();
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

test("an account change hides cached usage and rejects the old account's late response", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await expect(page.getByText("2 of 5 used")).toBeVisible();
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
	await expect(page.getByText("2 of 5 used")).toHaveCount(0);
	await expect(page.getByText("Loading usage…")).toBeVisible();
	await page.evaluate(() => {
		const state = window.billingUsageTest.state;
		const old = state.pendingStatus.shift();
		old?.({ success: true, billing: { plan: "pro" } });
	});
	await expect(page.getByText("Loading usage…")).toBeVisible();
	await page.evaluate(() => window.billingUsageTest.releaseStatus(1));
	await expect(page.getByText("1 of 5 used")).toBeVisible();
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
	await expect(page.getByText("2 of 5 used")).toBeVisible();
	const key = await usageCacheKey(page);
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull();
	await page.reload();
	await expect(page.getByText("2 of 5 used")).toBeVisible();
	await expect(page.getByText("Loading usage…")).toHaveCount(0);
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
	await expect(page.getByTestId("verified-checkout")).toHaveText("false");
	await page.evaluate(() => window.billingUsageTest.releaseStatus(4));
	await expect(page.getByText("4 of 5 used")).toBeVisible();
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
	await page.reload();
	await expect(page.getByText("4 of 5 used")).toBeVisible();
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
});

test("an offline renderer keeps the last saved usage without granting billing access", async ({
	page,
}) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await expect(page.getByText("2 of 5 used")).toBeVisible();
	await page.reload();
	await expect(page.getByText("2 of 5 used")).toBeVisible();
	await page.evaluate(() => window.billingUsageTest.failStatus());
	await expect(page.getByTestId("usage-loading")).toHaveText("false");
	await expect(page.getByText("2 of 5 used")).toBeVisible();
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
	await expect(page.getByText("1 of 5 used")).toBeVisible();
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
	await expect(page.getByText(/of 5 used/)).toHaveCount(0);
	await expect(page.getByTestId("verified-plan")).toHaveText("unverified");
	await page.evaluate(() => window.billingUsageTest.releaseStatus(3));
	await expect(page.getByText("3 of 5 used")).toBeVisible();
});

test("legacy billing fallback also saves usage for the next renderer session", async ({ page }) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseLegacy());
	await expect(page.getByText("2 of 5 used")).toBeVisible();
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
	await expect(page.getByText("2 of 5 used")).toBeVisible();
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
	const dialog = page.getByRole("dialog", { name: "Recordly Cloud" });
	await expect(dialog.locator(".pricing-price")).toHaveText("$12 USD / month");
	await expect(dialog.locator(".pricing-heading-offer")).toHaveText("EARLY BIRD 20% OFF");
	await expect(dialog.locator(".pricing-price-banner")).toHaveText("EARLY BIRD 20% OFF");
	await expect(dialog.locator(".pricing-renewal")).toHaveCount(0);
});

test("pending catalog does not advertise a fabricated price or promotion", async ({ page }) => {
	await openUsage(page);
	await page.evaluate(() => window.billingUsageTest.releaseStatus(2));
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Cloud" });
	await expect(dialog.locator(".pricing-price")).toHaveCount(0);
	await expect(dialog.locator(".pricing-heading-offer")).toHaveCount(0);
	await expect(dialog.locator(".pricing-renewal")).toHaveCount(0);
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
	await dialog.getByRole("button", { name: "Get started", exact: true }).click();
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
	await expect(dialog.getByText(/Your Cloud plan is active/)).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toHaveCount(0);
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
	await dialog.getByRole("button", { name: "Get started", exact: true }).click();
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
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toBeEnabled();
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
	await expect(dialog.getByText(/Complete checkout in your browser/)).toHaveCount(0);
	await page.evaluate(() => {
		const read = window.electronAPI.cloudBilling;
		window.electronAPI.cloudBilling = async (input) =>
			input.action === "checkout" ? { success: true } : read(input);
	});
	await dialog.getByRole("button", { name: "Get started", exact: true }).click();
	await expect(dialog.getByText(/Complete checkout in your browser/)).toBeVisible();
	await expect(dialog.getByRole("alert")).toHaveCount(0);
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
});

for (const width of [1440, 390]) {
	test(`unavailable billing keeps Get started and hides the availability callout at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 1000 });
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
		await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Recordly Cloud" });
		const action = dialog.getByRole("button", { name: "Get started", exact: true });
		await expect(action).toBeEnabled();
		await expect(dialog.getByText(/We couldn’t load your billing options/)).toHaveCount(0);
		await expect(
			dialog.getByRole("button", {
				name: /Refresh options|Retry loading pricing|Loading pricing/,
			}),
		).toHaveCount(0);
		await action.click();
		await expect(action).toBeEnabled();
		await expect(page.getByTestId("verified-checkout")).toHaveText("false");
		await action.scrollIntoViewIfNeeded();
		await page.screenshot({ path: test.info().outputPath("unavailable-billing.png") });
	});
}

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
		const dialog = page.getByRole("dialog", { name: "Recordly Cloud", exact: true });
		await expect(
			dialog.getByText("Your Cloud plan is active.", { exact: false }),
		).toBeVisible();
		await expect(dialog.locator(".pricing-price-offer")).toHaveCount(0);
		await expect(dialog.locator(".pricing-heading-offer")).toHaveCount(0);
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
