import type { AppLocale } from "./config";
import { getInitialLocale } from "./locale";
import { translateForLocale } from "./messages";

let activeLocale: AppLocale | undefined;

/** Keep notifications in the live app language even when browser storage is blocked. */
export function setActiveLocale(locale: AppLocale) {
	activeLocale = locale;
}

/** Pure notification lookup, usable by non-React modules and workers. */
export function translate(key: string, fallback?: string, vars?: Record<string, string | number>) {
	return translateForLocale(activeLocale ?? getInitialLocale(), key, fallback, vars);
}
