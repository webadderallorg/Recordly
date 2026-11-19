import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openUpgrade(page: Page, yearly = false, classic = false) {
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
	await page.goto(`/tests/ui/billing-usage.html${classic ? "?upgradeModal=classic" : ""}`);
	await page.getByRole("button", { name: "Open test pricing", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Recordly Cloud", exact: true });
	await expect(page.getByTestId("verified-plan")).toHaveText("free");
	await expect(dialog.getByRole("button", { name: "Get started", exact: true })).toBeEnabled();
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
		await expect(
			dialog.getByRole("heading", { name: "Unlock Recordly's full power", exact: true }),
		).toBeVisible();
		await expect(dialog.getByRole("navigation", { name: "Legal and support" })).toHaveCount(0);
		await expect(dialog.locator(".pricing-legal-consent")).toHaveCount(0);
		await expect(dialog.getByRole("radio")).toHaveCount(1);
		await expect(dialog.getByRole("radio", { name: /Monthly/ })).toBeChecked();
		await expect(dialog.getByRole("region", { name: "Your Cloud benefits" })).toBeVisible();
		await expect(dialog.locator(".split-upgrade-benefits li")).toHaveText([
			"Full commercial license",
			"Share any video with a 24/7 link",
			"Unlimited cloud storage and bandwidth",
			"Play cloud videos in FHD 1080p",
			"Export caption SRT and VTT files",
			"Priority support service",
		]);
		await expect(
			dialog.locator("[data-onboarding-artwork] .recordly-banner-light"),
		).toHaveAttribute("src", /auth\/recordly-banner-(light|dark)\.png/);
		await expect(
			dialog.locator(".split-upgrade-preview, .split-upgrade-window-bar"),
		).toHaveCount(0);
		await expect(dialog.locator(".pricing-price")).toHaveText("$9 USD / month");
		expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
		const banner = dialog.locator("[data-onboarding-artwork]");
		await expect(banner).toBeInViewport();
		const bannerBox = await banner.boundingBox();
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
			await page.screenshot({
				path: test.info().outputPath(`upgrade-${theme}-${viewport.width}.png`),
				animations: "disabled",
			});
		}
		const purchase = dialog.getByRole("button", { name: "Get started", exact: true });
		await dialog.locator(".split-upgrade-purchase").scrollIntoViewIfNeeded();
		await expect(purchase).toBeInViewport();
		await expect(dialog.getByRole("img", { name: "Apple Pay", exact: true })).toBeInViewport();
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
	await expect(dialog.getByRole("radio")).toHaveCount(1);
	await expect(dialog.locator(".pricing-heading-offer")).toContainText("40% off");
	await expect(dialog.getByRole("radio", { name: /Monthly/ })).toBeChecked();
	await dialog.getByRole("button", { name: "Get started", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-billing-action", "checkout");
	await expect(page.locator("html")).toHaveAttribute("data-billing-interval", "monthly");
	await expect(dialog.getByRole("radio", { name: /Monthly/ })).toBeDisabled();
});

test("the original upgrade modal remains available for comparison", async ({ page }) => {
	const dialog = await openUpgrade(page, false, true);
	await expect(dialog).toHaveClass(/upgrade-modal/);
	await expect(
		dialog.getByRole("heading", { name: "Unlock the full power of Recordly" }),
	).toBeVisible();
	await expect(dialog.getByRole("region", { name: "Community testimonials" })).toBeAttached();
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(dialog).not.toBeVisible();
});
