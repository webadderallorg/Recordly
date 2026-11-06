import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SUPPORTED_LOCALES } from "../../src/i18n/config";
import { installDesktopBridge } from "./bridge";

function catalog(locale: string, namespace: string) {
	return JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${locale}/${namespace}.json`, import.meta.url), "utf8"));
}

test("feedback links fit all supported languages", async ({ page }) => {
	test.setTimeout(180000);
	await page.setViewportSize({ width: 1000, height: 600 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	for (const locale of SUPPORTED_LOCALES) {
		await page.evaluate((value) => localStorage.setItem("recordly.locale", value), locale);
		await page.reload();
		const common = catalog(locale, "common");
		await page.getByRole("button", { name: catalog(locale, "ui").home, exact: true }).click();
		const home = page.getByRole("dialog", { name: catalog(locale, "ui").projectsDashboard, exact: true });
		await home.getByRole("button", { name: common.feedback.trigger, exact: true }).click();
		const feedback = page.getByRole("dialog", { name: common.feedback.send, exact: true });
		await expect(feedback.getByRole("link", { name: "support@recordly.dev", exact: true })).toHaveCount(0);
		const buttons = [
			feedback.getByRole("button", { name: catalog(locale, "editor").socials, exact: true }),
			feedback.getByRole("button", { name: catalog(locale, "billing").contact, exact: true }),
		];
		for (const button of buttons) {
			await expect(button).toBeInViewport({ ratio: 1 });
			expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth), locale).toBe(true);
			const name = await button.innerText();
			await button.click();
			const dialog = page.getByRole("dialog", { name, exact: true });
			await expect(dialog).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(button).toBeFocused();
		}
		await feedback.screenshot({ path: test.info().outputPath(`feedback-${locale}.png`) });
	}
});
