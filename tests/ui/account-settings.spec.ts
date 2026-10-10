import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function openAccountSettings(page: Page) {
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("row", { name: "Account", exact: true }).click();
	return page.getByRole("region", { name: "Account settings", exact: true });
}

test("account settings save the Supabase profile and share it with the dashboard", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	let account = await openAccountSettings(page);
	await expect(account.getByLabel("Display name", { exact: true })).toHaveValue("Test User");
	await expect(account.getByRole("list", { name: "Connected sign-in methods" })).toHaveText(
		"Email magic link",
	);
	await expect(account.getByRole("button", { name: "Save profile" })).toBeDisabled();
	await account.getByLabel("Display name", { exact: true }).fill("  Jordan Chen  ");
	const update = page.waitForRequest(
		(request) => request.method() === "PUT" && request.url().includes("/auth/v1/user"),
	);
	await account.getByRole("button", { name: "Save profile" }).click();
	expect((await update).postDataJSON().data).toEqual({ full_name: "Jordan Chen" });
	await expect(account.getByRole("status")).toHaveText("Profile saved.");
	await expect(account.getByLabel("Display name", { exact: true })).toHaveValue("Jordan Chen");
	await expect(
		page
			.getByRole("button", { name: "Recordly account", exact: true })
			.locator('[aria-label="Jordan Chen"]'),
	).toBeVisible();
	await page.reload();
	account = await openAccountSettings(page);
	await expect(account.getByLabel("Display name", { exact: true })).toHaveValue("Jordan Chen");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const dashboard = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await dashboard.getByRole("button", { name: "Settings", exact: true }).click();
	await dashboard.getByRole("row", { name: "Account", exact: true }).click();
	await expect(dashboard.getByLabel("Display name", { exact: true })).toHaveValue("Jordan Chen");
	await page.screenshot({
		path: "test-results/dashboard-account-settings.png",
		animations: "disabled",
	});
});

test("email changes use a PKCE confirmation and retain the current email until confirmed", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const account = await openAccountSettings(page);
	const change = account.getByRole("button", { name: "Change email", exact: true });
	await expect(change).toBeDisabled();
	await account.getByLabel("Email address", { exact: true }).fill("invalid@example");
	await expect(change).toBeDisabled();
	await account.getByLabel("Email address", { exact: true }).fill("new@example.com");
	const update = page.waitForRequest(
		(request) => request.method() === "PUT" && request.url().includes("/auth/v1/user"),
	);
	await change.click();
	const request = await update;
	expect(request.postDataJSON()).toMatchObject({
		email: "new@example.com",
		code_challenge: expect.any(String),
		code_challenge_method: "s256",
	});
	expect(new URL(request.url()).searchParams.get("redirect_to")).toBe(
		"http://127.0.0.1:43821/auth/callback",
	);
	await expect(account.getByText("test@email.com", { exact: true })).toBeVisible();
	await expect(account.getByText("Awaiting confirmation: new@example.com")).toBeVisible();
	await expect(
		account.getByText("Check your current and new inboxes for confirmation instructions."),
	).toBeVisible();
	await expect(change).toBeDisabled();
	await page.reload();
	const restored = await openAccountSettings(page);
	await expect(restored.getByLabel("Email address", { exact: true })).toHaveValue(
		"test@email.com",
	);
	await expect(restored.getByText("Awaiting confirmation: new@example.com")).toBeVisible();
});

test("account update errors preserve the session and allow retry", async ({ page }) => {
	await installDesktopBridge(page);
	let failed = false;
	await page.route("https://auth.recordly.test/auth/v1/user**", async (route) => {
		if (route.request().method() !== "PUT" || failed) return route.fallback();
		failed = true;
		return route.fulfill({
			status: 429,
			json: { msg: "Please wait before updating your profile." },
		});
	});
	await page.goto("/?windowType=editor");
	const account = await openAccountSettings(page);
	await account.getByLabel("Display name", { exact: true }).fill("New Name");
	await account.getByRole("button", { name: "Save profile" }).click();
	await expect(account.getByRole("alert")).toHaveText(
		"Please wait before updating your profile.",
	);
	await expect(account.getByLabel("Display name", { exact: true })).toHaveValue("New Name");
	await account.getByRole("button", { name: "Save profile" }).click();
	await expect(account.getByRole("status")).toHaveText("Profile saved.");
	await expect(account.getByRole("alert")).toHaveCount(0);
});

test("signing out from Settings clears the session and brings back required sign-in", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const account = await openAccountSettings(page);
	const logout = page.waitForRequest((request) => request.url().includes("/auth/v1/logout"));
	await account.getByRole("button", { name: "Sign out", exact: true }).click();
	expect(new URL((await logout).url()).searchParams.get("scope")).toBe("global");
	await expect(page.locator('[data-onboarding-state="login"]')).toBeVisible();
	await page.reload();
	await expect(page.locator('[data-onboarding-state="login"]')).toBeVisible();
});

test("Settings refreshes macOS permissions and opens the permissions carousel", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
			success: true,
			status: document.documentElement.dataset.allowed === "true" ? "granted" : "denied",
		});
		window.electronAPI.getAccessibilityPermissionStatus = async () => ({
			success: true,
			trusted: document.documentElement.dataset.allowed === "true",
			prompted: false,
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("row", { name: "Permissions", exact: true }).click();
	const permissions = page.getByRole("region", { name: "Permissions settings", exact: true });
	await expect(permissions.getByText("Required", { exact: true })).toHaveCount(2);
	await page.evaluate(() => {
		document.documentElement.dataset.allowed = "true";
	});
	await permissions.getByRole("button", { name: "Check again", exact: true }).click();
	await expect(permissions.getByText("Allowed", { exact: true })).toHaveCount(2);
	await permissions.getByRole("button", { name: "Review permissions", exact: true }).click();
	const tour = page.getByRole("dialog", { name: "Welcome to Recordly" });
	await expect(tour).toHaveAttribute("data-onboarding-state", "permissions");
	await expect(tour.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
});
