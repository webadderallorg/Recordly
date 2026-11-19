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

async function expectSignInControlsReachable(page: Page, passwordMode = false) {
	const body = page.locator("[data-onboarding-body]");
	const consent = page.locator(".pricing-legal-consent");
	// Resize can animate the dialog; inspect the settled scrollport inside the window.
	await expect
		.poll(() => body.evaluate((node) => node.getBoundingClientRect().bottom <= innerHeight + 1))
		.toBe(true);
	const initial = await body.evaluate((node) => ({
		scrollTop: node.scrollTop,
		scrollHeight: node.scrollHeight,
		clientHeight: node.clientHeight,
		overflowY: getComputedStyle(node).overflowY,
	}));
	const wheel = async (delta: number) => {
		const box = (await body.boundingBox())!;
		await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
		await page.mouse.wheel(0, delta);
	};
	const scrollToBottom = async () => {
		await expect
			.poll(async () => {
				const remaining = await body.evaluate(
					(node) => node.scrollHeight - node.clientHeight - node.scrollTop,
				);
				if (remaining > 1) await wheel(initial.scrollHeight);
				return remaining;
			})
			.toBeLessThanOrEqual(1);
	};
	if (initial.scrollHeight - initial.clientHeight > 1) {
		expect(["auto", "scroll"]).toContain(initial.overflowY);
		// Use real wheel input in both directions, rather than setting scrollTop or
		// letting locator actions scroll a potentially clipped parent for us.
		await expect
			.poll(async () => {
				const top = await body.evaluate((node) => node.scrollTop);
				if (top > 0) await wheel(-initial.scrollHeight);
				return top;
			})
			.toBe(0);
		await scrollToBottom();
		await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
	}
	await expect(consent).toBeInViewport({ ratio: 1 });
	const consentBounds = (await consent.boundingBox())!;
	const port = (await body.boundingBox())!;
	expect(consentBounds.y).toBeGreaterThanOrEqual(port.y - 1);
	expect(consentBounds.y + consentBounds.height).toBeLessThanOrEqual(port.y + port.height + 1);
	for (const [name, href] of [
		["Terms", /\/terms$/],
		["Privacy Policy", /\/privacy$/],
	] as const) {
		const link = consent.getByRole("link", { name, exact: true });
		await expect(link).toHaveAttribute("href", href);
		await link.click({ trial: true });
	}
	const challenge = page.locator(frameSelector);
	const controls = [
		page.getByPlaceholder("you@example.com"),
		...(passwordMode ? [page.getByLabel("Password", { exact: true })] : []),
		challenge,
		submit(page),
	];
	const controlBounds = [];
	for (const control of controls) {
		for (let attempt = 0; attempt < 5; attempt++) {
			const scrollport = (await body.boundingBox())!;
			const target = (await control.boundingBox())!;
			const delta =
				target.y < scrollport.y
					? target.y - scrollport.y - 2
					: target.y + target.height > scrollport.y + scrollport.height
						? target.y + target.height - scrollport.y - scrollport.height + 2
						: 0;
			if (!delta) break;
			const previous = await body.evaluate((node) => node.scrollTop);
			await wheel(delta);
			await expect.poll(() => body.evaluate((node) => node.scrollTop)).not.toBe(previous);
		}
		await expect(control).toBeVisible();
		await expect(control).toBeInViewport({ ratio: 1 });
		const scrollport = (await body.boundingBox())!;
		const target = (await control.boundingBox())!;
		expect(target.y).toBeGreaterThanOrEqual(scrollport.y - 1);
		expect(target.y + target.height).toBeLessThanOrEqual(scrollport.y + scrollport.height + 1);
		if (control === challenge) {
			await page.frameLocator(frameSelector).locator("body").click({ trial: true });
		} else await expect(control).toBeDisabled();
		controlBounds.push(target);
	}
	// The real security check intentionally locks submission until verification.
	await expect(submit(page)).toBeDisabled();
	await scrollToBottom();
	await expect(consent).toBeInViewport({ ratio: 1 });
	return { viewport: page.viewportSize(), initial, consentBounds, controlBounds };
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

test("shows interaction only when requested and keeps the form in view", async ({
	page,
}, testInfo) => {
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
		const geometry = await expectSignInControlsReachable(page);
		await testInfo.attach(`email-scroll-${size.width}x${size.height}`, {
			body: JSON.stringify(geometry),
			contentType: "application/json",
		});
		await page.screenshot({
			path: testInfo.outputPath(`email-consent-${size.width}x${size.height}.png`),
		});
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
}, testInfo) => {
	await page.setViewportSize({ width: 600, height: 600 });
	await openEmail(page);
	await page.getByRole("button", { name: "Or use password to sign in", exact: true }).click();
	await page.getByLabel("Password", { exact: true }).fill("test-only-password");
	await expect(page.locator(frameSelector)).toHaveCount(0);
	await submit(page).click();
	await expectCollapsed(page);
	await emitFrameEvent(page, "interactive");
	const geometry = await expectSignInControlsReachable(page, true);
	await testInfo.attach("password-scroll-600x600", {
		body: JSON.stringify(geometry),
		contentType: "application/json",
	});
	await page.screenshot({ path: testInfo.outputPath("password-consent-600x600.png") });
	const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/auth/v1/token");
	await emitFrameEvent(page, "verified", "password-token");
	expect((await request).postDataJSON().gotrue_meta_security.captcha_token).toBe(
		"password-token",
	);
	await expect(page.getByRole("heading", { name: "Allow Recordly to record" })).toBeVisible();
});

test("a rejected password stays available for a protected retry without retyping", async ({
	page,
}) => {
	let rejectPassword = true;
	await page.route("https://auth.recordly.test/auth/v1/token**", async (route) => {
		if (rejectPassword) {
			rejectPassword = false;
			return route.fulfill({
				status: 400,
				json: { error: "invalid_grant", error_description: "Invalid login credentials" },
			});
		}
		return route.fallback();
	});
	await openEmail(page);
	await page.getByRole("button", { name: "Or use password to sign in", exact: true }).click();
	const password = page.getByLabel("Password", { exact: true });
	await password.fill("test-only-password");
	await submit(page).click();
	await emitFrameEvent(page, "verified", "rejected-password-token");
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(password).toHaveValue("test-only-password");
	await expect(submit(page)).toBeEnabled();
	await submit(page).click();
	const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/auth/v1/token");
	await emitFrameEvent(page, "verified", "retry-password-token");
	expect((await request).postDataJSON().password).toBe("test-only-password");
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
