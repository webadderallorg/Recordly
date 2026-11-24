import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openUpgrade(page: Page, yearly = false) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		({ yearly }) => {
			const prices = [
				{
					interval: "monthly",
					unitAmount: 900,
					regularUnitAmount: 1500,
					promotion: "early_bird",
					currency: "usd",
				},
				...(yearly ? [{ interval: "yearly", unitAmount: 8100, currency: "usd" }] : []),
			];
			window.electronAPI.cloudBilling = async ({ action, interval }) => {
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
				if (action === "status")
					return {
						success: true,
						billing: {
							plan: "free",
							subscriptionStatus: null,
							currentPeriodEnd: null,
							cancelAtPeriodEnd: false,
							checkoutAvailable: true,
							checkoutIntervals: yearly ? ["monthly", "yearly"] : ["monthly"],
							portalAvailable: false,
							prices,
						},
						usage: {
							recordings: 0,
							recordingLimit: 5,
							maxRecordingBytes: 1e9,
							storageBytes: 0,
							storageLimitBytes: 1e11,
						},
					};
				document.documentElement.dataset.billingAction = action;
				document.documentElement.dataset.billingInterval = interval;
				return { success: true };
			};
		},
		{ yearly },
	);
	await page.goto("/tests/ui/billing-usage.html");
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Plus", exact: true });
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
	await expect(dialog.getByRole("button", { name: "Get Started", exact: true })).toBeEnabled();
	return dialog;
}

for (const viewport of [
	{ width: 1440, height: 1000 },
	{ width: 1024, height: 640 },
	{ width: 820, height: 700 },
	{ width: 390, height: 844 },
	{ width: 320, height: 640 },
]) {
	test(`split upgrade fits and dismisses at ${viewport.width}px`, async ({ page }) => {
		await page.setViewportSize(viewport);
		await page.emulateMedia({ reducedMotion: "reduce" });
		const dialog = await openUpgrade(page);
		const heading = dialog.getByRole("heading", { name: "Upgrade to Plus", exact: true });
		await expect(heading).toBeVisible();
		await expect(heading.locator(".split-upgrade-mark")).toBeVisible();
		await expect(dialog.getByRole("navigation", { name: "Legal and support" })).toHaveCount(0);
		await expect(dialog.locator(".pricing-legal-consent")).toHaveCount(0);
		await expect(dialog.getByRole("radio")).toHaveCount(0);
		await expect(dialog.getByRole("list", { name: "Your Plus benefits" })).toBeVisible();
		await expect(dialog.locator(".split-upgrade-benefits li")).toHaveText([
			"Use Recordly for commercial projects",
			"Share freely with unlimited links",
			"Store everything on the cloud",
			"Play cloud videos in clear FHD",
		]);
		await expect(
			dialog.locator("[data-onboarding-artwork] .recordly-banner-light"),
		).toHaveAttribute("src", /auth\/recordly-banner-(light|dark)\.png/);
		await expect(
			dialog.locator(".split-upgrade-preview, .split-upgrade-window-bar"),
		).toHaveCount(0);
		const price = dialog.locator(".pricing-price");
		const regularPrice = dialog.locator("s.pricing-regular-price");
		const period = dialog.locator(".split-upgrade-price-period");
		await expect(price).toHaveText("$9");
		await expect(period).toHaveText("per month");
		await expect(regularPrice).toHaveText("$15");
		await expect(regularPrice).toHaveCSS("text-decoration-line", "line-through");
		await expect(dialog.getByText("Cancel anytime", { exact: true })).toHaveCount(0);
		const discount = dialog.getByText("40% off with early bird pricing", { exact: true });
		await expect(discount).toBeVisible();
		const priceBox = (await price.boundingBox())!;
		const regularPriceBox = (await regularPrice.boundingBox())!;
		const discountBox = (await discount.boundingBox())!;
		const periodBox = (await period.boundingBox())!;
		expect(regularPriceBox.x + regularPriceBox.width).toBeLessThanOrEqual(priceBox.x);
		expect(periodBox.x).toBeGreaterThanOrEqual(priceBox.x + priceBox.width);
		expect(periodBox.y).toBeLessThan(priceBox.y + priceBox.height);
		expect(discountBox.y).toBeGreaterThanOrEqual(
			Math.max(priceBox.y + priceBox.height, periodBox.y + periodBox.height),
		);
		await expect(dialog.locator(".split-upgrade-purchase")).toHaveCSS(
			"border-top-width",
			"0px",
		);
		const paymentMethods = dialog.locator(".pricing-payment-methods");
		await expect(paymentMethods.getByRole("img")).toHaveCount(4);
		await expect(paymentMethods.getByRole("img", { name: "Apple Pay" })).toBeInViewport();
		expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
		const banner = dialog.locator("[data-onboarding-artwork]");
		await expect(banner).toBeInViewport();
		const bannerBox = await banner.boundingBox();
		const paymentBox = (await paymentMethods.boundingBox())!;
		const ctaBox = (await dialog.locator(".split-upgrade-cta").boundingBox())!;
		// Payment badges sit directly under the checkout button, centred on it.
		expect(paymentBox.y).toBeGreaterThanOrEqual(ctaBox.y + ctaBox.height);
		expect(
			Math.abs(paymentBox.x + paymentBox.width / 2 - (ctaBox.x + ctaBox.width / 2)),
		).toBeLessThan(2);
		await expect(banner).toHaveCSS("mask-image", /linear-gradient/);
		expect(
			await banner.evaluate((el) => Number.parseFloat(getComputedStyle(el).marginBottom)),
		).toBeLessThan(0);
		await expect(dialog.locator(".onboarding-ambience .onboarding-blob")).toHaveCount(3);
		const box = await dialog.boundingBox();
		expect(Math.abs(bannerBox!.width - box!.width)).toBeLessThan(20);
		const headerBox = await dialog.locator(".split-upgrade-header").boundingBox();
		expect(headerBox!.y).toBeGreaterThan(bannerBox!.y + bannerBox!.height / 2);
		expect(headerBox!.y).toBeLessThan(bannerBox!.y + bannerBox!.height);
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
		for (const theme of ["light", "dark"]) {
			await page.evaluate((theme) => {
				document.documentElement.classList.toggle("dark", theme === "dark");
				document.documentElement.classList.toggle("light", theme === "light");
				document.documentElement.dataset.theme = theme;
				document.documentElement.style.colorScheme = theme;
			}, theme);
			await expect(banner.locator("img:visible")).toHaveAttribute(
				"src",
				new RegExp(`auth/recordly-banner-${theme}\\.png$`),
			);
			await dialog.screenshot({
				path: test.info().outputPath(`upgrade-${theme}-${viewport.width}.png`),
				animations: "disabled",
			});
		}
		const purchase = dialog.getByRole("button", { name: "Get Started", exact: true });
		await dialog.locator(".split-upgrade-purchase").scrollIntoViewIfNeeded();
		await expect(purchase).toBeInViewport();
		await expect(dialog.getByRole("button", { name: "Maybe later", exact: true })).toHaveCount(
			0,
		);
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await expect(page.locator("html")).not.toHaveAttribute("data-billing-action");
		await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
		await page.keyboard.press("Escape");
		await expect(dialog).not.toBeVisible();
	});
}

test("the redesign preserves monthly-only checkout when a catalog includes yearly pricing", async ({
	page,
}) => {
	const dialog = await openUpgrade(page, true);
	await expect(dialog.getByRole("radio")).toHaveCount(0);
	await expect(
		dialog.getByText("40% off with early bird pricing", { exact: true }),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Get Started", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-billing-action", "checkout");
	await expect(page.locator("html")).toHaveAttribute("data-billing-interval", "monthly");
	await expect(
		dialog.getByRole("button", { name: "Check payment status", exact: true }),
	).toBeVisible();
});
