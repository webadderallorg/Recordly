export const DEFAULT_LOCALE = "en" as const;

export const SUPPORTED_LOCALES = [
	"en",
	"es",
	"fr",
	"de",
	"it",
	"nl",
	"ko",
	"pt-BR",
	"zh-CN",
	"zh-TW",
] as const;

export const I18N_NAMESPACES = [
	"common",
	"launch",
	"editor",
	"timeline",
	"settings",
	"dialogs",
	"shortcuts",
] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

/**
 * Native display name per locale. Typed against AppLocale so adding a locale to
 * SUPPORTED_LOCALES without a label is a compile error rather than a menu row
 * that renders the raw locale code.
 */
export const LOCALE_LABELS: Record<AppLocale, string> = {
	en: "English",
	es: "Español",
	fr: "Français",
	de: "Deutsch",
	it: "Italiano",
	nl: "Nederlands",
	ko: "한국어",
	"pt-BR": "Português",
	"zh-CN": "簡體中文",
	"zh-TW": "繁體中文",
};
