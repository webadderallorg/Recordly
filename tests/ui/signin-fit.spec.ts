import { expect, type Locator, type Page } from "@playwright/test";
import { productionTest as test } from "./production";
import { installDesktopBridge } from "./bridge";

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
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.route("**/cloud/config", (route) =>
		route.fulfill({
			headers: { "Access-Control-Allow-Origin": "*" },
			json: { authCaptcha: { enabled: false } },
		}),
	);
	await page.goto(onboarding ? "/?windowType=onboarding" : "/?windowType=editor");
	const dialog = page.getByRole("dialog", {
		name: onboarding ? "Welcome to Recordly" : "Sign in to Recordly",
		exact: true,
	});
	await expect(dialog.getByRole("button", { name: "Email me a code", exact: true })).toBeVisible({
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
		await expectFormFits(dialog);
		const consent = dialog.locator(".pricing-legal-consent");
		expect((await consent.boundingBox())!.height).toBeLessThanOrEqual(18);
		await page.screenshot({
			path: `test-results/signin-fit-${onboarding ? "onboarding" : "popup"}-600.png`,
		});
		await dialog.getByPlaceholder("you@example.com").fill("test@email.com");
		await dialog.getByRole("button", { name: "Or use password to sign in", exact: true }).click();
		await expect(dialog.getByLabel("Password", { exact: true })).toBeVisible();
		await expectFormFits(dialog);
		await dialog.getByRole("button", { name: "Sign in with email code", exact: true }).click();
		for (const size of [
			{ width: 390, height: 600 },
			{ width: 450, height: 450 },
		]) {
			await page.setViewportSize(size);
			await expectFormFits(dialog);
			await expect(
				consent.getByRole("link", { name: "Privacy Policy", exact: true }),
			).toBeInViewport();
			await page.screenshot({
				path: `test-results/signin-fit-${onboarding ? "onboarding" : "popup"}-${size.width}x${size.height}.png`,
			});
		}
		await dialog.getByRole("button", { name: "Email me a code", exact: true }).click();
		await expect(dialog.getByText("Enter code sent to test@email.com")).toBeVisible();
		await expectFormFits(dialog);
	});
}
