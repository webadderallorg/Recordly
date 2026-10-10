import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
import { completeSupabaseSignIn } from "./auth";

test("sign-in offers only providers enabled in Supabase", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false });
	await page.route("https://auth.recordly.test/auth/v1/settings", (route) =>
		route.fulfill({
			json: { external: { google: true, azure: false, github: false, email: true } },
		}),
	);
	await page.goto("/?windowType=editor");
	const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(login).toBeVisible({ timeout: 20000 });
	await expect(
		login.getByRole("button", { name: "Continue with Google", exact: true }),
	).toBeVisible();
	await expect(
		login.getByRole("button", { name: "Continue with Microsoft", exact: true }),
	).toHaveCount(0);
	await expect(
		login.getByRole("button", { name: "Continue with GitHub", exact: true }),
	).toHaveCount(0);
	const email = login.getByRole("textbox", { name: /^Email\*?$/ });
	const magicLink = login.getByRole("button", { name: "Email me a magic link" });
	await expect(magicLink).toHaveCount(0);
	await email.fill("owner@example");
	await expect(magicLink).toHaveCount(0);
	await email.fill("owner@example.test");
	await expect(magicLink).toBeEnabled();
	await email.clear();
	await expect(magicLink).toHaveCount(0);
	await page.screenshot({
		path: "test-results/onboarding-enabled-providers.png",
		animations: "disabled",
	});
});

test("email sign-in reports Supabase errors and allows retry without granting access", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false });
	let attempts = 0;
	await page.route("https://auth.recordly.test/auth/v1/otp**", async (route) => {
		attempts++;
		if (attempts === 1)
			return route.fulfill({
				status: 429,
				json: { msg: "Please wait before requesting another email." },
			});
		return route.fulfill({ json: {} });
	});
	await page.goto("/?windowType=editor");
	const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("owner@example.test");
	await login.getByRole("button", { name: "Email me a magic link" }).click();
	await expect(login.getByText("Please wait before requesting another email.")).toBeVisible();
	await expect(login).toHaveAttribute("data-onboarding-state", "login");
	await login.getByRole("button", { name: "Email me a magic link" }).click();
	await expect(login.getByText(/Check your inbox/)).toBeVisible();
	await expect(login).toHaveAttribute("data-onboarding-state", "login");
	expect(attempts).toBe(2);
});

test("a rejected Supabase callback keeps sign-in mandatory", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false });
	await page.route("https://auth.recordly.test/auth/v1/token**", (route) =>
		route.fulfill({
			status: 400,
			json: { error: "invalid_grant", error_description: "Sign-in link has expired" },
		}),
	);
	await page.goto("/?windowType=editor");
	const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("owner@example.test");
	await login.getByRole("button", { name: "Email me a magic link" }).click();
	await expect(login.getByText(/Check your inbox/)).toBeVisible();
	await completeSupabaseSignIn(page);
	await expect(login.getByText("Sign-in link has expired")).toBeVisible();
	await expect(login).toHaveAttribute("data-onboarding-state", "login");
	await expect(login.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
	await login.getByRole("button", { name: "Email me a magic link" }).click();
	await expect(login.getByText(/Check your inbox/)).toBeVisible();
	await expect(login.getByText("Sign-in link has expired")).toHaveCount(0);
});

for (const [label, provider] of [
	["Google", "google"],
	["Microsoft", "azure"],
	["GitHub", "github"],
]) {
	test(`${label} sign-in opens Supabase OAuth in the system browser`, async ({ page }) => {
		await installDesktopBridge(page, "preview.mp4", { signedIn: false });
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
		expect(url.searchParams.get("redirect_to")).toBe("http://127.0.0.1:43821/auth/callback");
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
	const account = page.getByRole("dialog", { name: "Your account", exact: true });
	await expect(account.getByText("test@email.com")).toBeVisible();
	await expect(account.locator('img[src$="login-banner.png"]')).toBeVisible();
	const logout = page.waitForRequest((request) => request.url().includes("/auth/v1/logout"));
	await account.getByRole("button", { name: "Sign out", exact: true }).click();
	await logout;
	const login = page.locator('[data-onboarding-state="login"]');
	await expect(login).toBeVisible();
	await page.reload();
	await expect(login).toBeVisible();
	await expect(login.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
});

test("sign-in banner fills spare space and keeps the email action usable in a short window", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page, "preview.mp4", { signedIn: false });
	await page.goto("/?windowType=editor");
	const login = page.getByRole("dialog", { name: "Welcome to Recordly" });
	const banner = login.locator("[data-onboarding-artwork]");
	const submit = login.getByRole("button", { name: "Email me a magic link" });
	const pages = login.getByRole("navigation", { name: "Onboarding pages" });
	await login.getByRole("textbox", { name: /^Email\*?$/ }).fill("owner@example.test");
	await expect(submit).toBeVisible();
	const tallBanner = (await banner.boundingBox())!;
	expect(tallBanner.height).toBeGreaterThan(128);
	const submitBounds = (await submit.boundingBox())!;
	const navigationBounds = (await pages.boundingBox())!;
	expect(navigationBounds.y - submitBounds.y - submitBounds.height).toBeLessThanOrEqual(48);
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
	await expect(login.getByText(/Check your inbox/)).toBeVisible();
	await page.screenshot({ path: "test-results/required-sign-in.png", animations: "disabled" });
});
