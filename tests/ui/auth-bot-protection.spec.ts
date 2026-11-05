import { expect, type Page } from "@playwright/test";
import { productionTest as test } from "./production";
import { installDesktopBridge } from "./bridge";

const frameSelector = 'iframe[title="Recordly security check"]';
const submit = (page: Page) => page.locator('[data-signin-form] button[type="submit"]');

// Emit only from a test-owned frame. No real CAPTCHA provider or email is used.
async function emitFrameEvent(page: Page, status: string, token?: string) {
	await page
		.frameLocator(frameSelector)
		.locator("body")
		.evaluate(
			(_, data) => {
				const params = new URLSearchParams(location.search);
				parent.postMessage(
					{
						type: "recordly-auth-challenge",
						requestId: params.get("request"),
						...data,
					},
					params.get("parent")!,
				);
			},
			{ status, token },
		);
}

async function expectCollapsed(page: Page) {
	await expect(page.locator("[data-auth-challenge]")).toHaveCSS("height", "0px");
	await expect(page.locator(frameSelector)).toHaveCSS("height", "0px");
	await expect(page.locator(frameSelector)).toHaveAttribute("aria-hidden", "true");
}

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.route("**/cloud/config", (route) =>
		route.fulfill({
			headers: { "Access-Control-Allow-Origin": "*" },
			json: { authCaptcha: { enabled: true } },
		}),
	);
	await page.route("**/cloud/challenge?**", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><body>Test-owned challenge frame</body>",
		}),
	);
});

async function openEmail(page: Page) {
	await page.goto("/?windowType=onboarding");
	await page.getByPlaceholder("you@example.com").fill("test@email.com");
}

test("starts checking only on submit, ignores forged results, and sends once automatically", async ({
	page,
}) => {
	let configurations = 0;
	let emails = 0;
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/cloud/config") configurations++;
		if (new URL(request.url()).pathname === "/auth/v1/otp") emails++;
	});
	await openEmail(page);
	await expect(
		page.getByRole("button", { name: "Continue with Google", exact: true }),
	).toBeEnabled();
	await expect(page.locator(frameSelector)).toHaveCount(0);
	await expect(page.getByRole("alert")).toHaveCount(0);
	expect(configurations).toBe(0);
	await expect(submit(page)).toBeEnabled();
	await submit(page).click();
	await expectCollapsed(page);
	await expect(submit(page)).toBeDisabled();
	const source = await page.locator(frameSelector).getAttribute("src");
	for (const status of ["interactive", "verified"]) {
		await page.evaluate(
			({ src, status }) => {
				const url = new URL(src!);
				window.postMessage(
					{
						type: "recordly-auth-challenge",
						requestId: url.searchParams.get("request"),
						status,
						token: "forged",
					},
					location.origin,
				);
			},
			{ src: source, status },
		);
	}
	await expectCollapsed(page);
	expect(emails).toBe(0);
	await page.getByPlaceholder("you@example.com").press("Enter");
	const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/auth/v1/otp");
	await emitFrameEvent(page, "verified", "test-one-use-token");
	expect((await request).postDataJSON().gotrue_meta_security.captcha_token).toBe(
		"test-one-use-token",
	);
	await expect(page.getByText("Enter code sent to test@email.com")).toBeVisible();
	await expect(page.locator(frameSelector)).toHaveCount(0);
	expect(emails).toBe(1);
	await expect(page.getByRole("button", { name: /Resend in/ })).toBeDisabled();
});

test("shows interaction only when requested and keeps the form in view", async ({ page }) => {
	await page.setViewportSize({ width: 600, height: 600 });
	await openEmail(page);
	await submit(page).click();
	await emitFrameEvent(page, "interactive");
	await expect(page.locator(frameSelector)).toBeVisible();
	await expect(page.locator(frameSelector)).toHaveCSS("height", "72px");
	await expect(page.locator(frameSelector)).toHaveAttribute("aria-hidden", "false");
	await expect(submit(page)).toBeDisabled();
	for (const size of [
		{ width: 600, height: 600 },
		{ width: 390, height: 600 },
		{ width: 450, height: 450 },
	]) {
		await page.setViewportSize(size);
		await expect(submit(page)).toBeInViewport({ ratio: 1 });
		await expect(page.locator(frameSelector)).toBeInViewport({ ratio: 1 });
		await expect(page.locator(".pricing-legal-consent")).toBeInViewport({ ratio: 1 });
		await expect
			.poll(() =>
				page
					.locator("[data-onboarding-body]")
					.evaluate((e) => e.scrollHeight - e.clientHeight),
			)
			.toBeLessThanOrEqual(1);
	}
	await emitFrameEvent(page, "background");
	await expectCollapsed(page);
	await emitFrameEvent(page, "verified", "test-one-use-token");
	await expect(page.getByText("Enter code sent to test@email.com")).toBeVisible();
});

test("failure sends no email and retry resumes the original submission", async ({ page }) => {
	let emails = 0;
	page.on("request", (r) => {
		if (new URL(r.url()).pathname === "/auth/v1/otp") emails++;
	});
	await openEmail(page);
	await submit(page).click();
	await emitFrameEvent(page, "error");
	await expect(page.getByText("The security check couldn’t load. Try again.")).toBeVisible();
	await expect(page.locator(frameSelector)).toHaveCount(0);
	expect(emails).toBe(0);
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await expectCollapsed(page);
	await emitFrameEvent(page, "verified", "retry-token");
	await expect(page.getByText("Enter code sent to test@email.com")).toBeVisible();
	expect(emails).toBe(1);
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("retry cannot forget a previously required check when configuration is unavailable", async ({
	page,
}) => {
	let emails = 0;
	page.on("request", (r) => {
		if (new URL(r.url()).pathname === "/auth/v1/otp") emails++;
	});
	await openEmail(page);
	await submit(page).click();
	await emitFrameEvent(page, "error");
	await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
	await page.route("**/cloud/config", (route) =>
		route.fulfill({ status: 503, body: "unavailable" }),
	);
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(page.getByText("The security check couldn’t load. Try again.")).toBeVisible();
	await expect(submit(page)).toBeEnabled();
	expect(emails).toBe(0);
	await expect(page.locator(frameSelector)).toHaveCount(0);
});

test("editing email after failure discards the previous pending submission", async ({ page }) => {
	await openEmail(page);
	await submit(page).click();
	await emitFrameEvent(page, "error");
	await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
	await page.getByPlaceholder("you@example.com").fill("changed@example.test");
	await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
	await submit(page).click();
	const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/auth/v1/otp");
	await emitFrameEvent(page, "verified", "changed-token");
	expect((await request).postDataJSON().email).toBe("changed@example.test");
	await expect(page.getByText("Enter code sent to changed@example.test")).toBeVisible();
});

test("password sign-in also starts its check on submit and forwards the verified token", async ({
	page,
}) => {
	await page.setViewportSize({ width: 600, height: 600 });
	await openEmail(page);
	await page.getByRole("button", { name: "Or use password to sign in", exact: true }).click();
	await page.getByLabel("Password", { exact: true }).fill("test-only-password");
	await expect(page.locator(frameSelector)).toHaveCount(0);
	await submit(page).click();
	await expectCollapsed(page);
	await emitFrameEvent(page, "interactive");
	await expect(page.locator(frameSelector)).toBeInViewport({ ratio: 1 });
	await expect(submit(page)).toBeInViewport({ ratio: 1 });
	await expect(page.locator(".pricing-legal-consent")).toBeInViewport({ ratio: 1 });
	const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/auth/v1/token");
	await emitFrameEvent(page, "verified", "password-token");
	expect((await request).postDataJSON().gotrue_meta_security.captcha_token).toBe(
		"password-token",
	);
	await expect(page.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
});

test("resending starts a fresh check only after its button is clicked", async ({ page }) => {
	await page.clock.install();
	await openEmail(page);
	await submit(page).click();
	await emitFrameEvent(page, "verified", "first-token");
	await expect(page.getByText("Enter code sent to test@email.com")).toBeVisible();
	await page.clock.fastForward(60000);
	await expect(page.locator(frameSelector)).toHaveCount(0);
	await page.getByRole("button", { name: "Resend code", exact: true }).click();
	await expectCollapsed(page);
	const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/auth/v1/otp");
	await emitFrameEvent(page, "verified", "resend-token");
	expect((await request).postDataJSON().gotrue_meta_security.captcha_token).toBe("resend-token");
	await expect(page.locator(frameSelector)).toHaveCount(0);
});
