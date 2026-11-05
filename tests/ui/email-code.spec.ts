import { expect } from "@playwright/test";
import { productionTest as test } from "./production";
import { installDesktopBridge } from "./bridge";

test("email code verification recovers from expiry without changing the target address", async ({
	page,
}) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.goto("/?windowType=onboarding");
	const dialog = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await dialog.getByLabel("Email", { exact: true }).fill("test@email.com");
	await dialog.getByRole("button", { name: "Email me a code", exact: true }).click();
	await expect(
		dialog.getByText("Enter code sent to test@email.com", { exact: true }),
	).toBeVisible();
	await expect(dialog.getByLabel("Email", { exact: true })).toHaveCount(0);
	await expect(dialog.getByRole("button", { name: /Resend in/ })).toBeDisabled();
	const slots = dialog.locator('[data-slot="input-otp-slot"]');
	await expect(slots).toHaveCount(6);
	await dialog.getByLabel("Enter code sent to test@email.com", { exact: true }).fill("12345");
	await expect(slots).toHaveText(["1", "2", "3", "4", "5", ""]);
	await dialog.getByLabel("Enter code sent to test@email.com", { exact: true }).press("Backspace");
	await expect(slots).toHaveText(["1", "2", "3", "4", "", ""]);
	await expect(
		dialog.getByRole("button", { name: "Verify and continue", exact: true }),
	).toBeDisabled();
	await page.route("https://auth.recordly.test/auth/v1/verify", (route) =>
		route.fulfill({
			status: 403,
			json: { message: "Token has expired or is invalid", error_code: "otp_expired" },
		}),
	);
	await dialog.getByLabel("Enter code sent to test@email.com", { exact: true }).fill("000000");
	await dialog.getByRole("button", { name: "Verify and continue", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("That code is invalid or has expired.");
	await expect(dialog).toHaveAttribute("data-onboarding-state", "login");
	await page.unroute("https://auth.recordly.test/auth/v1/verify");
	const codeInput = dialog.getByLabel("Enter code sent to test@email.com", { exact: true });
	await codeInput.press("ControlOrMeta+a");
	await codeInput.evaluate((input) => {
		const clipboard = new DataTransfer();
		clipboard.setData("text/plain", "123 456");
		input.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: clipboard,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await expect(codeInput).toHaveValue("123456");
	await expect(slots).toHaveText(["1", "2", "3", "4", "5", "6"]);
	const verify = page.waitForRequest((request) => request.url().includes("/auth/v1/verify"));
	await dialog.getByRole("button", { name: "Verify and continue", exact: true }).click();
	expect((await verify).postDataJSON()).toMatchObject({
		email: "test@email.com",
		token: "123456",
		type: "email",
	});
	await expect(dialog).toHaveAttribute("data-onboarding-state", "permissions");
});

test("password sign-in remains optional alongside email codes", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4", { signedIn: false, onboarded: false });
	await page.goto("/?windowType=onboarding");
	const dialog = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await dialog.getByRole("button", { name: "Or use password to sign in", exact: true }).click();
	await dialog.getByLabel("Email", { exact: true }).fill("test@email.com");
	await dialog.getByLabel("Password", { exact: true }).fill("test-only-password");
	await expect(dialog.getByText(/Forgot your password/)).toBeVisible();
	const request = page.waitForRequest((req) => req.url().includes("/auth/v1/token"));
	await dialog.getByRole("button", { name: "Sign in with password", exact: true }).click();
	expect(new URL((await request).url()).searchParams.get("grant_type")).toBe("password");
	await expect(dialog).toHaveAttribute("data-onboarding-state", "permissions");
});
