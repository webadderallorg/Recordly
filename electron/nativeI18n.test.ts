import { afterEach, describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "../src/i18n/config";
import { nativeNumber, nativeT, setNativeLocale } from "./nativeI18n";

afterEach(() => setNativeLocale("en"));

describe("native translation catalogs", () => {
	it.each(SUPPORTED_LOCALES)("provides dialogs and interpolates safely in %s", (locale) => {
		setNativeLocale(locale);
		expect(nativeT("welcome")).toContain("Recordly");
		expect(nativeT("saveFailedMessage").length).toBeGreaterThan(10);
		expect(nativeT("stopTooltip", { source: "$& {{source}}" })).toContain("$& {{source}}");
		expect(nativeT("versionAvailable", { version: "1.2.3" })).toContain("1.2.3");
		if (locale !== "en")
			expect(nativeT("saveFailedMessage")).not.toBe(
				"Saving failed or did not respond. Discard unsaved changes and close?",
			);
	});
	it("preserves Traditional Chinese script and regional locale aliases", () => {
		setNativeLocale("zh-Hant-HK");
		expect(nativeT("saveProject")).toBe("儲存專案…");
		setNativeLocale("pt-PT");
		expect(nativeT("saveProject")).toBe("Salvar projeto…");
	});
	it("formats download sizes in the selected locale", () => {
		setNativeLocale("de");
		expect(nativeNumber(12.3, { minimumFractionDigits: 1 })).toBe("12,3");
	});
});
