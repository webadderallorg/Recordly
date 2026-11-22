import { type AppLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./config";

export const LOCALE_STORAGE_KEY = "recordly.locale";

/** Return undefined for an unsupported language, so preference lists can continue. */
export function matchLocale(value: string | null | undefined): AppLocale | undefined {
	if (!value?.trim()) return undefined;
	let locale: Intl.Locale;
	try {
		locale = new Intl.Locale(value.trim().replace(/_/g, "-"));
	} catch {
		return undefined;
	}
	const exact = SUPPORTED_LOCALES.find((candidate) => candidate === locale.baseName);
	if (exact) return exact;
	if (locale.language === "zh") {
		// Script is authoritative: zh-Hant-CN still means Traditional Chinese.
		return locale.maximize().script === "Hant" ? "zh-TW" : "zh-CN";
	}
	return SUPPORTED_LOCALES.find((candidate) => candidate.split("-")[0] === locale.language);
}

export function normalizeLocale(value: string | null | undefined): AppLocale {
	return matchLocale(value) ?? DEFAULT_LOCALE;
}

export function getSystemLocale(): AppLocale {
	if (typeof navigator === "undefined") return DEFAULT_LOCALE;
	const preferences = navigator.languages?.length ? navigator.languages : [navigator.language];
	for (const preference of preferences) {
		const locale = matchLocale(preference);
		if (locale) return locale;
	}
	return DEFAULT_LOCALE;
}

export function getInitialLocale(): AppLocale {
	try {
		// Packaged windows use a new loopback origin on each launch. Native preferences
		// preserve the user's choice across those origins and app restarts.
		const stored =
			typeof window === "undefined"
				? null
				: window.electronAPI?.getAppSetting?.(LOCALE_STORAGE_KEY);
		const locale = typeof stored === "string" ? matchLocale(stored) : undefined;
		if (locale) return locale;
	} catch {
		// Browser previews and older bridges can still use local storage.
	}
	try {
		const stored =
			typeof window === "undefined" ? null : window.localStorage.getItem(LOCALE_STORAGE_KEY);
		const locale = matchLocale(stored);
		if (locale) return locale;
	} catch {
		// Private/restricted storage must not prevent the application from starting.
	}
	return getSystemLocale();
}
