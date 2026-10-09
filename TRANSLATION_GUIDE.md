# Translation Guide

This project uses a namespace-based i18n setup so contributors can localize safely without changing app logic.

## Locale Files

All locale files live under `src/i18n/locales/<locale>/`, one directory per locale. See `SUPPORTED_LOCALES` in [`src/i18n/config.ts`](src/i18n/config.ts) for the authoritative list of locales the app currently offers in its language picker.

Each locale has the same namespace files (mirroring [`src/i18n/config.ts`](src/i18n/config.ts) `I18N_NAMESPACES`):

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

A locale that only ships JSON files under `src/i18n/locales/<locale>/` will pass `i18n:check` but stay invisible in the language picker until it is also registered in the three touch-points below.

## Register a New Locale

Adding the JSON files is not enough on its own. A new locale must also be wired into three places so it appears in the language picker and its strings are actually loaded:

1. **`src/i18n/config.ts`** — add the locale code to `SUPPORTED_LOCALES`. This extends the `AppLocale` type derived from it, so TypeScript will then require the entries below.
2. **`src/contexts/I18nContext.tsx`** — add the seven namespace `import`s for the new locale (following the existing pattern, e.g. `xxCommon`, `xxDialogs`, `xxEditor`, `xxLaunch`, `xxSettings`, `xxShortcuts`, `xxTimeline`), then add a matching bundle entry to the `messages` map.
3. **`src/components/video-editor/SettingsPanel.tsx`** — add a native-language label for the locale to `APP_LANGUAGE_LABELS` (for example `de: "Deutsch"`, `ko: "한국어"`). This is what the language picker displays.

If any of these three steps is skipped, the locale ships silently and users cannot select it.

## Contributor Workflow

### Updating an existing locale

1. Pull latest `main`.
2. Update `en/<namespace>.json` with new keys if needed.
3. Add matching keys to other locale files.
4. Run `npm run i18n:check`.
5. Run the app locally (`npm run dev`) and spot-check UI text.
6. Open a PR with a short summary of changed namespaces.

### Adding a new locale

1. Pull latest `main`.
2. Create `src/i18n/locales/<locale>/` with the seven namespace JSON files, copying `en/` as a starting point.
3. Translate the values (do not change keys).
4. Run `npm run i18n:check` — must pass.
5. Complete the three wiring steps in **Register a New Locale** above.
6. Run the app locally (`npm run dev`), open Settings → Language, verify the new locale appears in the picker and switches the UI when selected.
7. Open a PR with a short summary; call out the three wiring edits so reviewers can confirm the locale is reachable.

## Scope Notes

Current framework is app-wide and ready for full localization rollout.
Not every UI string is migrated yet. Migration should be done incrementally by namespace to keep PRs reviewable and low-risk.
