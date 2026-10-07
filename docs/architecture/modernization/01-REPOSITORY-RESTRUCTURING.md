# 01 — Repository Restructuring

> Defines the current and proposed directory structure, file migration map,
> and module ownership boundaries.
>
> **Master reference:** `00-MASTER-ARCHITECTURE.md` Section 7 (Dependency Boundaries).

---

## 1. Current Directory Structure

```
Recordly/
├── electron/                         # Electron main process (TS)
│   ├── main.ts                       # App entry, windows, tray, menus (~869 LOC)
│   ├── windows.ts                    # Window creation & HUD overlay (~1,174 LOC)
│   ├── preload.ts                    # IPC bridge (~1,132 LOC)
│   ├── appSettingsStore.ts           # Settings persistence
│   ├── cursorHider.ts                # Cursor visibility
│   ├── gpuSwitches.ts                # GPU acceleration flags
│   ├── mediaServer.ts                # Local media server
│   ├── updater.ts                    # Auto-updater
│   ├── ipc/                          # IPC handler modules
│   │   ├── handlers.ts               # IPC registration entry point
│   │   ├── recording/                # Recording IPC (windows.ts, mac.ts, etc.)
│   │   ├── cursor/                   # Cursor telemetry, bounds, monitor
│   │   ├── export/                   # Native video export
│   │   ├── captions/                 # AI caption generation
│   │   ├── project/                  # Project management
│   │   ├── providers/                # LLM provider registry
│   │   ├── ffmpeg/                   # FFmpeg binary resolution, filters
│   │   ├── settings/                 # Recording preferences
│   │   ├── register/                 # IPC channel registration modules
│   │   └── paths/                    # Binary path resolution
│   └── native/                       # Native C++/Swift/CUDA modules
│       ├── wgc-capture/              # Windows Graphics Capture (C++)
│       ├── windows-capture/          # DXGI capture fallback (C++)
│       ├── cursor-monitor/           # Windows cursor hook (C++)
│       ├── gpu-export-probe/         # GPU export capability probe (C++)
│       ├── nvidia-cuda-compositor/   # CUDA/NVENC compositor (CUDA)
│       ├── ScreenCaptureKitRecorder.swift  # macOS screen capture
│       ├── NativeCursorMonitor.swift       # macOS cursor monitoring
│       ├── ScreenCaptureKitWindowList.swift # macOS window enumeration
│       ├── SystemCursorAssets.swift         # macOS cursor assets
│       ├── common/                   # Shared native headers
│       └── bin/                      # Compiled native binaries, whisper
├── src/                              # React frontend (TSX/TS)
│   ├── main.tsx                      # React entry point
│   ├── App.tsx                       # Root component, window-type routing
│   ├── components/
│   │   ├── ui/                       # Shared UI (26 components)
│   │   ├── video-editor/             # Video editor (~90 files)
│   │   │   ├── state/                # Editor state hooks (4 files)
│   │   │   ├── videoPlayback/        # Preview renderer (~40 files)
│   │   │   ├── timeline/             # Timeline editor
│   │   │   ├── export/               # Export controller
│   │   │   ├── cloud/                # Cloud sharing
│   │   │   ├── hooks/                # Editor hooks
│   │   │   ├── layout/               # Editor layout
│   │   │   ├── presets/              # Video presets
│   │   │   ├── project/              # Project persistence
│   │   │   ├── audio/                # Audio waveform
│   │   │   ├── captions/             # Caption components
│   │   │   ├── dashboard/            # Project dashboard
│   │   │   ├── library/              # Recording library
│   │   │   └── types.ts              # Domain types (298 relations)
│   │   ├── launch/                   # HUD, source selector
│   │   ├── auth/                     # Authentication UI
│   │   ├── countdown/                # Countdown overlay
│   │   ├── feedback/                 # User feedback
│   │   └── announcements/            # Announcement system
│   ├── hooks/                        # Recording hooks
│   │   └── useScreenRecorder.ts      # Main recording hook (~2,461 LOC)
│   ├── lib/                          # Shared libraries
│   │   ├── exporter/                 # Export engine (68 files)
│   │   ├── auth/                     # Authentication logic
│   │   ├── feedback/                 # Feedback diagnostics
│   │   ├── geometry/                 # Geometry utilities
│   │   ├── llmSettings.ts            # LLM provider config
│   │   └── utils.ts                  # Utility functions (cn, etc.)
│   ├── contexts/                     # React contexts (I18n, Theme, Shortcuts)
│   ├── i18n/                         # Localization (12 locales)
│   ├── types/                        # Shared types
│   └── utils/                        # Utility functions
├── services/                         # Backend services
│   ├── recordly-share/               # Cloud sharing (CF Worker + D1)
│   └── supabase/                     # Auth, functions, migrations
├── tests/
│   └── ui/                           # Playwright UI tests
├── scripts/                          # Build and release scripts
├── public/                           # Static assets, wallpapers, WASM
└── docs/                             # Documentation
```

---

## 2. Proposed Directory Structure

```
Recordly/
├── packages/                         # Shared packages (npm workspaces)
│   ├── domain/                       # Pure domain models and utilities
│   │   ├── src/
│   │   │   ├── types/                # ← from src/components/video-editor/types.ts
│   │   │   │   ├── clip.ts           #   ClipRegion, TrimRegion, SpeedRegion
│   │   │   │   ├── zoom.ts           #   ZoomRegion, ZoomFocus, ZoomDepth
│   │   │   │   ├── cursor.ts         #   CursorTelemetryPoint, CursorVisualSettings
│   │   │   │   ├── caption.ts        #   CaptionCue, CaptionCueWord, AutoCaptionSettings
│   │   │   │   ├── annotation.ts     #   AnnotationRegion, AnnotationType
│   │   │   │   ├── webcam.ts         #   WebcamOverlaySettings
│   │   │   │   ├── export.ts         #   Export configuration types
│   │   │   │   ├── project.ts        #   Project data types
│   │   │   │   ├── audio.ts          #   AudioRegion
│   │   │   │   └── index.ts          #   Re-exports
│   │   │   ├── utils/                # ← from src/lib/utils.ts, geometry/
│   │   │   │   ├── cn.ts             #   cn() class name utility
│   │   │   │   ├── geometry.ts       #   Geometry calculations
│   │   │   │   ├── mediaTiming.ts    #   ← from src/lib/mediaTiming.ts
│   │   │   │   └── index.ts
│   │   │   ├── clip/                 # ← from src/components/video-editor/clipSequence.ts etc.
│   │   │   │   ├── sequence.ts
│   │   │   │   ├── split.ts
│   │   │   │   ├── speed.ts
│   │   │   │   └── span.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── i18n/                         # Internationalization
│   │   ├── src/
│   │   │   ├── config.ts             # ← from src/i18n/config.ts
│   │   │   ├── I18nContext.tsx        # ← from src/contexts/I18nContext.tsx
│   │   │   └── locales/              # ← from src/i18n/locales/ (12 locales)
│   │   └── package.json
│   │
│   ├── ui/                           # Design system and shared components
│   │   ├── src/
│   │   │   ├── tokens/               # Design tokens (NEW)
│   │   │   │   ├── colors.ts
│   │   │   │   ├── typography.ts
│   │   │   │   ├── spacing.ts
│   │   │   │   └── index.ts
│   │   │   ├── components/           # ← from src/components/ui/ (26 components)
│   │   │   │   ├── button.tsx
│   │   │   │   ├── dialog.tsx
│   │   │   │   ├── slider.tsx
│   │   │   │   ├── ... (all 26)
│   │   │   │   └── index.ts
│   │   │   ├── icons/                # Shared icon components
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── editor/                       # Video editor (shared logic + components)
│   │   ├── src/
│   │   │   ├── VideoEditor.tsx        # ← from src/components/video-editor/VideoEditor.tsx
│   │   │   ├── EditorWindow.tsx       # ← from src/components/video-editor/EditorWindow.tsx
│   │   │   ├── state/                 # ← from src/components/video-editor/state/
│   │   │   ├── timeline/              # ← from src/components/video-editor/timeline/
│   │   │   ├── videoPlayback/         # ← from src/components/video-editor/videoPlayback/
│   │   │   ├── export/                # ← from src/components/video-editor/export/
│   │   │   ├── hooks/                 # ← from src/components/video-editor/hooks/
│   │   │   ├── cloud/                 # ← from src/components/video-editor/cloud/
│   │   │   ├── captions/              # ← from src/components/video-editor/captions/
│   │   │   ├── presets/               # ← from src/components/video-editor/presets/
│   │   │   ├── project/               # ← from src/components/video-editor/project/
│   │   │   ├── audio/                 # ← from src/components/video-editor/audio/
│   │   │   ├── layout/                # ← from src/components/video-editor/layout/
│   │   │   └── exporter/              # ← from src/lib/exporter/ (68 files)
│   │   └── package.json
│   │
│   └── platform-api/                 # Platform adapter interface (types only)
│       ├── src/
│       │   ├── adapter.ts             # PlatformAdapter interface
│       │   ├── recording.ts           # RecordingAdapter interface
│       │   ├── export.ts              # ExportAdapter interface
│       │   ├── storage.ts             # StorageAdapter interface
│       │   ├── cursor.ts              # CursorAdapter interface
│       │   ├── audio.ts               # AudioAdapter interface
│       │   ├── captions.ts            # CaptionAdapter interface
│       │   └── index.ts
│       └── package.json
│
├── apps/                             # Platform-specific applications
│   ├── desktop/                      # Tauri v2 desktop app
│   │   ├── src/                      # Desktop-specific React code
│   │   │   ├── main.tsx              # Desktop entry point
│   │   │   ├── App.tsx               # ← adapted from src/App.tsx
│   │   │   ├── adapters/             # Tauri platform adapter implementation
│   │   │   │   ├── tauriAdapter.ts
│   │   │   │   ├── tauriRecording.ts
│   │   │   │   ├── tauriExport.ts
│   │   │   │   ├── tauriStorage.ts
│   │   │   │   └── tauriCursor.ts
│   │   │   ├── components/           # Desktop-only components
│   │   │   │   ├── launch/           # ← from src/components/launch/
│   │   │   │   ├── countdown/        # ← from src/components/countdown/
│   │   │   │   └── HudWindow.tsx
│   │   │   └── hooks/                # Desktop recording hooks
│   │   │       └── useScreenRecorder.ts  # ← from src/hooks/useScreenRecorder.ts
│   │   ├── src-tauri/                # Rust core (Tauri v2)
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json
│   │   │   ├── capabilities/
│   │   │   ├── src/
│   │   │   │   ├── main.rs
│   │   │   │   ├── commands/         # Tauri command handlers
│   │   │   │   ├── capture/          # Sidecar orchestration
│   │   │   │   ├── audio/            # Audio capture orchestration
│   │   │   │   ├── cursor/           # Cursor tracking
│   │   │   │   ├── export/           # FFmpeg + GPU export
│   │   │   │   ├── storage/          # Settings + project metadata
│   │   │   │   ├── windows/          # Window management
│   │   │   │   └── captions/         # Whisper integration
│   │   │   └── sidecars/             # Native helper binaries
│   │   │       ├── wgc-capture       # ← from electron/native/wgc-capture/
│   │   │       ├── windows-capture   # ← from electron/native/windows-capture/
│   │   │       ├── cursor-monitor    # ← from electron/native/cursor-monitor/
│   │   │       ├── gpu-export-probe  # ← from electron/native/gpu-export-probe/
│   │   │       ├── nvidia-cuda-compositor  # ← from electron/native/nvidia-cuda-compositor/
│   │   │       ├── sck-recorder      # ← from electron/native/ScreenCaptureKitRecorder.swift
│   │   │       └── whisper           # ← from electron/native/bin/whisper*
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── web/                          # Web browser application
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── adapters/             # Browser platform adapter
│   │   │   │   ├── browserAdapter.ts
│   │   │   │   ├── browserRecording.ts
│   │   │   │   ├── browserExport.ts
│   │   │   │   └── browserStorage.ts
│   │   │   └── components/           # Web-only components
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── mobile/                       # React Native / WebView mobile app (future)
│       ├── src/
│       │   ├── adapters/
│       │   │   └── mobileAdapter.ts
│       │   └── components/
│       ├── package.json
│       └── app.json
│
├── services/                         # Backend (unchanged)
│   ├── recordly-share/
│   └── supabase/
│
├── scripts/                          # Build + release scripts (adapted)
├── tests/                            # E2E and integration tests
├── public/                           # Shared static assets
├── docs/
│   └── architecture/
│       └── modernization/            # This planning documentation
│
├── package.json                      # Root workspace config
├── tsconfig.base.json                # Shared TS config
├── biome.json                        # Linting (shared)
└── vitest.config.ts                  # Test config (shared)
```

---

## 3. File Migration Map

### 3.1 Domain Types Extraction

| Source                                           | Destination                    | Action   |
|--------------------------------------------------|--------------------------------|----------|
| `src/components/video-editor/types.ts`           | `packages/domain/src/types/`   | Split    |
| `src/lib/utils.ts`                               | `packages/domain/src/utils/cn.ts` | Move  |
| `src/lib/mediaTiming.ts`                         | `packages/domain/src/utils/mediaTiming.ts` | Move |
| `src/lib/geometry/`                              | `packages/domain/src/utils/geometry.ts` | Move |
| `src/components/video-editor/clipSequence.ts`    | `packages/domain/src/clip/sequence.ts` | Move |
| `src/components/video-editor/clipSplit.ts`       | `packages/domain/src/clip/split.ts` | Move |
| `src/components/video-editor/clipSpeedChange.ts` | `packages/domain/src/clip/speed.ts` | Move |
| `src/components/video-editor/clipSpanChange.ts`  | `packages/domain/src/clip/span.ts` | Move |

### 3.2 UI Components

| Source                              | Destination                    | Action   |
|-------------------------------------|--------------------------------|----------|
| `src/components/ui/*` (26 files)    | `packages/ui/src/components/`  | Move     |
| New design tokens                   | `packages/ui/src/tokens/`      | Create   |

### 3.3 Editor

| Source                              | Destination                    | Action   |
|-------------------------------------|--------------------------------|----------|
| `src/components/video-editor/`      | `packages/editor/src/`         | Move     |
| `src/lib/exporter/`                 | `packages/editor/src/exporter/`| Move     |

### 3.4 I18n

| Source                              | Destination                    | Action   |
|-------------------------------------|--------------------------------|----------|
| `src/i18n/`                         | `packages/i18n/src/`           | Move     |
| `src/contexts/I18nContext.tsx`       | `packages/i18n/src/`           | Move     |

### 3.5 Desktop App

| Source                              | Destination                                | Action   |
|-------------------------------------|--------------------------------------------|----------|
| `src/App.tsx`                       | `apps/desktop/src/App.tsx`                 | Adapt    |
| `src/main.tsx`                      | `apps/desktop/src/main.tsx`                | Adapt    |
| `src/hooks/useScreenRecorder.ts`    | `apps/desktop/src/hooks/`                  | Move     |
| `src/components/launch/`            | `apps/desktop/src/components/launch/`      | Move     |
| `src/components/countdown/`         | `apps/desktop/src/components/countdown/`   | Move     |
| `electron/` (all IPC logic)         | `apps/desktop/src-tauri/src/`              | Rewrite  |
| `electron/native/wgc-capture/`      | `apps/desktop/src-tauri/sidecars/`         | Move     |
| `electron/native/windows-capture/`  | `apps/desktop/src-tauri/sidecars/`         | Move     |
| `electron/native/cursor-monitor/`   | `apps/desktop/src-tauri/sidecars/`         | Move     |
| All other native binaries           | `apps/desktop/src-tauri/sidecars/`         | Move     |

### 3.6 Files to Remove (after migration)

| File/Directory           | Reason                                          |
|--------------------------|-------------------------------------------------|
| `electron/`              | Replaced by Tauri; IPC logic moves to Rust      |
| `electron/preload.ts`    | No preload in Tauri                              |
| `vite-plugin-electron*`  | Not needed with Tauri                            |

---

## 4. Ownership Boundaries

| Package/Module       | Owner Concern                    | May Import From          |
|----------------------|----------------------------------|--------------------------|
| `packages/domain`    | Types, models, pure utilities    | Nothing                  |
| `packages/i18n`      | Translation, locale management   | `domain`                 |
| `packages/ui`        | Design tokens, shared components | `domain`, `i18n`         |
| `packages/editor`    | Editor logic, exporter           | `domain`, `ui`, `i18n`, `platform-api` |
| `packages/platform-api` | Adapter interfaces            | `domain`                 |
| `apps/desktop`       | Tauri shell, Rust core, sidecars | All packages             |
| `apps/web`           | Browser shell, browser APIs      | All packages             |
| `apps/mobile`        | React Native shell               | All packages             |
| `services/`          | Backend (independent)            | None (own dependencies)  |

---

## 5. Naming Conventions

| Category              | Convention                                      |
|-----------------------|-------------------------------------------------|
| Package names         | lowercase, singular (`domain`, `editor`, `ui`)  |
| File names            | camelCase for TS/TSX, kebab-case for configs    |
| Type names            | PascalCase                                       |
| Function names        | camelCase                                        |
| Constants             | UPPER_SNAKE_CASE                                 |
| React components      | PascalCase, `.tsx` extension                     |
| Rust modules          | snake_case                                       |
| Test files            | `*.test.ts` adjacent to source                   |
| Tauri commands        | snake_case (Rust convention)                     |

---

## 6. Dependency Rules

1. **No circular dependencies** between packages.
2. **`domain`** has zero runtime dependencies. It may use only TypeScript built-ins.
3. **`platform-api`** exports only TypeScript interfaces and type definitions.
   No runtime code.
4. **`editor`** may not import from `apps/desktop`, `apps/web`, or `apps/mobile`.
5. **`ui`** may not import from `editor` or any app.
6. Platform-specific code lives only in `apps/*/`.
7. No `window.electronAPI` references outside `apps/desktop/`.
8. No `@tauri-apps/*` imports outside `apps/desktop/`.
9. No browser-specific APIs (e.g., `getDisplayMedia`) outside `apps/web/`.

---

## 7. Code Duplication Elimination

### 7.1 Identified Duplications

| Duplication                                    | Locations                          | Resolution                      |
|------------------------------------------------|------------------------------------|---------------------------------|
| `LlmProviderConfig` interface                  | `src/lib/llmSettings.ts` + `electron/ipc/providers/types.ts` | Single definition in `packages/domain/src/types/` |
| Clip time mapping functions                    | `types.ts` (298 relations)         | Extract to `packages/domain/src/clip/` |
| `NativeStaticLayoutTimelineSegment`            | `native-video.ts` + `modernVideoExporter.ts` | Single definition in `packages/domain/src/types/export.ts` |
| FFmpeg progress parsing                        | `native-video.ts` (multiple parsers) | Consolidate in export module    |
| `cn()` utility                                 | `src/lib/utils.ts` (24 callers)    | `packages/domain/src/utils/cn.ts` |

### 7.2 Rules Preventing Future Duplication

1. Every new type must be defined in `packages/domain/` if used by more than one package.
2. Shared utilities must live in the lowest-level package that needs them.
3. Platform-specific types must be in `packages/platform-api/` or the platform app.
4. Code review must check for type/interface duplication across packages.

---

## 8. Giant File Strategy

Files exceeding 500 LOC should be split along responsibility boundaries:

| File                          | Current LOC | Split Strategy                              |
|-------------------------------|------------|----------------------------------------------|
| `electron/preload.ts`         | ~1,132     | Eliminated (no preload in Tauri)             |
| `electron/main.ts`            | ~869       | Split into Rust modules per concern           |
| `electron/windows.ts`         | ~1,174     | Split into Rust window + HUD modules          |
| `useScreenRecorder.ts`        | ~2,461     | Split by platform recording, device mgmt      |
| `native-video.ts`             | ~2,450+    | Split: types, validators, GPU probe, FFmpeg   |
| `modernFrameRenderer.ts`      | ~3,339     | Split: setup, background, webcam, captions    |
| `modernVideoExporter.ts`      | ~3,787     | Split: native pipeline, encoder, audio mux    |
| `types.ts` (video-editor)     | ~662       | Split into domain packages (see 3.1)          |
