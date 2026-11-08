import { expect, type Page } from "@playwright/test";
import { productionTest as test } from "./production";
import { completeSupabaseSignIn } from "./auth";
import { installDesktopBridge } from "./bridge";

async function captureSignInReports(page: Page) {
	const reports: { error: string; logs: string }[] = [];
	await page.route(
		"https://auth.recordly.test/functions/v1/submit-export-error",
		async (route) => {
			reports.push(route.request().postDataJSON());
			await route.fulfill({ json: { success: true } });
		},
	);
	return reports;
}

test("sign-in keeps all providers visible and marks unavailable providers disabled", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.route("https://auth.recordly.test/auth/v1/settings", (route) =>
		route.fulfill({
			json: { external: { google: true, azure: false, apple: false, email: true } },
		}),
	);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setViewportSize({ width: 600, height: 600 });
	await page.goto("/?windowType=onboarding");
	const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(login).toBeVisible({ timeout: 20000 });
	await expect(
		login.getByRole("button", { name: "Continue with Google", exact: true }),
	).toBeVisible();
	await expect(
		login.getByRole("button", { name: "Continue with Microsoft", exact: true }),
	).toBeDisabled();
	await expect(
		login.getByRole("button", { name: "Continue with Apple", exact: true }),
	).toBeDisabled();
	await expect(
		login.getByRole("button", { name: "Continue with Apple", exact: true }),
	).toHaveAccessibleDescription("Apple sign-in is not enabled yet");
	await expect(
		login.getByRole("button", { name: "Continue with GitHub", exact: true }),
	).toHaveCount(0);
	const email = login.getByRole("textbox", { name: /^Email\*?$/ });
	const emailCode = login.getByRole("button", { name: "Email me a code" });
	await expect(login.locator("[data-signin-divider]")).toHaveText("or");
	const passwordSwitch = login.getByRole("button", {
		name: "Or use password to sign in",
		exact: true,
	});
	await expect(passwordSwitch).toHaveCount(1);
	const emailLabel = login.locator("[data-signin-form] label").filter({ hasText: /^Email/ });
	const labelBounds = (await emailLabel.boundingBox())!;
	const linkBounds = (await passwordSwitch.boundingBox())!;
	expect(
		Math.abs(linkBounds.y + linkBounds.height / 2 - (labelBounds.y + labelBounds.height / 2)),
	).toBeLessThan(3);
	expect(linkBounds.x).toBeGreaterThan(labelBounds.x + labelBounds.width);
	await expect(passwordSwitch).toHaveCSS("text-decoration-line", "none");
	await passwordSwitch.hover();
	await expect(passwordSwitch).toHaveCSS("text-decoration-line", "underline");
	let codeRequests = 0;
	page.on("request", (request) => {
		if (request.url().includes("/auth/v1/otp")) codeRequests++;
	});
	await expect(emailCode).toBeVisible();
	await expect(emailCode).toBeEnabled();
	await emailCode.click();
	await expect(email).toHaveAttribute("aria-invalid", "true");
	expect(codeRequests).toBe(0);
	await email.fill("owner@example");
	await expect(emailCode).toBeEnabled();
	await emailCode.click();
	await expect(email).toHaveAttribute("aria-invalid", "true");
	expect(codeRequests).toBe(0);
	await email.fill("owner@example.test");
	await expect(emailCode).toBeEnabled();
	await email.clear();
	await expect(emailCode).toBeVisible();
	await expect(emailCode).toBeEnabled();
	await page.screenshot({
		path: "test-results/onboarding-enabled-providers.png",
		animations: "disabled",
	});
});

test("email sign-in reports localized failures and allows retry without granting access", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	const reports = await captureSignInReports(page);
	let attempts = 0;
	await page.route("https://auth.recordly.test/auth/v1/otp**", async (route) => {
		attempts++;
		if (attempts === 1)
			return route.fulfill({
				status: 429,
				json: {
					msg: "Please wait before requesting another email.",
					error_code: "over_email_send_rate_limit",
				},
			});
		return route.fulfill({ json: {} });
	});
	await page.goto("/?windowType=editor");
	const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("owner@example.test");
	const rejectedCode = page.waitForResponse(
		(response) => response.url().includes("/auth/v1/otp") && response.status() === 429,
	);
	await login.getByRole("button", { name: "Email me a code" }).click();
	await rejectedCode;
	await expect(login.getByRole("alert")).toContainText(
		"Sign-in failed. Check your connection and try again.",
	);
	await expect(login).not.toContainText("Please wait before requesting another email.");
	await expect(login).toHaveAttribute("data-onboarding-state", "login");
	await login.getByRole("button", { name: "Report error", exact: true }).click();
	await expect(login.getByRole("button", { name: "Report sent", exact: true })).toBeVisible();
	expect(reports).toHaveLength(1);
	expect(reports[0].error).toContain("[auth] sign-in-code: failed");
	expect(reports[0].error).toContain("Please wait before requesting another email.");
	expect(reports[0].error).toContain("over_email_send_rate_limit");
	expect(reports[0].error).toContain("status: 429");
	expect(reports[0].logs).toContain("[auth] sign-in-code: failed");
	expect(JSON.stringify(reports)).not.toContain("owner@example.test");
	await login.getByRole("button", { name: "Email me a code" }).click();
	await expect(login.getByText(/^Enter code sent to /)).toBeVisible();
	await expect(login).toHaveAttribute("data-onboarding-state", "login");
	expect(attempts).toBe(2);
});

test("a rejected Supabase callback keeps sign-in mandatory", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	const reports = await captureSignInReports(page);
	await page.route("https://auth.recordly.test/auth/v1/token**", (route) =>
		route.fulfill({
			status: 400,
			json: {
				error: "invalid_grant",
				error_code: "flow_state_expired",
				error_description:
					"Sign-in link has expired for person@example.test code_verifier=private-verifier recordly://auth/callback?code=private-callback",
			},
		}),
	);
	await page.goto("/?windowType=editor");
	const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("owner@example.test");
	await login.getByRole("button", { name: "Email me a code" }).click();
	await expect(login.getByText(/^Enter code sent to /)).toBeVisible();
	await completeSupabaseSignIn(page);
	const failure = "Sign-in failed. Check your connection and try again.";
	await expect(login.getByRole("alert")).toContainText(failure);
	await expect(login).not.toContainText("Sign-in link has expired");
	await login.getByRole("button", { name: "Report error", exact: true }).click();
	await expect(login.getByRole("button", { name: "Report sent", exact: true })).toBeVisible();
	expect(reports).toHaveLength(1);
	expect(reports[0].error).toContain("callback-delivery");
	expect(reports[0].error).toContain("AuthApiError");
	expect(reports[0].error).toContain("flow_state_expired");
	expect(reports[0].error).toContain("status: 400");
	expect(reports[0].logs).toContain("[auth] callback-token-exchange: failed");
	for (const secret of ["person@example.test", "private-verifier", "private-callback"])
		expect(JSON.stringify(reports)).not.toContain(secret);
	await expect(login).toHaveAttribute("data-onboarding-state", "login");
	await expect(login.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
	await expect(
		login
			.getByRole("navigation", { name: "Onboarding pages" })
			.getByRole("button", { name: "Permissions", exact: true }),
	).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(login).toBeVisible();
	await login.getByRole("button", { name: "Use a different email", exact: true }).click();
	await expect(login.getByRole("textbox", { name: /^Email\*?$/ })).toHaveValue(
		"owner@example.test",
	);
	await login.getByRole("button", { name: "Email me a code" }).click();
	await expect(
		login.getByRole("textbox", { name: "Enter code sent to owner@example.test", exact: true }),
	).toBeVisible();
	await expect(login.getByText(failure, { exact: true })).toHaveCount(0);
	await expect(login).toHaveAttribute("data-onboarding-state", "login");
});

for (const [label, provider] of [
	["Google", "google"],
	["Microsoft", "azure"],
	["Apple", "apple"],
]) {
	test(`${label} sign-in opens Supabase OAuth in the system browser`, async ({ page }) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
		await page.addInitScript(() => {
			window.electronAPI.openExternalUrl = async (url) => {
				document.documentElement.dataset.authUrl = url;
				return { success: true };
			};
		});
		await page.goto("/?windowType=editor");
		const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
		await login.getByRole("button", { name: `Continue with ${label}`, exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-auth-url", /auth\/v1\/authorize/);
		const url = new URL((await page.locator("html").getAttribute("data-auth-url"))!);
		expect(url.origin).toBe("https://auth.recordly.test");
		expect(url.searchParams.get("provider")).toBe(provider);
		expect(url.searchParams.get("redirect_to")).toBe("recordly://auth/callback");
		expect(url.searchParams.get("code_challenge")).toBeTruthy();
		await expect(login).toHaveAttribute("data-onboarding-state", "login");
	});
}

test("restored Supabase sessions show the account and sign-out requires authentication again", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	const account = page.getByRole("dialog", { name: "Account menu", exact: true });
	await expect(account.getByText("Test User", { exact: true })).toBeVisible();
	await expect(
		account.getByRole("button", { name: "Manage account", exact: true }),
	).toBeVisible();
	await expect(account.locator('img[src$="login-banner.png"]')).toHaveCount(0);
	const logout = page.waitForRequest((request) => request.url().includes("/auth/v1/logout"));
	await account.getByRole("button", { name: "Log out", exact: true }).click();
	await logout;
	const login = page.getByRole("dialog", { name: "Sign in to Recordly", exact: true });
	await expect(login).toBeVisible();
	await page.reload();
	await expect(login).toBeVisible();
	await expect(login.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
});

test("returning users sign in through a compact popup with the requested copy", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: true });
	await page.goto("/?windowType=editor");
	const login = page.getByRole("dialog", { name: "Sign in to Recordly", exact: true });
	await expect(login).toBeVisible({ timeout: 20000 });
	await expect(
		login.getByRole("heading", {
			name: "Sign into Recordly",
			exact: true,
		}),
	).toBeVisible();
	await page.screenshot({ path: "test-results/signin-polished.png", animations: "disabled" });
	await expect(login.getByRole("heading")).toHaveCount(1);
	await expect(login.getByText("Sign in to get started", { exact: true })).toHaveCount(0);
	await expect(login.getByRole("navigation", { name: "Onboarding pages" })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(login).toBeVisible();
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("test@email.com");
	await login.getByRole("button", { name: "Email me a code" }).click();
	await expect(login.getByText(/^Enter code sent to /)).toBeVisible();
	await completeSupabaseSignIn(page);
	await expect(login).not.toBeVisible();
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Account menu", exact: true })).toBeVisible();
});

test("editor and onboarding share one exchange for a broadcast sign-in callback", async ({
	page,
	context,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.goto("/?windowType=editor");
	const onboarding = await context.newPage();
	await installDesktopBridge(onboarding, "preview.mp4", { signedIn: false, onboarded: false });
	await onboarding.goto("/?windowType=onboarding");
	let exchanges = 0;
	context.on("request", (request) => {
		if (request.url().includes("/auth/v1/token") && request.method() === "POST") exchanges++;
	});
	const login = onboarding.getByRole("dialog", { name: "Welcome to Recordly" });
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("test@email.com");
	await login.getByRole("button", { name: "Email me a code" }).click();
	await expect(login.getByText(/^Enter code sent to /)).toBeVisible();
	await Promise.all([completeSupabaseSignIn(page), completeSupabaseSignIn(onboarding)]);
	for (const window of [page, onboarding]) {
		const tour = window.getByRole("dialog", { name: "Welcome to Recordly" });
		await expect(tour.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
		await expect(tour.getByRole("alert")).toHaveCount(0);
	}
	expect(exchanges).toBe(1);
	await onboarding.close();
});

test("sign-in keeps its banner and email action usable in a short window", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.goto("/?windowType=editor");
	const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
	const banner = login.locator("[data-onboarding-artwork]");
	const submit = login.getByRole("button", { name: "Email me a code" });
	const pages = login.getByRole("navigation", { name: "Onboarding pages" });
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("owner@example.test");
	await expect(submit).toBeVisible();
	const tallBanner = (await banner.boundingBox())!;
	expect(tallBanner.height).toBeGreaterThan(128);
	await expect(pages).toBeInViewport();
	await page.screenshot({
		path: "test-results/onboarding-responsive-banner.png",
		animations: "disabled",
	});
	await page.setViewportSize({ width: 390, height: 600 });
	await expect(banner).toBeInViewport();
	expect((await banner.boundingBox())!.height).toBeLessThan(tallBanner.height);
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("owner@example.test");
	await expect(login.getByLabel("Password", { exact: true })).toHaveCount(0);
	await expect(login.getByRole("navigation", { name: "Onboarding pages" })).toBeInViewport();
	await submit.scrollIntoViewIfNeeded();
	await expect(submit).toBeInViewport();
	await submit.click();
	await expect(login.getByText(/^Enter code sent to /)).toBeVisible();
	await page.screenshot({ path: "test-results/required-sign-in.png", animations: "disabled" });
});

test("signup keeps the legal notice without promotional controls", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.goto("/?windowType=onboarding");
	const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(login).toBeVisible({ timeout: 20000 });
	await expect(login.getByText(/By continuing, you agree/)).toBeVisible();
	await expect(login.getByText(/By continuing, you agree/)).toHaveCount(1);
	await expect(login.getByRole("navigation", { name: "Legal and support" })).toHaveCount(0);
	await expect(login.getByRole("link", { name: "Terms", exact: true })).toHaveCount(1);
	await expect(login.getByRole("link", { name: "Privacy Policy", exact: true })).toHaveCount(1);
	expect(
		await login.evaluate((element) => {
			const email = element.querySelector('input[type="email"]');
			const notice = element.querySelector(".pricing-legal-consent");
			return Boolean(
				email &&
					notice &&
					email.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
			);
		}),
	).toBe(true);
	await expect(login.getByRole("checkbox")).toHaveCount(0);
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("new@example.test");
	const request = page.waitForRequest(
		(request) => request.url().includes("/auth/v1/otp") && request.method() === "POST",
	);
	await login.getByRole("button", { name: "Email me a code" }).click();
	const consent = (await request).postDataJSON().data.signup_consent;
	expect(consent).toMatchObject({
		legal_accepted: true,
		acceptance_method: "continue-with-notice",
		version: "2026-10-29.1",
	});
	expect(consent).not.toHaveProperty("marketing_emails");
	expect(consent).not.toHaveProperty("marketing_wording");
	await expect(login.getByText(/^Enter code sent to /)).toBeVisible();
	await page.screenshot({ path: "test-results/signup-legal-only.png", animations: "disabled" });
});

for (const fails of [false, true]) {
	test(`account email preference ${fails ? "reports a save error without changing the choice" : "saves opt-in and opt-out"}`, async ({
		page,
	}) => {
		await installDesktopBridge(page);
		if (fails)
			await page.route("https://auth.recordly.test/auth/v1/user", (route) => {
				if (route.request().method() === "PUT")
					return route.fulfill({
						status: 400,
						json: { msg: "Could not save email preference." },
					});
				return route.fallback();
			});
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Manage account" })
			.click();
		const settings = page.getByRole("dialog", { name: "Account settings", exact: true });
		const checkbox = settings.getByRole("checkbox", { name: /Email me the latest updates/ });
		await expect(checkbox).not.toBeChecked();
		const request = page.waitForRequest(
			(request) => request.url().endsWith("/auth/v1/user") && request.method() === "PUT",
		);
		await checkbox.press("Space");
		expect((await request).postDataJSON().data.email_preferences).toMatchObject({
			marketing_emails: true,
			source: "account-settings",
			wording: "Email me the latest updates, deals and offers from Recordly.",
		});
		if (fails) {
			const feedback = settings
				.getByRole("region", { name: "Email preferences", exact: true })
				.getByRole("alert");
			await expect(feedback).toContainText(
				"Could not save this account change. Check your details and connection, then try again.",
			);
			await expect(
				feedback.getByRole("button", { name: "Report error", exact: true }),
			).toBeVisible();
			await feedback.locator("summary").click();
			await expect(feedback.locator("details")).toHaveAttribute("open", "");
			await expect(feedback.locator("details")).toContainText(
				"Could not save email preference.",
			);
			await expect(checkbox).not.toBeChecked();
		} else {
			await expect(
				settings.getByText("Email preferences saved.", { exact: true }),
			).toBeVisible();
			await expect(checkbox).toBeChecked();
			await page.screenshot({
				path: "test-results/account-email-preference.png",
				animations: "disabled",
			});
			await settings.getByRole("button", { name: "Close", exact: true }).click();
			await expect(settings).not.toBeVisible();
			await page.getByRole("button", { name: "Recordly account", exact: true }).click();
			await page
				.getByRole("dialog", { name: "Account menu", exact: true })
				.getByRole("button", { name: "Manage account" })
				.click();
			await expect(checkbox).toBeChecked();
			const optOut = page.waitForRequest(
				(request) => request.url().endsWith("/auth/v1/user") && request.method() === "PUT",
			);
			await checkbox.press("Space");
			expect((await optOut).postDataJSON().data.email_preferences.marketing_emails).toBe(
				false,
			);
			await expect(checkbox).not.toBeChecked();
			await expect(
				settings.getByText("Email preferences saved.", { exact: true }),
			).toBeVisible();
		}
	});
}
