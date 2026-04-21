export const DEFAULT_LOCALE = "en" as const;

export const SUPPORTED_LOCALES = ["en", "es", "fr", "nl", "ko", "pt-BR", "zh-CN", "ar"] as const;

export const I18N_NAMESPACES = [
	"common",
	"launch",
	"editor",
	"timeline",
	"settings",
	"dialogs",
	"shortcuts",
	"extensions",
] as const;

export function isRtlLocale(locale: string): boolean {
	return locale === "ar";
}

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];
