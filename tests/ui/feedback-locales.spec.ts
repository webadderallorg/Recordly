import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SUPPORTED_LOCALES } from "../../src/i18n/config";
import { installDesktopBridge } from "./bridge";

function catalog(locale: string, namespace: string) {
	return JSON.parse(
		readFileSync(
			new URL(`../../src/i18n/locales/${locale}/${namespace}.json`, import.meta.url),
			"utf8",
		),
	);
}

test("feedback reply opt-in fits all supported languages", async ({ page }) => {
	test.setTimeout(180000);
	await page.setViewportSize({ width: 1000, height: 600 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	for (const locale of SUPPORTED_LOCALES) {
		await page.evaluate((value) => localStorage.setItem("recordly.locale", value), locale);
		await page.reload({ waitUntil: "domcontentloaded" });
		const common = catalog(locale, "common");
		await page
			.getByRole("button", { name: catalog(locale, "ui").home, exact: true })
			.press("Enter");
		const home = page.getByRole("dialog", {
			name: catalog(locale, "ui").projectsDashboard,
			exact: true,
		});
		await home.getByRole("button", { name: common.feedback.trigger, exact: true }).click();
		const feedback = page.getByRole("dialog", { name: common.feedback.send, exact: true });
		const optIn = feedback.getByRole("checkbox", {
			name: common.feedback.allowReply,
			exact: true,
		});
		await expect(optIn).toBeVisible();
		await expect(optIn).not.toBeChecked();
		expect(
			await feedback.evaluate((element) => element.scrollWidth <= element.clientWidth),
			locale,
		).toBe(true);
	}
});
