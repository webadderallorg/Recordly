Language: EN | [Español](TRANSLATION_GUIDE.es.md)

# Translation Guide

This project uses a namespace-based i18n setup so contributors can localize safely without changing app logic.

## Locale Files

All locale files live under:

- `src/i18n/locales/en/`
- `src/i18n/locales/es/`
- `src/i18n/locales/fr/`
- `src/i18n/locales/de/`
- `src/i18n/locales/it/`
- `src/i18n/locales/nl/`
- `src/i18n/locales/ko/`
- `src/i18n/locales/pt-BR/`
- `src/i18n/locales/zh-CN/`
- `src/i18n/locales/zh-TW/`

Each locale has the same namespace files:

- `common.json`
- `launch.json`
- `editor.json`
- `timeline.json`
- `settings.json`
- `dialogs.json`
- `shortcuts.json`

English (`en`) is the source of truth for key structure.

## Key Rules

- Keep the same key paths across locales.
- Do not rename existing keys unless coordinated with code changes.
- Add new keys to `en` first, then mirror into all other locales.
- Prefer descriptive, stable keys. Example: `app.editorTitle`.
- Interpolation is supported with `{{name}}` style placeholders.

## How Translation Is Read

- Keys with a namespace prefix like `settings.export.title` use that namespace.
- Keys without a namespace default to `common`.
- Missing translations fall back to English, then to the provided fallback string, then to the key.

## Validate Locale Structure

Run:

```bash
npm run i18n:check
```

This checks for:

- Missing namespace files
- Missing keys compared to `en`
- Extra keys not present in `en`

## Contributor Workflow

1. Pull latest `main`.
2. Update `en/<namespace>.json` with new keys if needed.
3. Add matching keys to other locale files.
4. Run `npm run i18n:check`.
5. Run app locally (`npm run dev`) and spot-check UI text.
6. Open PR with a short summary of changed namespaces.

## Scope Notes

Current framework is app-wide and ready for full localization rollout.
Not every UI string is migrated yet. Migration should be done incrementally by namespace to keep PRs reviewable and low-risk.
