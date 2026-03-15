export const DEFAULT_LOCALE = 'en' as const

export const SUPPORTED_LOCALES = ['en', 'es', 'zh-CN', 'tr'] as const

export const I18N_NAMESPACES = [
  'common',
  'launch',
  'editor',
  'timeline',
  'settings',
  'dialogs',
  'shortcuts',
] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]
export type I18nNamespace = (typeof I18N_NAMESPACES)[number]