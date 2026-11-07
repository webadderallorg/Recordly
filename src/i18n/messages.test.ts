import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./config";
import { getMessageValue, translateForLocale } from "./messages";

describe("translation lookup", () => {
	it.each(SUPPORTED_LOCALES)("uses locale plural rules for numeric counts in %s", (locale) => {
		const catalogs = import.meta.glob<Record<string, string>>("./locales/*/ui.json", {
			eager: true,
			import: "default",
		});
		const catalog = catalogs[`./locales/${locale}/ui.json`];
		for (const count of [0, 1, 2, 1234]) {
			const category = new Intl.PluralRules(locale).select(count);
			expect(Object.hasOwn(catalog, `projectCount_${category}`)).toBe(true);
			const number = new Intl.NumberFormat(locale).format(count);
			const expected = (
				catalog[`projectCount_${category}`] ?? catalog.projectCount_other
			).replace("{{number}}", number);
			expect(
				translateForLocale(locale, "ui.projectCount", undefined, { count, number }),
			).toBe(expected);
		}
	});
	it.each(SUPPORTED_LOCALES)("resolves localized common actions in %s", (locale) => {
		const result = translateForLocale(locale, "common.actions.cancel");
		expect(result).not.toBe("common.actions.cancel");
		if (locale !== "en") expect(result).not.toBe("Cancel");
	});
	it.each(SUPPORTED_LOCALES)("preserves interpolation in %s", (locale) => {
		expect(
			translateForLocale(locale, "common.feedback.removeFile", undefined, {
				name: "demo.mov",
			}),
		).toContain("demo.mov");
	});
	it("uses explicit fallbacks and safely ignores inherited object properties", () => {
		expect(
			translateForLocale("ko", "common.unknown", "Fallback {{name}}", { name: "value" }),
		).toBe("Fallback value");
		expect(getMessageValue({ nested: {} }, "nested.toString")).toBeUndefined();
		expect(translateForLocale("en", "not.a.key")).toBe("not.a.key");
	});
});
