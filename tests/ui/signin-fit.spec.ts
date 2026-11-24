import { expect, type Locator, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { productionTest as test } from "./production";

async function expectFormFits(dialog: Locator) {
	await expect
		.poll(() =>
			dialog.evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				const targets = [
					element,
					...element.querySelectorAll("[data-onboarding-body], .recordly-signin-content"),
				];
				const controls = element.querySelectorAll(
					"input, [data-signin-form] button, .pricing-legal-consent",
				);
				return [
					...targets
						.filter((target) => target.scrollHeight - target.clientHeight > 1)
						.map((target) => ({
							problem: "overflow",
							className: target.className,
							client: target.clientHeight,
							scroll: target.scrollHeight,
						})),
					...Array.from(controls).flatMap((control) => {
						const rect = control.getBoundingClientRect();
						return rect.top >= bounds.top && rect.bottom <= bounds.bottom
							? []
							: [
									{
										problem: "clipped",
										control: control.textContent || control.tagName,
										top: rect.top,
										bottom: rect.bottom,
										dialogTop: bounds.top,
										dialogBottom: bounds.bottom,
									},
								];
					}),
				];
			}),
		)
		.toEqual([]);
}

async function openSignIn(page: Page, onboarding: boolean) {
	await installDesktopBridge(page, "preview.mp4", {
		signedIn: false,
		onboarded: !onboarding,
	});
	if (!onboarding) {
		await installDesktopBridgeOverrides(page, () => {
			const getAppSetting = window.electronAPI.getAppSetting;
			window.electronAPI.getAppSetting = (key) =>
				key === "recordly.onboarding.signInSkipped" ? true : getAppSetting(key);
		});
	}
	await page.emulateMedia({
		colorScheme: onboarding ? "light" : "dark",
		reducedMotion: "reduce",
	});
	await page.route("**/cloud/config", (route) =>
		route.fulfill({
			headers: { "Access-Control-Allow-Origin": "*" },
			json: { authCaptcha: { enabled: false } },
		}),
	);
	await page.goto(onboarding ? "/?windowType=onboarding" : "/?windowType=editor");
	if (!onboarding)
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	const dialog = page.getByRole("dialog", {
		name: onboarding ? "Welcome to Recordly" : "Sign in to Recordly",
		exact: true,
	});
	await expect(dialog.getByPlaceholder("you@example.com")).toBeVisible({
		timeout: 15000,
	});
	return dialog;
}

for (const onboarding of [true, false]) {
	test(`${onboarding ? "first startup" : "popup"} sign-in fits without scrolling`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 600, height: onboarding ? 600 : 800 });
		const dialog = await openSignIn(page, onboarding);
		const banner = dialog.locator("[data-recordly-demo]");
		await expect(banner).toHaveAttribute("data-banner-phase", "still");
		await expect(banner).toBeInViewport();
		await expect(banner.locator("..")).toHaveCSS("mask-image", /^linear-gradient/);
		const email = dialog.getByPlaceholder("you@example.com");
		const emailCode = dialog.getByRole("button", { name: "Email me a code", exact: true });
		const privacyPolicy = dialog.getByRole("link", { name: "Privacy Policy", exact: true });
		await expect(emailCode).toBeVisible({ visible: onboarding });
		await expectFormFits(dialog);
		const consent = dialog.locator(".pricing-legal-consent");
		expect((await consent.boundingBox())!.height).toBeLessThanOrEqual(18);
		await page.screenshot({
			path: `test-results/signin-fit-${onboarding ? "onboarding" : "popup"}-600.png`,
		});
		await email.focus();
		await expect(emailCode).toBeVisible();
		await page.keyboard.press("Tab");
		await expect(emailCode).toBeFocused();
		await privacyPolicy.focus();
		await expect(emailCode).toBeVisible({ visible: onboarding });
		await email.fill("test@email.com");
		await privacyPolicy.focus();
		await expect(emailCode).toBeVisible();
		await dialog.getByRole("button", { name: "Use password", exact: true }).click();
		await expect(dialog.getByLabel("Password", { exact: true })).toBeVisible();
		await expectFormFits(dialog);
		await dialog.getByRole("button", { name: "Sign in with email code", exact: true }).click();
		for (const size of [
			{ width: 390, height: 600 },
			{ width: 450, height: 450 },
		]) {
			await page.setViewportSize(size);
			await expectFormFits(dialog);
			await expect(banner).toBeInViewport();
			await expect(privacyPolicy).toBeInViewport();
			await page.screenshot({
				path: `test-results/signin-fit-${onboarding ? "onboarding" : "popup"}-${size.width}x${size.height}.png`,
			});
		}
		await emailCode.click();
		await expect(dialog.getByText("Enter code sent to test@email.com")).toBeVisible();
		await expectFormFits(dialog);
	});
}
