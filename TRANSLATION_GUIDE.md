# Translation Guide

This project uses a namespace-based i18n setup so contributors can localize safely without changing app logic.

## Locale Files

Each locale has a directory under [`src/i18n/locales/`](src/i18n/locales/). See
[`src/i18n/config.ts`](src/i18n/config.ts) for the supported locale codes
(`SUPPORTED_LOCALES`) and required namespace files (`I18N_NAMESPACES`).
The [English catalog](src/i18n/locales/en/) defines the key structure for each
namespace.

## Add a Language

1. Add a canonical BCP 47 locale code, such as `pt-PT`, to `SUPPORTED_LOCALES`
   in [`src/i18n/config.ts`](src/i18n/config.ts).
   Create a directory with the same code under `src/i18n/locales/` and translate
   each namespace file from the English catalog.
2. Add the language's display name to `APP_LANGUAGE_LABELS` in
   [`AppSettings.tsx`](src/components/video-editor/settings/AppSettings.tsx)
   and its country mapping and flag artwork in
   [`language-flag.tsx`](src/components/ui/language-flag.tsx).
3. Import the new `native.json` and register it in `catalogs` in
   [`electron/nativeI18n.ts`](electron/nativeI18n.ts) for native dialogs.
   The renderer loads catalogs automatically through
   [`src/i18n/messages.ts`](src/i18n/messages.ts).
4. Run both checks below. Start the app with `npm run dev`, select the language
   in Settings, and check that the interface and a native dialog use it.

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
npm run typecheck
```

`i18n:check` validates namespace files for locales in `SUPPORTED_LOCALES`.
It checks key parity with English, nonempty strings, matching interpolation
placeholders, and literal keys in recognized translation calls under `src`.
Check dynamic and native dialog text in the running app. A directory alone can
pass unnoticed until its code is registered. TypeScript checks that the
language label, flag's country mapping, and native catalog cover each locale.

## Update Existing Translations

1. Pull latest `main`.
2. Update `en/<namespace>.json` with new keys if needed.
3. Add matching keys to other locale files.
4. Run `npm run i18n:check`.
5. Run app locally (`npm run dev`) and spot-check UI text.
6. Open PR with a short summary of changed namespaces.

## Scope Notes

Current framework is app-wide and ready for full localization rollout.
Not every UI string is migrated yet. Migration should be done incrementally by namespace to keep PRs reviewable and low-risk.
