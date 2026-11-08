import type { AppLocale } from "../src/i18n/config";
import { normalizeLocale } from "../src/i18n/locale";
import de from "../src/i18n/locales/de/native.json";
import en from "../src/i18n/locales/en/native.json";
import es from "../src/i18n/locales/es/native.json";
import fr from "../src/i18n/locales/fr/native.json";
import it from "../src/i18n/locales/it/native.json";
import ja from "../src/i18n/locales/ja/native.json";
import ko from "../src/i18n/locales/ko/native.json";
import nl from "../src/i18n/locales/nl/native.json";
import ptBR from "../src/i18n/locales/pt-BR/native.json";
import zhCN from "../src/i18n/locales/zh-CN/native.json";
import zhTW from "../src/i18n/locales/zh-TW/native.json";

const catalogs: Record<AppLocale, typeof en> = {
	en,
	es,
	fr,
	de,
	it,
	nl,
	ko,
	ja,
	"pt-BR": ptBR,
	"zh-CN": zhCN,
	"zh-TW": zhTW,
};
let locale: AppLocale = "en";

export function setNativeLocale(value: string) {
	locale = normalizeLocale(value);
	return locale;
}

export function nativeT(key: keyof typeof en, values: Record<string, string | number> = {}) {
	return (catalogs[locale][key] || en[key]).replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
		Reflect.getOwnPropertyDescriptor(values, name) !== undefined ? String(values[name]) : match,
	);
}

export function nativeNumber(value: number, options?: Intl.NumberFormatOptions) {
	return new Intl.NumberFormat(locale, options).format(value);
}
