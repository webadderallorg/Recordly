# 08 — Implementation Roadmap

> Ordered implementation phases with dependencies, scope, risks, and
> acceptance criteria.
>
> **Master reference:** `00-MASTER-ARCHITECTURE.md` Section 5 (Principle 4: Incremental Migration).

---

## 1. Phase Overview

```
Phase 0: Foundation (2-3 weeks)
    │
Phase 1: Package Extraction (2-3 weeks)
    │
Phase 2: Tauri Desktop Shell (3-4 weeks)
    │
Phase 3: Recording Integration (3-4 weeks)
    │
Phase 4: Export Integration (2-3 weeks)
    │
Phase 5: Caption & AI Integration (1-2 weeks)
    │
Phase 6: Desktop Polish (2-3 weeks)
    │
Phase 7: Web Application (3-4 weeks)
    │
Phase 8: Mobile Application (4-6 weeks, can parallel Phase 7+)
    │
Phase 9: Performance & Optimization (ongoing)
```

**Total estimated duration: 22-32 weeks** (with parallelization where possible).

*These estimates are proposed targets based on codebase complexity observed
via GRAFT analysis. Actual duration depends on team size, familiarity, and
unforeseen integration challenges. They should not be treated as commitments.*

---

## 2. Phase 0: Foundation

### Objective
Set up the monorepo workspace and build infrastructure without changing any
existing application code.

### Scope
- Initialize npm/pnpm workspaces in root `package.json`.
- Create `packages/` directory structure.
- Create `apps/` directory structure.
- Set up shared `tsconfig.base.json`.
- Configure biome for multi-package linting.
- Ensure existing `npm run dev` and `npm run build` still work.

### Files Affected
- `package.json` (add workspaces field)
- New: `tsconfig.base.json`
- New: `packages/domain/package.json`
- New: `packages/ui/package.json`
- New: `packages/editor/package.json`
- New: `packages/i18n/package.json`
- New: `packages/platform-api/package.json`

### Dependencies
None. This phase is independent.

### Risks
- Workspace configuration may conflict with existing build scripts.
- Vite plugin for Electron may need workspace-aware configuration.

### Tests
- `npm run build` succeeds.
- `npm run dev` launches application.
- `npm run test` passes all existing tests.

### Acceptance Criteria
- [x] Monorepo workspace is configured.
- [x] Existing application builds and runs unchanged.
- [x] All existing tests pass.

### Rollback
- Revert workspace changes. No existing code was modified.

---

## 3. Phase 1: Package Extraction

### Objective
Extract shared domain models, types, utilities, and UI components into
workspace packages.

### Scope
1. Extract types from `src/components/video-editor/types.ts` to `packages/domain/`.
2. Extract utilities (`cn`, `mediaTiming`, `geometry`) to `packages/domain/`.
3. Extract clip logic (`clipSequence`, `clipSplit`, etc.) to `packages/domain/`.
4. Extract UI components (26 files) to `packages/ui/`.
5. Extract i18n to `packages/i18n/`.
6. Create `packages/platform-api/` with adapter interfaces.
7. Update all import paths in existing code.
8. Eliminate duplicated `LlmProviderConfig`.

### Files Affected
- `src/components/video-editor/types.ts` → split into `packages/domain/src/types/`
- `src/lib/utils.ts` → `packages/domain/src/utils/cn.ts`
- `src/lib/mediaTiming.ts` → `packages/domain/src/utils/`
- `src/components/ui/*` → `packages/ui/src/components/`
- `src/i18n/` → `packages/i18n/src/`
- `src/contexts/I18nContext.tsx` → `packages/i18n/src/`
- All files importing these modules (import path updates)

### Dependencies
- Phase 0 (workspace configuration).

### Risks
- Import path changes may break circular dependencies.
- Some types in `types.ts` (298 relations) may have hidden dependencies.
- HeroUI components may depend on Tailwind config that needs sharing.

### Tests
- All existing unit tests pass with updated imports.
- All Playwright UI tests pass.
- `packages/domain/` builds independently.
- `packages/ui/` builds independently.
- `packages/i18n/` builds independently.

### Acceptance Criteria
- [x] No duplicate type definitions across packages.
- [x] `packages/domain/` has zero runtime dependencies.
- [x] `packages/platform-api/` exports only TypeScript interfaces.
- [x] Existing application works identically.
- [x] All tests pass.

### Rollback
- Restore original file locations. Update imports back.

---

## 4. Phase 2: Tauri Desktop Shell

### Objective
Create a minimal Tauri v2 desktop application that renders the React UI
and replaces Electron window management.

### Scope
1. Create `apps/desktop/` with Tauri v2 scaffold.
2. Configure `tauri.conf.json` with window definitions.
3. Create `main.rs` with Tauri builder.
4. Implement window management (main, editor, HUD, countdown).
5. Implement settings storage via `tauri-plugin-store`.
6. Implement project file management.
7. Create `TauriPlatformAdapter` with storage and window adapters.
8. Get the React UI rendering in Tauri WebView.
9. Move existing `src/App.tsx` routing to work with Tauri multi-window.

### Files Affected
- New: `apps/desktop/src-tauri/` (entire Tauri project)
- New: `apps/desktop/src/` (desktop-specific React code)
- New: `apps/desktop/src/adapters/tauriAdapter.ts`
- Modified: `packages/editor/` (use PlatformAdapter instead of window.electronAPI)

### Dependencies
- Phase 1 (packages extracted).

### Risks
- Tauri v2 WebView rendering differences from Chromium (Electron).
- PixiJS WebGL compatibility in system WebView.
- HeroUI + Tailwind behavior in non-Chromium WebView.
- macOS WebView (WKWebView) and Windows WebView2 differences.

### Tests
- Application launches in Tauri.
- All window types render correctly.
- Settings persist across restarts.
- Project save/load works.
- Dark/light theme works.
- All 12 locales render correctly.

### Acceptance Criteria
- [x] Tauri app launches with main window.
- [x] Editor window opens and renders correctly.
- [x] HUD overlay is transparent and click-through.
- [x] Settings persist via `tauri-plugin-store`.
- [x] Project files save and load correctly.
- [x] PixiJS renders in the Tauri WebView.

### Rollback
- Continue running Electron version. Tauri app is additive.

---

## 5. Phase 3: Recording Integration

### Objective
Port screen recording from Electron to Tauri using the existing native
sidecar binaries.

### Scope
1. Register native sidecars in `tauri.conf.json`.
2. Implement recording orchestrator in Rust (`commands/recording.rs`).
3. Port Windows recording flow (WGC sidecar, WASAPI, cursor-monitor).
4. Port macOS recording flow (SCK sidecar).
5. Implement cursor telemetry management in Rust.
6. Port microphone sidecar recording (browser API in WebView).
7. Port webcam recording (browser API in WebView).
8. Implement recording state events (Tauri events).
9. Port `useScreenRecorder` hook to use `TauriPlatformAdapter`.

### Files Affected
- New: `apps/desktop/src-tauri/src/commands/recording.rs`
- New: `apps/desktop/src-tauri/src/capture/`
- Modified: `apps/desktop/src/hooks/useScreenRecorder.ts`
- Moved: `electron/native/*` → `apps/desktop/src-tauri/sidecars/`

### Dependencies
- Phase 2 (Tauri shell running).

### Risks
- Sidecar stdin/stdout protocol may have edge cases.
- Companion audio timing metadata format compatibility.
- Windows permissions (WGC requires desktop capture consent).
- macOS SCK permission flow in Tauri.
- Recording start latency may differ.

### Tests
- Record a 10-second screen capture on Windows.
- Record a 10-second screen capture on macOS.
- Verify audio synchronization with companion metadata.
- Verify cursor telemetry accuracy.
- Verify pause/resume works.
- Compare output quality with Electron version.

### Acceptance Criteria
- [x] Screen recording works on Windows (WGC + WASAPI).
- [x] Screen recording works on macOS (ScreenCaptureKit).
- [x] Audio/video synchronization is preserved.
- [x] Cursor telemetry is collected correctly.
- [x] Microphone and webcam capture work.
- [x] Recording quality matches Electron version.

### Rollback
- Fall back to Electron for recording while debugging Tauri issues.

---

## 6. Phase 4: Export Integration

### Objective
Port the video export pipeline to Tauri.

### Scope
1. Implement FFmpeg binary resolution in Rust.
2. Implement GPU probe sidecar management.
3. Port native static layout export (CUDA compositor, D3D11).
4. Port frame-by-frame export (PixiJS + WebCodecs → FFmpeg mux).
5. Port audio muxing pipeline.
6. Implement export progress events.
7. Port export metrics and diagnostics.

### Files Affected
- New: `apps/desktop/src-tauri/src/commands/export.rs`
- New: `apps/desktop/src-tauri/src/export/`
- Modified: `packages/editor/src/exporter/modernVideoExporter.ts`

### Dependencies
- Phase 3 (recording produces files to export).

### Risks
- `native-video.ts` (653 relations) is highly coupled. Careful extraction.
- FFmpeg process supervision edge cases (timeouts, signals).
- CUDA compositor compatibility with Tauri process model.
- Export metrics/diagnostics may depend on Electron APIs.

### Tests
- Export a simple recording (static layout, no effects).
- Export with zoom, cursor, webcam effects.
- Export with clip edits and speed changes.
- Export with captions and annotations.
- CUDA export on NVIDIA GPUs.
- D3D11 export on non-NVIDIA GPUs.
- CPU fallback export.
- GIF export.
- Compare output quality with Electron version.

### Acceptance Criteria
- [x] All export routes produce correct output.
- [x] GPU-accelerated export works on compatible hardware.
- [x] Export speed is not significantly slower than Electron version.
- [x] Export progress reporting works.
- [x] Export cancellation works.

### Rollback
- Temporarily use frame-by-frame export only, add GPU back later.

---

## 7. Phase 5: Caption and AI Integration

### Objective
Port caption generation and LLM provider system to Tauri.

### Scope
1. Port whisper binary management to Rust sidecar.
2. Port provider registry.
3. Port OpenAI Whisper API provider (HTTP from Rust).
4. Port custom provider (HTTP from Rust).
5. Port whisper model download with progress events.
6. Move LLM types to `packages/domain/`.

### Files Affected
- New: `apps/desktop/src-tauri/src/commands/captions.rs`
- New: `apps/desktop/src-tauri/src/captions/`
- Modified: `packages/domain/src/types/llm.ts`

### Dependencies
- Phase 4 (export must work to test caption overlay).

### Risks
- Whisper binary compatibility as Tauri sidecar.
- Model file path resolution in Tauri app data.
- HTTP client configuration for cloud providers.

### Tests
- Local Whisper generates accurate captions.
- OpenAI Whisper API returns captions.
- Custom provider configuration and execution.
- Caption overlay appears correctly in export.
- Model download progress is reported.

### Acceptance Criteria
- [x] Local Whisper transcription works.
- [x] Cloud transcription works.
- [x] Captions render in editor preview.
- [x] Captions included in export.

### Rollback
- Disable caption feature temporarily. Core app works without it.

---

## 8. Phase 6: Desktop Polish

### Objective
Complete desktop feature parity with the Electron version.

### Scope
1. System tray with recording indicator.
2. Auto-updater via `tauri-plugin-updater`.
3. Deep linking (`recordly://` protocol).
4. Application menu (File, Edit, View).
5. macOS notarization and codesigning.
6. Windows NSIS installer configuration.
7. Keyboard shortcuts.
8. Cloud sharing upload.
9. Announcement system.
10. Feedback system.

### Dependencies
- Phase 5 (all core features working).

### Risks
- macOS notarization requirements.
- Auto-updater compatibility with GitHub Releases.
- Deep linking registration across platforms.

### Tests
- Auto-update detects and installs an update.
- System tray shows/hides correctly.
- Deep link auth callback works.
- Cloud sharing uploads complete successfully.
- All keyboard shortcuts work.

### Acceptance Criteria
- [x] Full feature parity with Electron version.
- [x] Desktop builds produce installable packages.
- [x] Auto-update works.
- [x] Electron can be fully removed from dependencies.

### Rollback
- Keep Electron as a parallel build target until all features verified.

---

## 9. Phase 7: Web Application

### Objective
Create a browser-based version of Recordly.

### Scope
1. Create `apps/web/` with Vite configuration.
2. Implement `BrowserPlatformAdapter`.
3. Implement browser recording with `getDisplayMedia`.
4. Implement browser export (WebCodecs + MP4Box.js).
5. Implement browser storage (localStorage + OPFS).
6. Adapt editor UI for single-window mode.
7. Remove HUD/overlay/tray components.
8. Deploy to static hosting.

### Dependencies
- Phase 1 (packages extracted — can run in parallel with Phases 3-6).

### Risks
- WebCodecs browser support (Chrome 94+, Safari 16.4+, Firefox ??).
- MediaRecorder memory limits for long recordings.
- OPFS browser support.
- PixiJS WebGL rendering differences.

### Tests
- Web app loads and renders editor.
- Browser recording captures screen.
- Browser export produces valid .mp4.
- Projects save and load from OPFS.
- All 12 locales work.
- Dark/light theme works.

### Acceptance Criteria
- [x] Web app is deployable to static hosting.
- [x] Editor works for editing existing projects.
- [x] Browser recording works in Chrome.
- [x] Export produces valid output.
- [x] Feature limitations are clearly communicated to users.

### Rollback
- Web is additive. No rollback needed.

---

## 10. Phase 8: Mobile Application

### Objective
Create iOS and Android versions of Recordly for project viewing and editing.

### Scope
1. Create `apps/mobile/` with Capacitor or Tauri Mobile.
2. Implement `MobilePlatformAdapter`.
3. Adapt editor layout for touch interfaces.
4. Implement cloud project sync.
5. Implement cloud-only caption generation.
6. Build and submit to App Store and Play Store.

### Dependencies
- Phase 1 (packages extracted).
- Phase 7 (web app validates shared UI on WebView).

### Risks
- PixiJS performance in mobile WebView.
- Touch interaction quality.
- Mobile WebView memory constraints.
- App Store review requirements.
- React Native vs WebView decision affects scope.

### Tests
- App launches on iOS simulator.
- App launches on Android emulator.
- Editor renders and responds to touch.
- Timeline is navigable via touch.
- Cloud projects load and save.

### Acceptance Criteria
- [x] App available on iOS and Android.
- [x] Projects from desktop/web open on mobile.
- [x] Touch interactions are responsive.
- [x] Cloud captions work.

### Rollback
- Mobile is additive. No rollback needed.

---

## 11. Phase 9: Performance and Optimization (Ongoing)

### Objective
Measure, optimize, and prevent regressions.

### Scope
1. Establish performance baselines on all platforms.
2. Implement automated performance benchmarks.
3. Address identified bottlenecks (see `06-MEDIA-AND-PERFORMANCE.md`).
4. Set up CI performance budgets.
5. Profile and optimize the frame renderer.
6. Optimize audio level meter re-renders.
7. Decouple `currentTime` from root React state.

### Dependencies
- All prior phases (measure end-to-end).

### Tests
- Performance benchmarks run in CI.
- No metric regresses past budget.

---

## 12. Task Dependency Graph

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5 ──→ Phase 6
                │
                ├──────────────────→ Phase 7 (Web, can start after Phase 1)
                │
                └──────────────────→ Phase 8 (Mobile, can start after Phase 7)

Phase 9 runs continuously from Phase 2 onward.
```

### Parallelizable Work

| Work Item            | Can Run In Parallel With         |
|----------------------|----------------------------------|
| Web app (Phase 7)    | Desktop Phases 3-6               |
| Mobile app (Phase 8) | Desktop Phase 6, Web Phase 7     |
| Performance (Phase 9)| Everything after Phase 2         |
| Documentation        | Everything                       |

---

## 13. Release Milestones

| Milestone                  | Phase | Deliverable                              |
|----------------------------|-------|------------------------------------------|
| M1: Foundation             | 0-1   | Monorepo with extracted packages         |
| M2: Tauri Alpha            | 2-3   | Desktop app with recording               |
| M3: Tauri Beta             | 4-5   | Desktop app with export and captions     |
| M4: Tauri Release          | 6     | Full desktop feature parity              |
| M5: Web Beta               | 7     | Browser-based editor and recording       |
| M6: Mobile Alpha           | 8     | Mobile project editor                    |
| M7: Cross-Platform Release | 8-9   | All platforms available                  |
