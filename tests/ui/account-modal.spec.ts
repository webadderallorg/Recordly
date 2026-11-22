import { expect, type Locator, type Page, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

async function openAccount(page: Page) {
	await page.getByRole("button", { name: "Recordly account", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Account menu", exact: true })
		.getByRole("button", { name: "Manage account", exact: true })
		.click();
	return page.getByRole("dialog", { name: "Account settings", exact: true });
}

async function styles(element: Locator, properties: string[]) {
	return element.evaluate((element, properties) => {
		const computed = getComputedStyle(element);
		return Object.fromEntries(
			properties.map((property) => [property, computed.getPropertyValue(property)]),
		);
	}, properties);
}

for (const theme of ["light", "dark"] as const) {
	test(`account modal matches shared Settings controls in ${theme} mode`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: theme });
		await installDesktopBridge(page);
		await page.goto("/?windowType=editor");
		const account = await openAccount(page);
		await expect(account).not.toHaveAttribute("data-entering");
		const type = ["font-family", "font-size", "font-weight", "line-height"];
		const control = [...type, "border-radius", "height", "padding-top", "padding-bottom"];
		const field = [
			"font-family",
			"font-size",
			"border-radius",
			"background-color",
			"box-shadow",
		];
		const navigation = [
			"font-size",
			"font-weight",
			"color",
			"background-color",
			"border-radius",
		];
		const modal = {
			surface: await styles(account, ["background-color", "border-radius"]),
			title: await styles(
				account.getByRole("heading", { name: "Account", exact: true }),
				type,
			),
			button: await styles(
				account.getByRole("button", { name: "Save profile", exact: true }),
				control,
			),
			field: await styles(account.getByRole("textbox", { name: /^Display name\*?$/ }), field),
			tab: await styles(
				account.getByRole("tab", { name: "Profile", exact: true }),
				navigation,
			),
		};
		await account.getByRole("tab", { name: "Sign-in methods", exact: true }).click();
		expect(await styles(account.getByLabel("New password", { exact: true }), field)).toEqual(
			modal.field,
		);
		expect(
			await styles(account.getByLabel("Confirm password", { exact: true }), field),
		).toEqual(modal.field);
		await account.getByRole("button", { name: "Close", exact: true }).click();
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		const settings = page.getByRole("dialog", { name: "Settings", exact: true });
		await expect(settings).not.toHaveAttribute("data-entering");
		await settings.getByRole("tab", { name: "Account", exact: true }).click();
		expect(modal.surface).toEqual(
			await styles(settings, ["background-color", "border-radius"]),
		);
		expect(modal.title).toEqual(
			await styles(settings.locator(".dashboard-settings-title"), type),
		);
		expect(modal.button).toEqual(
			await styles(
				settings.getByRole("button", { name: "Save profile", exact: true }),
				control,
			),
		);
		expect(modal.field).toEqual(
			await styles(settings.getByRole("textbox", { name: /^Display name\*?$/ }), field),
		);
		await expect
			.poll(() =>
				styles(settings.getByRole("tab", { name: "Account", exact: true }), navigation),
			)
			.toEqual(modal.tab);
	});
}

test("profile modal groups account tasks and retains drafts across tabs", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const account = await openAccount(page);
	const profile = account.getByRole("tab", { name: "Profile", exact: true });
	await expect(profile).toHaveAttribute("aria-selected", "true");
	const name = account.getByRole("textbox", { name: /^Display name\*?$/ });
	await expect(name).toHaveValue("Test User");
	const save = account.getByRole("button", { name: "Save profile", exact: true });
	const field = (await name.boundingBox())!;
	const button = (await save.boundingBox())!;
	expect(Math.abs(field.y + field.height - button.y - button.height)).toBeLessThan(1);
	await name.fill("Draft profile");
	await account.getByRole("tab", { name: "Sign-in methods", exact: true }).click();
	const email = account.getByRole("textbox", { name: /^Email address\*?$/ });
	await email.fill("draft@example.com");
	await account.getByRole("tab", { name: "Plan & billing", exact: true }).click();
	await expect(account.getByLabel("Cloud usage", { exact: true })).toBeVisible();
	await profile.click();
	await expect(name).toHaveValue("Draft profile");
	await save.click();
	await expect(account.getByRole("status")).toHaveText("Profile saved.");
	await account.screenshot({
		path: test.info().outputPath("account-profile.png"),
		animations: "disabled",
	});
	await account.getByRole("tab", { name: "Sign-in methods", exact: true }).click();
	await expect(email).toHaveValue("draft@example.com");
	await account.screenshot({
		path: test.info().outputPath("account-signin.png"),
		animations: "disabled",
	});
	const signin = account.getByRole("tab", { name: "Sign-in methods", exact: true });
	await signin.focus();
	await page.keyboard.press("ArrowRight");
	await expect(account.getByRole("tab", { name: "Plan & billing", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await account.screenshot({
		path: test.info().outputPath("account-cloud.png"),
		animations: "disabled",
	});
	await account.getByRole("button", { name: "Close", exact: true }).click();
	await expect(account).not.toBeVisible();
});

test("account modal keeps email confirmation and password validation working", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const account = await openAccount(page);
	await account.getByRole("tab", { name: "Sign-in methods", exact: true }).click();
	await account.getByRole("textbox", { name: /^Email address\*?$/ }).fill("new@example.com");
	await account.getByRole("button", { name: "Change email", exact: true }).click();
	await expect(account.getByText("Awaiting confirmation: new@example.com")).toBeVisible();
	const form = account.getByRole("form", { name: "Password (optional)", exact: true });
	await form.getByLabel("New password", { exact: true }).fill("test-only-password");
	await form.getByLabel("Confirm password", { exact: true }).fill("different-password");
	await form.getByRole("button", { name: "Save password", exact: true }).click();
	await expect(form.getByRole("alert")).toHaveText("Passwords do not match.");
	await form.getByLabel("Confirm password", { exact: true }).fill("test-only-password");
	await form.getByRole("button", { name: "Save password", exact: true }).click();
	await expect(form.getByRole("status")).toHaveText("Password saved.");
	await expect(form.getByLabel("New password", { exact: true })).toHaveValue("");
});

for (const theme of ["light", "dark"] as const) {
	for (const size of [
		{ width: 1280, height: 720 },
		{ width: 760, height: 560 },
		{ width: 390, height: 640 },
	]) {
		test(`account modal fits ${size.width}x${size.height} in ${theme} mode`, async ({
			page,
		}) => {
			await page.setViewportSize(size);
			await page.emulateMedia({ colorScheme: theme });
			await installDesktopBridge(page);
			await page.goto("/?windowType=editor");
			const account = await openAccount(page);
			const tabs = account.getByRole("tablist");
			await expect(tabs).toBeInViewport();
			for (const label of ["Profile", "Sign-in methods", "Plan & billing"]) {
				await account.getByRole("tab", { name: label, exact: true }).click();
				await expect(
					account.getByRole("button", { name: "Close", exact: true }),
				).toBeInViewport();
				expect(
					await account.evaluate((element) => element.scrollWidth <= element.clientWidth),
				).toBe(true);
				const panel = account.getByRole("tabpanel");
				expect(
					await panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
				).toBe(true);
				await expect(tabs).toBeInViewport();
			}
			await account.getByRole("tab", { name: "Profile", exact: true }).click();
			await page.screenshot({
				path: test.info().outputPath(`account-${theme}-${size.width}.png`),
				animations: "disabled",
			});
			await page.keyboard.press("Escape");
			await expect(account).not.toBeVisible();
		});
	}
}
