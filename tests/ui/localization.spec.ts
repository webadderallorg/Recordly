import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SUPPORTED_LOCALES } from "../../src/i18n/config";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

function catalog(locale: string, namespace: string) {
	return JSON.parse(
		readFileSync(
			new URL(`../../src/i18n/locales/${locale}/${namespace}.json`, import.meta.url),
			"utf8",
		),
	);
}
const languageNames = [
	"English",
	"Español",
	"Français",
	"Deutsch",
	"Italiano",
	"Nederlands",
	"한국어",
	"日本語",
	"Português (Brasil)",
	"简体中文",
	"繁體中文",
];

for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
	test(`language selection updates editor, settings, library and pricing in ${locale}`, async ({
		page,
	}, info) => {
		test.setTimeout(90000);
		await page.emulateMedia({ reducedMotion: "reduce" });
		const settings = catalog(locale, "settings");
		const ui = catalog(locale, "ui");
		const billing = catalog(locale, "billing");
		const common = catalog(locale, "common");
		const editor = catalog(locale, "editor");
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			let preferences = {
				success: true,
				showInDock: true,
				hideWhileRecording: false,
				launchAtLogin: false,
				launchAtLoginSupported: true,
				platform: "darwin",
			};
			window.electronAPI.getApplicationPreferences = async () => preferences;
			window.electronAPI.setApplicationPreferences = async (patch) => {
				preferences = { ...preferences, ...patch };
				return preferences;
			};
			window.electronAPI.setAppLocale = async (locale) => {
				document.documentElement.dataset.nativeLocale = locale;
				return true;
			};
		});
		await page.addInitScript(() => localStorage.setItem("recordly.locale", "en"));
		await page.goto("/?windowType=editor");
		await page.getByRole("button", { name: "Recordly account", exact: true }).click();
		await page
			.getByRole("dialog", { name: "Account menu", exact: true })
			.getByRole("button", { name: "Settings", exact: true })
			.click();
		// The selector itself remains stable while all surrounding text changes.
		await page.locator(".settings-language-trigger").click();
		const languageMenu = page.getByRole("listbox");
		await expect(languageMenu.getByRole("option")).toHaveCount(SUPPORTED_LOCALES.length);
		for (const name of languageNames) {
			await expect(
				languageMenu
					.getByRole("option", { name, exact: true })
					.locator("svg[data-country]"),
			).toHaveAttribute("aria-hidden", "true");
		}
		if (locale === "en" || locale === "ja") {
			await languageMenu.screenshot({ path: info.outputPath(`languages-${locale}.png`) });
		}
		await page.getByRole("option", { name: languageNames[index], exact: true }).click();
		await expect(page.locator(".settings-language-trigger svg[data-country]")).toBeVisible();
		await expect(page.locator(".settings-language-trigger")).toContainText(
			languageNames[index],
		);
		await expect(page.locator("html")).toHaveAttribute("lang", locale);
		await expect(page.locator("html")).toHaveAttribute("data-native-locale", locale);
		expect(
			await page.evaluate(async () => {
				const { translate } = await import("/src/contexts/I18nContext.tsx");
				return translate("common.actions.cancel");
			}),
		).toBe(common.actions.cancel);
		expect(await page.evaluate(() => localStorage.getItem("recordly.locale"))).toBe(locale);
		await expect(page.getByText(common.app.language, { exact: true }).first()).toBeVisible();
		await page
			.locator(".settings-language-field")
			.getByRole("button", { name: common.app.language, exact: true })
			.hover();
		await expect(page.getByRole("tooltip")).toHaveText(
			settings.appPreferences.languageDescription,
		);
		await page.mouse.move(0, 0);
		await expect(
			page.getByRole("tab", { name: settings.categories.general, exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("switch", { name: settings.application.showDock, exact: true }),
		).toBeVisible();
		const settingsDialog = page.getByRole("dialog", {
			name: settings.sections.settings,
			exact: true,
		});
		await settingsDialog.screenshot({ path: info.outputPath(`settings-${locale}.png`) });
		const selectedLanguage = page.locator(".settings-language-trigger .truncate");
		expect(
			await selectedLanguage.evaluate(
				(element) => element.scrollWidth <= element.clientWidth,
			),
		).toBe(true);
		const closeSettings = settingsDialog.locator('[data-slot="modal-close-trigger"]');
		await expect(closeSettings).toHaveAccessibleName(common.actions.close);
		await closeSettings.click();
		await expect(
			page.getByRole("button", { name: editor.project.renameTitle, exact: true }),
		).toHaveText("Untitled Project");
		await page.getByRole("button", { name: ui.home, exact: true }).click();
		const library = page.getByRole("dialog", { name: ui.projectsDashboard, exact: true });
		await expect(library).toBeVisible();
		await expect(
			library.getByRole("complementary", { name: ui.libraryNavigation }),
		).toBeVisible();
		const cloudLabel = billing.upgrade;
		const escapedCloudLabel = cloudLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const upgrade = library.getByRole("button", {
			name: new RegExp(`^${escapedCloudLabel}(?:, .+)?$`),
		});
		await expect(upgrade).toBeVisible();
		await expect(upgrade.getByText(cloudLabel, { exact: true })).toBeVisible();
		await upgrade.click();
		const pricing = page.getByRole("dialog", { name: "Recordly Cloud", exact: true });
		await expect(pricing).toBeVisible();
		const pricingHeading = pricing.getByRole("heading", { level: 2 });
		await expect(pricingHeading).toBeVisible();
		await expect(pricingHeading).toHaveText(billing.upgradeHeading);
		await expect(pricing.getByText(billing.intro, { exact: true })).toBeVisible();
		await expect(pricing).not.toContainText(/\b(?:ui|billing|settings)\.[a-zA-Z]/);
		await page.setViewportSize({ width: 440, height: 820 });
		await pricing.screenshot({
			path: info.outputPath(`pricing-${locale}.png`),
			animations: "disabled",
		});
		const overflow = await pricing.evaluate((element) => ({
			width: element.clientWidth,
			scroll: element.scrollWidth,
			nodes: [...element.querySelectorAll("*")]
				.filter((node) => {
					const rect = node.getBoundingClientRect();
					return (
						rect.right > element.getBoundingClientRect().right + 2 &&
						getComputedStyle(node).position !== "absolute"
					);
				})
				.slice(0, 12)
				.map((node) => ({
					tag: node.tagName,
					class: node.className,
					text: node.textContent?.slice(0, 70),
					width: node.clientWidth,
					scroll: node.scrollWidth,
				})),
		}));
		expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
	});
}

test("language changes synchronize between windows and survive reload", async ({
	page,
	context,
}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const other = await context.newPage();
	await installDesktopBridge(other);
	await other.goto("/?windowType=editor");
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await other.evaluate(() => localStorage.setItem("recordly.locale", "zh-TW"));
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
	await other.evaluate(() => localStorage.removeItem("recordly.locale"));
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("a fresh renderer origin restores the native saved app language", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const getSetting = window.electronAPI.getAppSetting;
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.locale" ? "zh-TW" : getSetting(key);
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
	await expect(
		page.getByRole("button", { name: catalog("zh-TW", "ui").home, exact: true }),
	).toBeVisible();
});
