# Recordly working agreement

## Scope

Recordly is an Electron desktop screen recorder/editor. The renderer is React + TypeScript;
PixiJS and canvas compose previews and exported frames. Capture and fast export also have
platform-native helpers. Changes that look renderer-only can therefore affect Windows,
macOS, Linux, MP4, and GIF differently.

## Toolchain and setup

- Use Node.js 22, matching `.github/workflows/quality.yml` and build/release CI.
- For quality-only work, install exactly as CI does: `npm ci --ignore-scripts`.
- A normal `npm install` runs `scripts/postinstall.mjs`, which rebuilds `uiohook-napi` and
  all platform helpers. Do not use it merely to run TypeScript tests; on Windows it can
  invoke Visual Studio/CMake and overwrite tracked helper binaries/manifests.
- `npm run dev` starts the Vite/Electron development app (not verified in this checkout;
  camera and runtime smoke require an interactive desktop session).
- `npm run build` builds native helpers, typechecks, bundles, smokes the Electron main
  entry, and packages the current platform (not verified locally; this is a heavy
  platform build rather than the normal inner-loop check).

On this machine, the PowerShell `npm` shim may fail with:

`Cannot find module 'C:\Users\dodzi\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js'`

That is a broken npm-prefix/shim resolution, not a Recordly failure. Use a repaired Node
22 installation. As a temporary diagnostic workaround, invoke the installed CLI directly:

`node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" <args>`

## Verified quality commands

Run these from the repository root:

- `npx tsc --noEmit` — verified passing on 2026-08-25.
- `npm run lint` — verified exit 0 on 2026-08-25; it currently reports existing hook
  dependency warnings, so inspect new warnings in touched files.
- `npm test` — verified on 2026-08-25: 111 files passed, 1020 tests passed, 1 skipped.
- `npm run i18n:check` — verified passing on 2026-08-25.
- `npm run format:check` — verified failing on 2026-08-25 with 122 pre-existing format
  errors. CI deliberately treats this check as advisory. Do not bulk-format unrelated
  files to make a focused change pass; format touched code and report the baseline debt.

If Vitest/esbuild fails under an agent sandbox with `Cannot read directory "../../..":
Access is denied` and `Could not resolve ... vitest.config.ts`, rerun the same test outside
the filesystem sandbox. Otherwise a sandbox boundary looks like a code/test failure.

Windows Application Control can block freshly built executables or test DLLs with
`0x800711C7` / `Application Control policy has blocked this file`. Rebuild and rerun;
changing product code in response can hide an environmental failure.

## Rendering and export invariants

- Preview/export parity is a product requirement. Editor webcam preview is a DOM video
  layer in `VideoPlayback.tsx`; MP4/WebCodecs uses `modernFrameRenderer.ts`; GIF uses
  `frameRenderer.ts`. A webcam visual effect is incomplete until all three agree.
- `ModernVideoExporter` can bypass JavaScript frame composition through native static-
  layout exporters. When adding an effect unsupported by the native compositors, add an
  explicit native skip reason and test it; otherwise preview is correct but some MP4
  exports silently omit the effect.
- Webcam media is recorded as a separate sidecar with `timeOffsetMs`. Preserve raw media
  and the synchronization logic in `videoPlayback/webcamSync.ts`; destructive processing
  at capture time removes editability and risks screen/webcam drift.
- Extensions have ordered render hooks, including `post-webcam`. Preserve hook ordering
  when moving webcam composition, or extensions will render on the wrong layer.
- Preview and export intentionally have fallback paths for decoder/media-element and
  Pixi WebGPU/WebGL failures. New effects must fail soft (unprocessed webcam plus warning)
  instead of dropping the webcam or aborting an export.

## Project and settings compatibility

- `.recordly` projects persist `WebcamOverlaySettings`. Add new webcam fields with safe
  defaults in `types.ts` and normalization in `projectPersistence.ts`; old projects must
  continue to load without a version bump unless the wire shape truly becomes incompatible.
- Keep settings non-destructive: raw webcam footage remains the source of truth and editor
  controls determine rendering at preview/export time.
- User-visible settings keys must exist in every locale. Run `npm run i18n:check`; missing
  parity means some localized settings panels show fallback/missing text.
- `LICENSE.md` and the README identify Recordly as AGPL-3.0; `CONTRIBUTING.md` currently
  and incorrectly points contributors to an MIT `LICENSE` path. Treat the canonical license
  file as authoritative, and verify the license and redistribution terms of bundled ML
  runtimes or model assets before committing them.

## Native helper rules

- Windows helper sources and the tracked binaries under `electron/native/bin/win32-x64`
  are tied to `helpers-manifest.json` fingerprints. Use the corresponding
  `scripts/build-*.mjs` command after source changes; hand-copying a binary without the
  manifest makes builds reject or unknowingly reuse stale helpers.
- Full package validation is platform-specific. Follow `.github/workflows/build.yml` for
  FFmpeg installation, Electron native dependency rebuilds, packaging targets, and
  `npm run smoke:packaged-binaries` rather than inventing a local release sequence.

## Onboarding provenance

This guide was derived from repository files and freshly run commands on 2026-08-25.
No Recordly-specific auto-memory entries existed, and the repository owner had just forked
the project, so there is no human-supplied tribal-knowledge tier yet. Add only recurring,
expensive-to-rediscover lessons here as they emerge.
