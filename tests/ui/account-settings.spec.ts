import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function openAppSettings(page: Page) {
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	return page.getByRole("dialog", { name: "Settings", exact: true });
}

async function openAccountSettings(page: Page) {
	const settings = await openAppSettings(page);
	await settings.getByRole("tab", { name: "Account", exact: true }).click();
	return settings.getByRole("tabpanel", { name: /^Account settings/ });
}

test("account settings save the Supabase profile and share it with the dashboard", async ({
	page,
}) => {
	// Cover cold startup, profile persistence after reload, and dashboard propagation.
	test.setTimeout(60_000);
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	let account = await openAccountSettings(page);
	await expect(account.getByRole("textbox", { name: /^Display name\*?$/ })).toHaveValue(
		"Test User",
	);
	await expect(account.getByRole("list", { name: "Connected sign-in methods" })).toHaveText(
		"Email code",
	);
	await expect(account.getByRole("button", { name: "Save profile" })).toBeDisabled();
	await account.getByRole("textbox", { name: /^Display name\*?$/ }).fill("  Jordan Chen  ");
	const update = page.waitForRequest(
		(request) => request.method() === "PUT" && request.url().includes("/auth/v1/user"),
	);
	await account.getByRole("button", { name: "Save profile" }).click();
	expect((await update).postDataJSON().data).toEqual({ full_name: "Jordan Chen" });
	await expect(
		account.getByRole("form", { name: "Profile settings", exact: true }).getByRole("status"),
	).toHaveText("Profile saved.");
	await expect(account.getByRole("textbox", { name: /^Display name\*?$/ })).toHaveValue(
		"Jordan Chen",
	);
	await page
		.getByRole("dialog", { name: "Settings", exact: true })
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await expect(
		page
			.getByRole("button", { name: "Recordly account", exact: true })
			.locator('[aria-label="Jordan Chen"]'),
	).toBeVisible();
	await page.reload();
	account = await openAccountSettings(page);
	await expect(account.getByRole("textbox", { name: /^Display name\*?$/ })).toHaveValue(
		"Jordan Chen",
	);
	await page
		.getByRole("dialog", { name: "Settings", exact: true })
		.getByRole("button", { name: "Close", exact: true })
		.click();
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const dashboard = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await dashboard.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Settings", exact: true })
		.click();
	await dashboard.getByRole("tab", { name: "Account", exact: true }).click();
	await expect(dashboard.getByRole("textbox", { name: /^Display name\*?$/ })).toHaveValue(
		"Jordan Chen",
	);
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
	await account.getByRole("textbox", { name: /^Email address\*?$/ }).fill("invalid@example");
	await expect(change).toBeDisabled();
	await account.getByRole("textbox", { name: /^Email address\*?$/ }).fill("new@example.com");
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
	// Feedback belongs to the action that produced it. Saving a profile must not
	// dismiss the still-pending email change or its confirmation instructions.
	const profileForm = account.getByRole("form", { name: "Profile settings" });
	const emailForm = account.getByRole("form", { name: "Email settings" });
	await profileForm.getByRole("textbox", { name: /^Display name\*?$/ }).fill("New Name");
	await profileForm.getByRole("button", { name: "Save profile" }).click();
	await expect(profileForm.getByRole("status")).toHaveText("Profile saved.");
	await expect(emailForm.getByText("Awaiting confirmation: new@example.com")).toBeVisible();
	await expect(
		emailForm.getByText("Check your current and new inboxes for confirmation instructions."),
	).toBeVisible();
	await page.reload();
	const restored = await openAccountSettings(page);
	await expect(restored.getByRole("textbox", { name: /^Email address\*?$/ })).toHaveValue(
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
	await account.getByRole("textbox", { name: /^Display name\*?$/ }).fill("New Name");
	await account.getByRole("button", { name: "Save profile" }).click();
	await expect(
		account.getByRole("form", { name: "Profile settings", exact: true }).getByRole("alert"),
	).toContainText("Please wait before updating your profile.");
	await expect(account.getByRole("textbox", { name: /^Display name\*?$/ })).toHaveValue(
		"New Name",
	);
	await account.getByRole("button", { name: "Save profile" }).click();
	await expect(
		account.getByRole("form", { name: "Profile settings", exact: true }).getByRole("status"),
	).toHaveText("Profile saved.");
	await expect(
		account.getByRole("form", { name: "Profile settings", exact: true }).getByRole("alert"),
	).toHaveCount(0);
});

test("signing out from Settings clears the session and brings back required sign-in", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const account = await openAccountSettings(page);
	const logout = page.waitForRequest((request) => request.url().includes("/auth/v1/logout"));
	await account.getByRole("button", { name: "Sign out of all devices", exact: true }).click();
	expect(new URL((await logout).url()).searchParams.get("scope")).toBe("global");
	await expect(
		page.getByRole("dialog", { name: "Sign in to Recordly", exact: true }),
	).toBeVisible();
	await page.reload();
	await expect(
		page.getByRole("dialog", { name: "Sign in to Recordly", exact: true }),
	).toBeVisible();
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
	const settings = await openAppSettings(page);
	await settings.getByRole("tab", { name: "Recording", exact: true }).click();
	const permissions = settings.getByRole("tabpanel", {
		name: /^Recording settings/,
	});
	const permissionRow = (title: string) =>
		permissions
			.locator(".settings-row")
			.filter({ has: page.getByText(title, { exact: true }) });
	await expect(permissionRow("Screen Recording").getByRole("status")).toHaveText("Not allowed");
	await expect(permissionRow("Accessibility").getByRole("status")).toHaveText("Required");
	await expect(permissionRow("Microphone").getByRole("status")).toHaveText("Not requested");
	await expect(permissionRow("Camera").getByRole("status")).toHaveText("Not allowed");
	await expect(
		permissions.getByRole("button", {
			name: "Open System Settings: Screen Recording",
			exact: true,
		}),
	).toBeVisible();
	await page.evaluate(() => {
		document.documentElement.dataset.allowed = "true";
	});
	await permissions.getByRole("button", { name: "Check again", exact: true }).click();
	await expect(permissionRow("Screen Recording").getByRole("status")).toHaveText("Allowed");
	await expect(permissionRow("Accessibility").getByRole("status")).toHaveText("Allowed");
	await expect(permissionRow("Camera").getByRole("status")).toHaveText("Not allowed");
	await permissions.getByRole("button", { name: "Review permission setup", exact: true }).click();
	const tour = page.getByRole("dialog", { name: "Permissions", exact: true });
	await expect(tour).toBeVisible();
	await expect(tour).toHaveAttribute("data-recording-permissions", "true");
	await expect(tour.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
});

test("optional passwords validate confirmation and clear sensitive inputs after saving", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const account = await openAccountSettings(page);
	const form = account.getByRole("form", { name: "Password (optional)", exact: true });
	await form.getByLabel("New password", { exact: true }).fill("test-only-password");
	await form.getByLabel("Confirm password", { exact: true }).fill("different-password");
	await form.getByRole("button", { name: "Save password", exact: true }).click();
	await expect(form.getByRole("alert")).toHaveText("Passwords do not match.");
	await form.getByLabel("Confirm password", { exact: true }).fill("test-only-password");
	const update = page.waitForRequest(
		(request) => request.url().includes("/auth/v1/user") && request.method() === "PUT",
	);
	await form.getByRole("button", { name: "Save password", exact: true }).click();
	expect((await update).postDataJSON()).toMatchObject({ password: "test-only-password" });
	await expect(form.getByRole("status")).toHaveText("Password saved.");
	await expect(form.getByLabel("New password", { exact: true })).toHaveValue("");
	await expect(form.getByLabel("Confirm password", { exact: true })).toHaveValue("");
});
