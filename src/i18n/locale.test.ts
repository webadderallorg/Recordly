import { afterEach, describe, expect, it, vi } from "vitest";
import { getInitialLocale, getSystemLocale, matchLocale, normalizeLocale } from "./locale";

afterEach(() => vi.unstubAllGlobals());

describe("locale negotiation", () => {
	it("restores the native saved language across changing packaged loopback origins", () => {
		vi.stubGlobal("navigator", { languages: ["en-AU"] });
		vi.stubGlobal("window", {
			electronAPI: { getAppSetting: () => "zh-TW" },
			localStorage: { getItem: () => null },
		});
		expect(getInitialLocale()).toBe("zh-TW");
		vi.stubGlobal("window", {
			electronAPI: { getAppSetting: () => "invalid!" },
			localStorage: { getItem: () => "de" },
		});
		expect(getInitialLocale()).toBe("de");
	});
	it.each([
		["zh-Hant", "zh-TW"],
		["zh-Hant-CN", "zh-TW"],
		["zh-Hans-TW", "zh-CN"],
		["zh-HK", "zh-TW"],
		["zh-MO", "zh-TW"],
		["zh-SG", "zh-CN"],
		["zh-cn", "zh-CN"],
		["zh_Hant_HK", "zh-TW"],
		["pt-PT", "pt-BR"],
		["es-MX", "es"],
		["ko-KR", "ko"],
		["ja-JP", "ja"],
		["ja_JP", "ja"],
		["en-AU", "en"],
		["de-DE-u-co-phonebk", "de"],
		["tr-TR", "tr"],
	])("maps %s to %s", (input, expected) => expect(normalizeLocale(input)).toBe(expected));
	it("rejects malformed and unsupported tags", () => {
		for (const input of ["!invalid", "ru", "", null, undefined])
			expect(matchLocale(input)).toBeUndefined();
	});
	it("uses the first supported preferred language, including English", () => {
		vi.stubGlobal("navigator", { languages: ["ru-RU", "en-AU", "ko-KR"] });
		expect(getSystemLocale()).toBe("en");
		vi.stubGlobal("navigator", { languages: ["ru-RU", "zh-Hant"] });
		expect(getSystemLocale()).toBe("zh-TW");
		vi.stubGlobal("navigator", { languages: ["ja-JP", "en-AU"] });
		expect(getSystemLocale()).toBe("ja");
	});
	it("uses navigator.language when the preferred language list is empty", () => {
		vi.stubGlobal("navigator", { languages: [], language: "fr-CA" });
		expect(getSystemLocale()).toBe("fr");
	});
	it("honors saved selection and recovers from invalid or inaccessible storage", () => {
		vi.stubGlobal("navigator", { languages: ["es-MX"] });
		vi.stubGlobal("window", { localStorage: { getItem: () => "zh-Hant" } });
		expect(getInitialLocale()).toBe("zh-TW");
		vi.stubGlobal("window", { localStorage: { getItem: () => "bad!!" } });
		expect(getInitialLocale()).toBe("es");
		vi.stubGlobal("window", {
			get localStorage() {
				throw Error("Blocked");
			},
		});
		expect(getInitialLocale()).toBe("es");
	});
});
