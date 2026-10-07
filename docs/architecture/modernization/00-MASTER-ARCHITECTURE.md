# 00 — Master Architecture

> Authoritative architecture document for the Recordly cross-platform modernization.
> All specialized documents (01–09) reference this document for shared principles,
> terminology, and boundary definitions. No other document may redefine concepts
> that are owned here.

---

## 1. Product Vision

Recordly is a lightweight, high-performance screen recording and video editing
application. The modernization targets five platforms:

| # | Platform        | Delivery                          | Recording? | Editor? |
|---|-----------------|-----------------------------------|-----------|---------|
| 1 | Windows Desktop | Tauri v2 native installer (NSIS)  | Full      | Full    |
| 2 | macOS Desktop   | Tauri v2 DMG / App bundle         | Full      | Full    |
| 3 | Web Browser     | Vite SPA (static hosting)         | Limited   | Full    |
| 4 | iOS             | React Native / WebView shell      | None (1)  | View/Edit |
| 5 | Android         | React Native / WebView shell      | None (1)  | View/Edit |

**(1)** iOS and Android do not support arbitrary screen recording of other
applications. Mobile platforms focus on project editing, review, and cloud
sharing. Platform recording restrictions are documented in `05-WEB-AND-MOBILE.md`.

---

## 2. Current Architecture Summary

### 2.1 Repository Metrics (GRAFT-verified)

| Metric            | Value                                          |
|-------------------|-------------------------------------------------|
| AST nodes         | 4,555 (2,634 functions, 701 files, 487 methods, 319 types, 311 interfaces, 62 classes) |
| AST edges         | 11,175                                          |
| Languages         | TypeScript, TSX, C++, CUDA, Swift, JavaScript, Ruby |
| Source files (app) | ~629 TS/TSX, ~22 C++/CUDA, ~4 Swift, ~42 JS   |
| Locales           | 12 (ar, de, en, es, fr, it, ko, nl, pt-BR, ru, zh-CN, zh-TW) |

### 2.2 Current Layer Architecture

```
┌─────────────────────────────────────────────────┐
│                   React Frontend                │  src/
│  React 19 + PixiJS 8 + HeroUI + Tailwind 4     │
│  Window types: HUD, Editor, SourceSelector,     │
│                Countdown, UpdateToast           │
├─────────────────────────────────────────────────┤
│              Electron IPC Bridge                │  electron/preload.ts
│  window.electronAPI (1,132-line preload)        │  (~170 IPC channels)
├─────────────────────────────────────────────────┤
│             Electron Main Process               │  electron/main.ts
│  Window management, tray, menus, updater        │  electron/windows.ts
│  IPC handler registration                       │  electron/ipc/handlers.ts
├──────────────┬──────────────────────────────────┤
│  IPC Modules │  Native Binaries (child procs)   │
│  recording/  │  wgc-capture (C++ ~1,200 LOC)    │
│  cursor/     │  windows-capture (C++ DXGI)      │
│  export/     │  cursor-monitor (C++)            │
│  captions/   │  nvidia-cuda-compositor (CUDA)   │
│  project/    │  gpu-export-probe (C++)          │
│  providers/  │  ScreenCaptureKitRecorder (Swift) │
│  ffmpeg/     │  NativeCursorMonitor (Swift)     │
│  settings/   │  SystemCursorAssets (Swift)       │
│  register/   │  whisper runtime (local binary)  │
├──────────────┴──────────────────────────────────┤
│               Backend Services                  │
│  recordly-share (Cloudflare Worker + D1)        │
│  Supabase (auth, functions, migrations)         │
└─────────────────────────────────────────────────┘
```

### 2.3 Coupling Hotspots (GRAFT)

| File                                               | Relations | Risk    |
|----------------------------------------------------|-----------|---------|
| `electron/ipc/export/native-video.ts`              | 653       | Critical |
| `src/lib/exporter/modernFrameRenderer.ts`          | 534       | Critical |
| `src/lib/exporter/modernVideoExporter.ts`          | 482       | High    |
| `src/components/video-editor/videoPlayback/cursorRenderer.ts` | 344 | High |
| `src/components/video-editor/types.ts`             | 298       | High    |
| `electron/windows.ts`                              | 280       | High    |

### 2.4 Hub Symbols (most called)

| Symbol                    | Callers | Location                         |
|---------------------------|---------|----------------------------------|
| `cn`                      | 24      | `src/lib/utils.ts:L4-L6`        |
| `installDesktopBridge`    | 23      | `tests/ui/bridge.ts:L2-L158`    |
| `succeeded`               | 22      | `electron/native/gpu-export-probe/src/main.cpp:L476-L482` |
| `getClipSourceStartMs`    | 21      | `src/components/video-editor/types.ts:L249-L251` |
| `useScopedT`              | 20      | `src/contexts/I18nContext.tsx:L367-L375` |

---

## 3. Target Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared React UI Layer                        │
│  packages/ui/          — Design system, shared components       │
│  packages/editor/      — Video editor (PixiJS, timeline, etc.) │
│  packages/domain/      — Domain models, types, utilities        │
│  packages/i18n/        — Internationalization                   │
├─────────────────────────────────────────────────────────────────┤
│                    Platform Shell Layer                          │
│  ┌──────────────┐  ┌───────────┐  ┌────────────┐  ┌──────────┐│
│  │ Tauri Desktop│  │ Web SPA   │  │ iOS Shell  │  │ Android  ││
│  │ (Win + Mac)  │  │ (Vite)    │  │ (RN/WV)    │  │ Shell    ││
│  │              │  │           │  │            │  │ (RN/WV)  ││
│  └──────┬───────┘  └─────┬─────┘  └─────┬──────┘  └────┬─────┘│
├─────────┼────────────────┼───────────────┼──────────────┼──────┤
│         │    Platform Adapter Interface  │              │       │
│         │    (Unified async command API) │              │       │
├─────────┼────────────────┼───────────────┼──────────────┼──────┤
│  ┌──────┴───────┐  ┌─────┴─────┐  ┌─────┴──────┐  ┌───┴─────┐│
│  │ Rust Core    │  │ Browser   │  │ Cloud API  │  │ Cloud   ││
│  │ (src-tauri/) │  │ APIs      │  │ (limited)  │  │ API     ││
│  │ • capture    │  │ • gDM     │  │            │  │         ││
│  │ • audio      │  │ • WebCodec│  │            │  │         ││
│  │ • cursor     │  │ • WASM    │  │            │  │         ││
│  │ • export     │  │           │  │            │  │         ││
│  │ • storage    │  │           │  │            │  │         ││
│  └──────────────┘  └───────────┘  └────────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Key Architectural Boundaries

1. **Shared UI** — React components, design tokens, and domain models that are
   identical across all platforms. Changes here propagate everywhere.

2. **Platform Adapter Interface** — A TypeScript interface that all platform
   shells implement. The UI never calls platform APIs directly; it always goes
   through this adapter. See `03-SHARED-CORE-AND-API.md` for the contract.

3. **Native Engines** — Platform-specific capture, audio, cursor, and export
   implementations. On desktop, these live in Rust (Tauri commands). On web,
   they use browser APIs. On mobile, most are unavailable.

4. **Backend Services** — Cloud sharing (Cloudflare Worker), authentication
   (Supabase), and future cloud rendering. These are platform-agnostic.

---

## 4. Platform Strategy

### 4.1 Shared vs. Platform-Specific

| Responsibility               | Shared | Desktop | Web   | Mobile |
|------------------------------|--------|---------|-------|--------|
| Design system / tokens       | Yes    | —       | —     | —      |
| Video editor UI              | Yes    | —       | —     | Adapted |
| Timeline component           | Yes    | —       | —     | Adapted |
| Domain models / types        | Yes    | —       | —     | —      |
| I18n strings                 | Yes    | —       | —     | —      |
| Screen capture               | —      | Native  | gDM   | None   |
| System audio capture         | —      | Native  | gDM   | None   |
| Microphone capture           | —      | Native  | gUM   | gUM    |
| Cursor tracking              | —      | Native  | CSS   | None   |
| Window management / HUD      | —      | Tauri   | None  | None   |
| Native overlay               | —      | Win32/NS| None  | None   |
| Export (FFmpeg/HW)           | —      | Native  | WASM  | Cloud  |
| File system access           | —      | Native  | OPFS  | App FS |
| App settings store           | —      | Native  | localStorage | AsyncStorage |
| Auto-updater                 | —      | Tauri   | None  | Store  |
| Authentication               | Shared | —       | —     | —      |
| Cloud sharing                | Shared | —       | —     | —      |
| LLM/AI providers             | Shared | —       | —     | —      |

### 4.2 Code Sharing Targets

| Layer               | Target sharing % | Strategy                          |
|---------------------|-----------------|-----------------------------------|
| Domain models       | 100%            | Single TypeScript package          |
| UI components       | 85-90%          | Shared package, platform CSS vars  |
| Editor logic        | 90%             | Shared package                     |
| Platform adapters   | 0%              | Each platform implements interface |
| Native engines      | 0%              | Platform-specific                  |
| Build tooling       | 50%             | Shared Vite config, platform ext   |

---

## 5. Architectural Principles

1. **Single Source of Truth** — Every domain concept, type, and API contract
   has exactly one defining location. Other documents and code reference it but
   do not redefine it.

2. **Platform Adapter Pattern** — The frontend depends on an abstract
   `PlatformAdapter` interface. Each platform provides a concrete
   implementation. No `if (platform === 'electron')` checks in shared UI code.

3. **Minimal Shared Core** — Share only what genuinely reduces duplication.
   Do not force-share implementations that differ substantially between
   platforms. Capture engines are inherently platform-specific and should not
   be abstracted behind a shared Rust library.

4. **Incremental Migration** — Never rewrite everything at once. Each phase
   must produce a working application. See `08-IMPLEMENTATION-ROADMAP.md`.

5. **Performance by Measurement** — Do not assume Rust is faster. Identify
   actual bottlenecks, measure baselines, set targets, and verify improvements.
   See `06-MEDIA-AND-PERFORMANCE.md`.

6. **Avoid Over-Engineering** — Do not introduce microservices, monorepo
   frameworks, or excessive abstraction layers unless a concrete requirement
   justifies them. The current monorepo with workspace packages is sufficient.

7. **Keep Native Where Native Wins** — Existing C++/Swift native modules that
   work correctly should be wrapped, not rewritten, unless there is evidence
   that rewriting provides measurable benefit.

8. **Explicit Boundaries** — Every module has a clear owner, a defined public
   interface, and documented dependencies. Giant files (>500 LOC) should be
   split along responsibility boundaries.

---

## 6. Major Architectural Decisions

Detailed ADR entries are in `09-ARCHITECTURE-DECISIONS.md`. Summary:

| ID     | Decision                                        | Status    |
|--------|-------------------------------------------------|-----------|
| ADR-01 | Migrate from Electron to Tauri v2               | Proposed  |
| ADR-02 | Monorepo with npm/pnpm workspaces               | Proposed  |
| ADR-03 | Platform Adapter interface pattern               | Proposed  |
| ADR-04 | PixiJS retained for editor rendering             | Proposed  |
| ADR-05 | Tailwind 4 + design tokens for cross-platform UI| Proposed  |
| ADR-06 | Wrap existing C++/Swift modules via Tauri sidecar| Proposed  |
| ADR-07 | Web export via WASM FFmpeg + WebCodecs           | Proposed  |
| ADR-08 | Mobile as view/edit only (no recording)          | Proposed  |
| ADR-09 | LLM provider registry pattern (existing)         | Accepted  |
| ADR-10 | Supabase + Cloudflare Workers for backend        | Accepted  |

---

## 7. Dependency Boundaries

```
packages/domain/     ← No runtime dependencies. Pure types + utilities.
packages/i18n/       ← Depends on: domain
packages/ui/         ← Depends on: domain, i18n
packages/editor/     ← Depends on: domain, ui, i18n
packages/platform-api/ ← Depends on: domain (interface definitions only)

apps/desktop/        ← Depends on: all packages + Tauri + Rust core
apps/web/            ← Depends on: all packages (browser APIs)
apps/mobile/         ← Depends on: all packages (RN adapter)
```

**Rules:**
- `domain` never imports from `ui`, `editor`, or any platform module.
- `ui` never imports from `editor` or any platform module.
- `editor` never imports directly from Electron, Tauri, or browser-specific APIs.
  It goes through `platform-api`.
- Platform apps are the only modules that import platform-specific code.

---

## 8. Architecture Diagrams

### 8.1 Recording Flow (Desktop)

```
User clicks "Record"
    │
    ▼
React UI (useScreenRecorder hook)
    │ invoke("start_recording", config)
    ▼
Platform Adapter → Tauri Command
    │
    ▼
Rust Capture Orchestrator
    ├── Windows: WGC/DXGI capture binary (sidecar)
    ├── macOS: ScreenCaptureKit recorder (sidecar)
    ├── Audio: WASAPI loopback / CoreAudio
    └── Cursor: Native hook process
    │
    ▼
Raw frames → disk (async Rust channels)
    │
    ▼
Cursor telemetry → ring buffer → companion JSON
    │
    ▼
Recording complete → open Editor window
```

### 8.2 Export Flow (Desktop)

```
User clicks "Export"
    │
    ▼
ModernVideoExporter (shared TS)
    │
    ├── Can use Native Static Layout? ──Yes──▶ Rust/FFmpeg pipeline
    │                                           ├── NVIDIA CUDA compositor
    │                                           ├── D3D11 GPU compositor
    │                                           └── CPU FFmpeg fallback
    │
    └── No (complex timeline) ──▶ Frame-by-frame renderer
                                    │
                                    ├── PixiJS renders each frame
                                    ├── WebCodecs encodes H.264
                                    ├── Frames sent to Electron via IPC
                                    └── FFmpeg muxes final container
```

### 8.3 Export Flow (Web)

```
User clicks "Export"
    │
    ▼
ModernVideoExporter (shared TS)
    │
    └── Frame-by-frame renderer
        ├── PixiJS renders each frame
        ├── WebCodecs encodes H.264/VP9
        ├── MP4Box.js muxes to MP4/WebM
        └── File saved via File API / download
```

---

## 9. Cross-Document Reference Map

| Topic                        | Owner Document              | Referenced By        |
|------------------------------|-----------------------------|----------------------|
| Repository structure         | `01-REPOSITORY-RESTRUCTURING` | 00, 03, 08          |
| Design system                | `02-DESIGN-SYSTEM-AND-UI-UX`  | 00, 01, 05          |
| API contracts                | `03-SHARED-CORE-AND-API`      | 00, 01, 04, 05, 07  |
| Windows/macOS engines        | `04-WINDOWS-AND-MACOS`        | 00, 03, 06, 08      |
| Web/mobile platforms         | `05-WEB-AND-MOBILE`           | 00, 02, 03, 06, 08  |
| Performance                  | `06-MEDIA-AND-PERFORMANCE`    | 00, 04, 05, 08      |
| LLM providers                | `07-LLM-PROVIDER-ARCHITECTURE`| 00, 03, 04, 05      |
| Implementation phases        | `08-IMPLEMENTATION-ROADMAP`   | All documents        |
| Architecture decisions       | `09-ARCHITECTURE-DECISIONS`   | All documents        |

---

## 10. Global Acceptance Criteria

1. All target platforms build and run from the same monorepo.
2. No domain model, type, or utility is duplicated across platform apps.
3. The Platform Adapter interface is the only abstraction between UI and native.
4. Existing recording quality and performance are preserved or improved.
5. The video editor renders identically on desktop and web.
6. All 12 locales continue to work.
7. Cloud sharing and authentication remain functional.
8. No application source code was modified during this planning phase.
9. Each implementation phase has explicit verification steps.
10. Performance budgets are defined with measurement methodology.

---

## 11. Document Ownership Matrix

| Document | Owns                              | Must Update Together With |
|----------|-----------------------------------|---------------------------|
| 00       | Vision, principles, boundaries    | All (when principles change) |
| 01       | Directory structure, file map     | 03 (API paths), 08 (phase scope) |
| 02       | Design tokens, UI components      | 01 (component paths), 05 (mobile) |
| 03       | TypeScript interfaces, Tauri cmds | 01, 04, 05, 07             |
| 04       | Windows + macOS native engines    | 03 (commands), 06 (perf), 08 |
| 05       | Web + mobile architecture         | 02 (mobile UI), 03 (adapters), 06 |
| 06       | Performance targets, pipelines    | 04, 05, 08                  |
| 07       | LLM abstraction, providers        | 03 (API), 04 (desktop impl) |
| 08       | Phase ordering, dependencies      | All (scope changes)         |
| 09       | ADR entries                       | Relevant owner document     |

---

## 12. Consistency Checklist

- [ ] Platform boundaries in 04 and 05 match the table in Section 4.1.
- [ ] Shared module names in 01 match dependency graph in Section 7.
- [ ] API contracts in 03 match Tauri command definitions in 04.
- [ ] Performance goals in 06 match targets referenced in 04 and 05.
- [ ] Implementation phases in 08 respect dependency ordering in Section 7.
- [ ] No document proposes a conflicting architecture.
- [ ] No feature has multiple competing owners.
- [ ] No duplicated implementation is introduced without justification.
- [ ] LLM provider interfaces in 07 match API contracts in 03.
- [ ] Mobile feature scope in 05 matches the platform table in Section 4.1.
