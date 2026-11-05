import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SUPPORTED_LOCALES } from "../../src/i18n/config";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const locale of SUPPORTED_LOCALES) {
	const messages = JSON.parse(
		readFileSync(
			new URL(`../../src/i18n/locales/${locale}/onboarding.json`, import.meta.url),
			"utf8",
		),
	) as Record<string, string>;

	test(`onboarding and permission recovery use ${locale}`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await installDesktopBridge(page, "preview.mp4", { signedIn: false });
		await page.addInitScript(
			(language) => localStorage.setItem("recordly.locale", language),
			locale,
		);
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
				success: true,
				status: "denied",
			});
			window.electronAPI.openScreenRecordingPreferences = async () => ({
				success: false,
				error: "Untranslated native error",
			});
		});
		await page.goto("/?windowType=onboarding&onboardingPreview=1");
		const dialog = page.getByRole("dialog", { name: messages.welcomeLabel });
		await expect(dialog).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("lang", locale);
		await expect(dialog.getByRole("heading")).toHaveText(
			messages.welcomeTitle.replace("{{brand}}", "Recordly"),
		);
		await expect(dialog.locator(".onboarding-header .description")).toHaveCount(0);
		await expect(
			dialog
				.getByRole("button", { name: messages.muteMusic, exact: true })
				.or(dialog.getByRole("button", { name: messages.unmuteMusic, exact: true })),
		).toBeVisible();
		await expect(dialog.getByLabel(messages.email, { exact: true })).toBeVisible();
		await expect(
			dialog.getByRole("button", {
				name: messages.continueWith.replace("{{provider}}", "Google"),
			}),
		).toBeVisible();
		await dialog.getByLabel(messages.email, { exact: true }).fill("locale@example.com");
		await dialog.getByRole("button", { name: messages.sendLink, exact: true }).click();
		await expect(
			dialog.getByText(messages.checkInbox.replace("{{email}}", "locale@example.com"), {
				exact: true,
			}),
		).toBeVisible();
		await dialog.getByRole("button", { name: messages.continue, exact: true }).click();
		await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(
			messages.allowTitle.replace("{{brand}}", "Recordly"),
		);
		await expect(dialog.getByText(messages.screenDescription, { exact: true })).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: messages.simulatePermissions, exact: true }),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: messages.skipOnboarding, exact: true }),
		).toBeVisible();
		await dialog
			.getByRole("button", {
				name: messages.allowPermission.replace("{{permission}}", messages.screen),
				exact: true,
			})
			.click();
		await expect(dialog.getByRole("alert")).toContainText(messages.permissionFailed);
		await expect(
			dialog.getByRole("button", { name: messages.startRecording, exact: true }),
		).toBeDisabled();
		await expect(
			dialog.getByRole("button", { name: messages.backToAccount, exact: true }),
		).toBeVisible();
		await expect(dialog.getByRole("navigation", { name: messages.pages })).toBeVisible();
		await expect(dialog).not.toContainText("Untranslated native error");
		await expect(dialog).not.toContainText("onboarding.");
		expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
			true,
		);
		await page.screenshot({ path: testInfo.outputPath(`onboarding-${locale}.png`) });
	});
}
