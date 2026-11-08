import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { type AppLocale, type I18nNamespace } from "@/i18n/config";
import { getInitialLocale, getSystemLocale, LOCALE_STORAGE_KEY, matchLocale } from "@/i18n/locale";
import { translateForLocale } from "@/i18n/messages";
import { setActiveLocale } from "@/i18n/runtime";
export { translate } from "@/i18n/runtime";
import { I18nProvider as AriaI18nProvider } from "react-aria";

interface I18nContextValue {
	locale: AppLocale;
	setLocale: (locale: AppLocale) => void;
	t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<AppLocale>(getInitialLocale);

	const setLocale = useCallback((nextLocale: AppLocale) => {
		setActiveLocale(nextLocale);
		setLocaleState(nextLocale);
		try {
			window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
		} catch {
			// The selection still applies for this session when storage is unavailable.
		}
	}, []);

	useEffect(() => {
		setActiveLocale(locale);
		document.documentElement.lang = locale;
		void window.electronAPI?.setAppLocale?.(locale).catch(() => {
			// Native controls are unavailable in renderer-only previews.
		});
	}, [locale]);

	useEffect(() => {
		const sync = (event: StorageEvent) => {
			if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
				const nextLocale = matchLocale(event.newValue) ?? getSystemLocale();
				setActiveLocale(nextLocale);
				setLocaleState(nextLocale);
			}
		};
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, []);

	const t = useCallback(
		(key: string, fallback?: string, vars?: Record<string, string | number>) => {
			return translateForLocale(locale, key, fallback, vars);
		},
		[locale],
	);

	const value = useMemo<I18nContextValue>(
		() => ({
			locale,
			setLocale,
			t,
		}),
		[locale, setLocale, t],
	);

	return (
		<I18nContext.Provider value={value}>
			<AriaI18nProvider locale={locale}>{children}</AriaI18nProvider>
		</I18nContext.Provider>
	);
}

export function useI18n() {
	const context = useContext(I18nContext);
	if (!context) {
		throw new Error("useI18n must be used within <I18nProvider>");
	}
	return context;
}

export function useScopedT(namespace: I18nNamespace) {
	const { t } = useI18n();
	return useCallback(
		(key: string, fallback?: string, vars?: Record<string, string | number>) => {
			return t(`${namespace}.${key}`, fallback, vars);
		},
		[namespace, t],
	);
}
