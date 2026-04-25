import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	type AppLocale,
	DEFAULT_LOCALE,
	I18N_NAMESPACES,
	type I18nNamespace,
	SUPPORTED_LOCALES,
} from "@/i18n/config";
import enCommon from "@/i18n/locales/en/common.json";
import enDialogs from "@/i18n/locales/en/dialogs.json";
import enEditor from "@/i18n/locales/en/editor.json";
import enExtensions from "@/i18n/locales/en/extensions.json";
import enLaunch from "@/i18n/locales/en/launch.json";
import enSettings from "@/i18n/locales/en/settings.json";
import enShortcuts from "@/i18n/locales/en/shortcuts.json";
import enTimeline from "@/i18n/locales/en/timeline.json";
import esCommon from "@/i18n/locales/es/common.json";
import esDialogs from "@/i18n/locales/es/dialogs.json";
import esEditor from "@/i18n/locales/es/editor.json";
import esExtensions from "@/i18n/locales/es/extensions.json";
import esLaunch from "@/i18n/locales/es/launch.json";
import esSettings from "@/i18n/locales/es/settings.json";
import esShortcuts from "@/i18n/locales/es/shortcuts.json";
import esTimeline from "@/i18n/locales/es/timeline.json";
import frCommon from "@/i18n/locales/fr/common.json";
import frDialogs from "@/i18n/locales/fr/dialogs.json";
import frEditor from "@/i18n/locales/fr/editor.json";
import frExtensions from "@/i18n/locales/fr/extensions.json";
import frLaunch from "@/i18n/locales/fr/launch.json";
import frSettings from "@/i18n/locales/fr/settings.json";
import frShortcuts from "@/i18n/locales/fr/shortcuts.json";
import frTimeline from "@/i18n/locales/fr/timeline.json";
import koCommon from "@/i18n/locales/ko/common.json";
import koDialogs from "@/i18n/locales/ko/dialogs.json";
import koEditor from "@/i18n/locales/ko/editor.json";
import koExtensions from "@/i18n/locales/ko/extensions.json";
import koLaunch from "@/i18n/locales/ko/launch.json";
import koSettings from "@/i18n/locales/ko/settings.json";
import koShortcuts from "@/i18n/locales/ko/shortcuts.json";
import koTimeline from "@/i18n/locales/ko/timeline.json";
import nlCommon from "@/i18n/locales/nl/common.json";
import nlDialogs from "@/i18n/locales/nl/dialogs.json";
import nlEditor from "@/i18n/locales/nl/editor.json";
import nlExtensions from "@/i18n/locales/nl/extensions.json";
import nlLaunch from "@/i18n/locales/nl/launch.json";
import nlSettings from "@/i18n/locales/nl/settings.json";
import nlShortcuts from "@/i18n/locales/nl/shortcuts.json";
import nlTimeline from "@/i18n/locales/nl/timeline.json";
import ptBRCommon from "@/i18n/locales/pt-BR/common.json";
import ptBRDialogs from "@/i18n/locales/pt-BR/dialogs.json";
import ptBREditor from "@/i18n/locales/pt-BR/editor.json";
import ptBRExtensions from "@/i18n/locales/pt-BR/extensions.json";
import ptBRLaunch from "@/i18n/locales/pt-BR/launch.json";
import ptBRSettings from "@/i18n/locales/pt-BR/settings.json";
import ptBRShortcuts from "@/i18n/locales/pt-BR/shortcuts.json";
import ptBRTimeline from "@/i18n/locales/pt-BR/timeline.json";
import zhCNCommon from "@/i18n/locales/zh-CN/common.json";
import zhCNDialogs from "@/i18n/locales/zh-CN/dialogs.json";
import zhCNEditor from "@/i18n/locales/zh-CN/editor.json";
import zhCNExtensions from "@/i18n/locales/zh-CN/extensions.json";
import zhCNLaunch from "@/i18n/locales/zh-CN/launch.json";
import zhCNSettings from "@/i18n/locales/zh-CN/settings.json";
import zhCNShortcuts from "@/i18n/locales/zh-CN/shortcuts.json";
import zhCNTimeline from "@/i18n/locales/zh-CN/timeline.json";

const LOCALE_STORAGE_KEY = "recordly.locale";
const DEFAULT_LOCALE_MIGRATION_KEY = "recordly.locale.default.zh-CN.v1";

type LocaleBundle = Record<I18nNamespace, Record<string, unknown>>;

const messages: Record<AppLocale, LocaleBundle> = {
	en: {
		common: enCommon,
		launch: enLaunch,
		editor: enEditor,
		timeline: enTimeline,
		settings: enSettings,
		dialogs: enDialogs,
		shortcuts: enShortcuts,
		extensions: enExtensions,
	},
	es: {
		common: esCommon,
		launch: esLaunch,
		editor: esEditor,
		timeline: esTimeline,
		settings: esSettings,
		dialogs: esDialogs,
		shortcuts: esShortcuts,
		extensions: esExtensions,
	},
	fr: {
		common: frCommon,
		launch: frLaunch,
		editor: frEditor,
		timeline: frTimeline,
		settings: frSettings,
		dialogs: frDialogs,
		shortcuts: frShortcuts,
		extensions: frExtensions,
	},
	nl: {
		common: nlCommon,
		launch: nlLaunch,
		editor: nlEditor,
		timeline: nlTimeline,
		settings: nlSettings,
		dialogs: nlDialogs,
		shortcuts: nlShortcuts,
		extensions: nlExtensions,
	},
	ko: {
		common: koCommon,
		launch: koLaunch,
		editor: koEditor,
		timeline: koTimeline,
		settings: koSettings,
		dialogs: koDialogs,
		shortcuts: koShortcuts,
		extensions: koExtensions,
	},
	"pt-BR": {
		common: ptBRCommon,
		launch: ptBRLaunch,
		editor: ptBREditor,
		timeline: ptBRTimeline,
		settings: ptBRSettings,
		dialogs: ptBRDialogs,
		shortcuts: ptBRShortcuts,
		extensions: ptBRExtensions,
	},
	"zh-CN": {
		common: zhCNCommon,
		launch: zhCNLaunch,
		editor: zhCNEditor,
		timeline: zhCNTimeline,
		settings: zhCNSettings,
		dialogs: zhCNDialogs,
		shortcuts: zhCNShortcuts,
		extensions: zhCNExtensions,
	},
} as const;

interface I18nContextValue {
	locale: AppLocale;
	setLocale: (locale: AppLocale) => void;
	t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isSupportedLocale(locale: string): locale is AppLocale {
	return SUPPORTED_LOCALES.includes(locale as AppLocale);
}

function normalizeLocale(locale: string | null | undefined): AppLocale {
	if (!locale) {
		return DEFAULT_LOCALE;
	}

	// Exact match first (e.g. "zh-CN")
	if (isSupportedLocale(locale)) return locale;

	// Canonicalize case (e.g. "zh-cn" → "zh-CN")
	const canonical = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === locale.toLowerCase());
	if (canonical) return canonical;

	// Handle extended subtags like "zh-Hans-CN" → try "zh-CN"
	const parts = locale.split("-");
	if (parts.length >= 3) {
		const langRegion = `${parts[0]}-${parts[parts.length - 1]}`;
		if (isSupportedLocale(langRegion)) {
			return langRegion;
		}
	}

	// Language-only fallback (e.g. "zh" matches "zh-CN")
	const lang = parts[0].toLowerCase();
	const byLang = SUPPORTED_LOCALES.find((l) => l.split("-")[0].toLowerCase() === lang);
	if (byLang) return byLang;

	return DEFAULT_LOCALE;
}

function getInitialLocale(): AppLocale {
	if (typeof window === "undefined") {
		return DEFAULT_LOCALE;
	}

	const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
	const migratedDefaultLocale = window.localStorage.getItem(DEFAULT_LOCALE_MIGRATION_KEY);
	if (!migratedDefaultLocale && (!storedLocale || normalizeLocale(storedLocale) === "en")) {
		window.localStorage.setItem(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
		window.localStorage.setItem(DEFAULT_LOCALE_MIGRATION_KEY, "1");
		return DEFAULT_LOCALE;
	}

	if (storedLocale) {
		return normalizeLocale(storedLocale);
	}

	return DEFAULT_LOCALE;
}

function getMessageValue(source: unknown, key: string): string | undefined {
	const parts = key.split(".");
	let current: unknown = source;

	for (const part of parts) {
		if (!current || typeof current !== "object" || !(part in current)) {
			return undefined;
		}

		current = (current as Record<string, unknown>)[part];
	}

	return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>) {
	if (!vars) return template;
	return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
		const value = vars[key];
		return value === undefined ? "" : String(value);
	});
}

function parseKey(key: string): { namespace: I18nNamespace; path: string } {
	const [first, ...rest] = key.split(".");
	if (I18N_NAMESPACES.includes(first as I18nNamespace) && rest.length > 0) {
		return { namespace: first as I18nNamespace, path: rest.join(".") };
	}
	return { namespace: "common", path: key };
}

function translateForLocale(
	locale: AppLocale,
	key: string,
	fallback?: string,
	vars?: Record<string, string | number>,
) {
	const { namespace, path } = parseKey(key);

	const rawValue =
		getMessageValue(messages[locale][namespace], path) ??
		getMessageValue(messages[DEFAULT_LOCALE][namespace], path) ??
		fallback ??
		key;

	return interpolate(rawValue, vars);
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<AppLocale>(getInitialLocale);

	const setLocale = useCallback((nextLocale: AppLocale) => {
		setLocaleState(nextLocale);
		if (typeof window !== "undefined") {
			window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
		}
	}, []);

	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

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

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
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
