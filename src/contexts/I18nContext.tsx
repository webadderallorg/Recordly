import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_LOCALE,
  I18N_NAMESPACES,
  SUPPORTED_LOCALES,
  type AppLocale,
  type I18nNamespace,
} from '@/i18n/config'
import enCommon from '@/i18n/locales/en/common.json'
import enDialogs from '@/i18n/locales/en/dialogs.json'
import enEditor from '@/i18n/locales/en/editor.json'
import enLaunch from '@/i18n/locales/en/launch.json'
import enSettings from '@/i18n/locales/en/settings.json'
import enShortcuts from '@/i18n/locales/en/shortcuts.json'
import enTimeline from '@/i18n/locales/en/timeline.json'
import esCommon from '@/i18n/locales/es/common.json'
import esDialogs from '@/i18n/locales/es/dialogs.json'
import esEditor from '@/i18n/locales/es/editor.json'
import esLaunch from '@/i18n/locales/es/launch.json'
import esSettings from '@/i18n/locales/es/settings.json'
import esShortcuts from '@/i18n/locales/es/shortcuts.json'
import esTimeline from '@/i18n/locales/es/timeline.json'
import zhCNCommon from '@/i18n/locales/zh-CN/common.json'
import zhCNDialogs from '@/i18n/locales/zh-CN/dialogs.json'
import zhCNEditor from '@/i18n/locales/zh-CN/editor.json'
import zhCNLaunch from '@/i18n/locales/zh-CN/launch.json'
import zhCNSettings from '@/i18n/locales/zh-CN/settings.json'
import zhCNShortcuts from '@/i18n/locales/zh-CN/shortcuts.json'
import zhCNTimeline from '@/i18n/locales/zh-CN/timeline.json'

const LOCALE_STORAGE_KEY = 'recordly.locale'

type LocaleBundle = Record<I18nNamespace, Record<string, unknown>>

const messages: Record<AppLocale, LocaleBundle> = {
  en: {
    common: enCommon,
    launch: enLaunch,
    editor: enEditor,
    timeline: enTimeline,
    settings: enSettings,
    dialogs: enDialogs,
    shortcuts: enShortcuts,
  },
  es: {
    common: esCommon,
    launch: esLaunch,
    editor: esEditor,
    timeline: esTimeline,
    settings: esSettings,
    dialogs: esDialogs,
    shortcuts: esShortcuts,
  },
  'zh-CN': {
    common: zhCNCommon,
    launch: zhCNLaunch,
    editor: zhCNEditor,
    timeline: zhCNTimeline,
    settings: zhCNSettings,
    dialogs: zhCNDialogs,
    shortcuts: zhCNShortcuts,
  },
} as const

interface I18nContextValue {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function isSupportedLocale(locale: string): locale is AppLocale {
  return SUPPORTED_LOCALES.includes(locale as AppLocale)
}

function normalizeLocale(locale: string | null | undefined): AppLocale {
  if (!locale) {
    return DEFAULT_LOCALE
  }

  // Exact match first (e.g. "zh-CN")
  if (isSupportedLocale(locale)) return locale

  // Canonicalize case (e.g. "zh-cn" → "zh-CN")
  const canonical = SUPPORTED_LOCALES.find(
    (l) => l.toLowerCase() === locale.toLowerCase(),
  )
  if (canonical) return canonical

  // Handle extended subtags like "zh-Hans-CN" → try "zh-CN"
  const parts = locale.split('-')
  if (parts.length >= 3) {
    const langRegion = `${parts[0]}-${parts[parts.length - 1]}`
    if (isSupportedLocale(langRegion)) {
      return langRegion
    }
  }

  // Language-only fallback (e.g. "zh" matches "zh-CN")
  const lang = parts[0].toLowerCase()
  const byLang = SUPPORTED_LOCALES.find((l) => l.split('-')[0].toLowerCase() === lang)
  if (byLang) return byLang

  return DEFAULT_LOCALE
}

function getInitialLocale(): AppLocale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE
  }

  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  if (storedLocale) {
    return normalizeLocale(storedLocale)
  }

  // Product default must be English on first launch unless user explicitly
  // selected another locale and we persisted it in localStorage.
  return DEFAULT_LOCALE
}

function getMessageValue(source: unknown, key: string): string | undefined {
  const parts = key.split('.')
  let current: unknown = source

  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return undefined
    }

    current = (current as Record<string, unknown>)[part]
  }

  return typeof current === 'string' ? current : undefined
}

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = vars[key]
    return value === undefined ? '' : String(value)
  })
}

function parseKey(key: string): { namespace: I18nNamespace; path: string } {
  const [first, ...rest] = key.split('.')
  if (I18N_NAMESPACES.includes(first as I18nNamespace) && rest.length > 0) {
    return { namespace: first as I18nNamespace, path: rest.join('.') }
  }
  return { namespace: 'common', path: key }
}

function translateForLocale(
  locale: AppLocale,
  key: string,
  fallback?: string,
  vars?: Record<string, string | number>,
) {
  const { namespace, path } = parseKey(key)

  const rawValue =
    getMessageValue(messages[locale][namespace], path)
    ?? getMessageValue(messages[DEFAULT_LOCALE][namespace], path)
    ?? fallback
    ?? key

  return interpolate(rawValue, vars)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(getInitialLocale)

  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale)
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const t = useCallback((key: string, fallback?: string, vars?: Record<string, string | number>) => {
    return translateForLocale(locale, key, fallback, vars)
  }, [locale])

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t,
  }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within <I18nProvider>')
  }
  return context
}

export function useScopedT(namespace: I18nNamespace) {
  const { t } = useI18n()
  return useCallback((key: string, fallback?: string, vars?: Record<string, string | number>) => {
    return t(`${namespace}.${key}`, fallback, vars)
  }, [namespace, t])
}