# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server + Electron |
| `npm run build` | Full production build (native helpers → TypeScript → Vite → Electron Builder) |
| `npm run build:win` | Windows build (includes native DXGI capture) |
| `npm run build:mac` | macOS build |
| `npm run build:linux` | Linux build |
| `npm run lint` | Biome lint check |
| `npm run lint:fix` | Biome auto-fix |
| `npm run format` | Biome format |
| `npm run test` | Run Vitest (single run) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run i18n:check` | Validate i18n locale file structure against `en` |

Run a single test file: `npx vitest run src/lib/exporter/gifExporter.test.ts`

## Architecture

**Electron + React + Vite** desktop screen recorder and video editor.

### Process Model

- **Main process** (`electron/main.ts`): Window lifecycle, tray icon, native recording, file I/O, permissions, auto-cleanup
- **Preload** (`electron/preload.ts`): contextBridge API exposing ~40 IPC methods to renderer
- **IPC handlers** (`electron/ipc/handlers.ts`): All main↔renderer communication; recording pipelines, file operations, project persistence, shortcuts, cursor telemetry
- **Renderer** (`src/`): React SPA routed by `?windowType=` URL parameter (no router library)

### Three Window Types

1. **HUD Overlay** (`?windowType=hud-overlay`): 500×155 floating bar at screen bottom for recording controls. Transparent, always-on-top.
2. **Editor** (`?windowType=editor`): Main video editor window (1200×800, maximized). Houses timeline, playback, annotations, export.
3. **Source Selector** (`?windowType=source-selector`): 620×420 popup for picking capture sources.

`App.tsx` switches components based on the `windowType` query param.

### Recording Pipeline (Platform-Specific)

- **macOS**: ScreenCaptureKit via compiled Swift helpers (`scripts/build-native-helpers.mjs`)
- **Windows**: DXGI Desktop Duplication via C++ CMake build (`scripts/build-windows-capture.mjs`), fallback to FFmpeg
- **Linux**: Chromium `getDisplayMedia`
- Core recording logic: `src/hooks/useScreenRecorder.ts` (60 FPS target, adaptive bitrate)

### Export Engine (`src/lib/exporter/`)

GPU-accelerated pipeline: WebCodec streaming decode → PIXI.js frame rendering (zoom, crop, annotations, cursor) → MP4 mux (mp4box) or GIF (gif.js with Web Workers). Key files: `videoExporter.ts`, `gifExporter.ts`, `frameRenderer.ts`, `streamingDecoder.ts`, `muxer.ts`.

### State Management

No external state library. `VideoEditor.tsx` uses ~50 `useState` hooks. Undo/redo via `useRef` history stacks. Only two React Contexts: `I18nContext` and `ShortcutsContext`.

### i18n System

- Config: `src/i18n/config.ts` — languages: `en` (source), `es`
- Locale files: `src/i18n/locales/{lang}/{namespace}.json`
- 7 namespaces: `common`, `launch`, `editor`, `timeline`, `settings`, `dialogs`, `shortcuts`
- Implementation: `src/contexts/I18nContext.tsx` — compile-time JSON import, recursive key lookup, `{{var}}` interpolation
- Fallback chain: current language → English → provided fallback → raw key
- Run `npm run i18n:check` after any locale changes
- See `TRANSLATION_GUIDE.md` for contributor workflow

### UI Layer

- Base components: `src/components/ui/` — Radix UI primitives wrapped with shadcn/ui patterns
- Styling: Tailwind CSS with CSS variable theming, class-based dark mode
- Icons: lucide-react + react-icons
- Timeline: `dnd-timeline` library for drag-and-drop editing
- Path alias: `@/` → `src/`

### Project File Format

`.recordly` files (legacy `.openscreen` supported). Serialization in `src/components/video-editor/projectPersistence.ts`.

## Code Quality

- **Biome** is the primary linter/formatter (tab indent, LF, 100 char width)
- **Strict TypeScript**: `noExplicitAny: error`, no unused variables/params
- **Hook rules enforced**: `useHookAtTopLevel: error`
- **Import organization**: automatic via Biome
- Tests use Vitest + fast-check (property-based testing). Test files: `src/**/*.{test,spec}.{ts,tsx}`
