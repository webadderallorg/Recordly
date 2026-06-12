# Fill-Frame Scene Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-time-range "fill frame" mode — the screen recording animates between the framed look (background/padding/shadow/radius) and covering the full canvas — controlled from the timeline, via ⌥+. / ⌥+, editor shortcuts, and via the same shortcuts during recording (imported as pre-split segments).

**Architecture:** Clone the proven `webcamLayoutRegions` pattern (type → timeline track → time-resolution → persistence → recording sidecar → editor import) as `fillFrameRegions`. Cover-fit + animation live in `computePaddedLayout`: it gains a `fillFrameProgress` 0..1 parameter and lerps between the framed layout and a cover layout; editor playback and both exporters all call this same function, so the animated transition is identical everywhere. Wallpaper/shadow/radius fade out with progress.

**Tech Stack:** TypeScript, React, Pixi (existing), vitest, biome. No git in working copy — verification steps replace commits.

**Scope note:** v1 deliberately models scene styles as fill-frame ranges over the single global style (Michael's presentation/demo workflow). Arbitrary per-segment wallpaper/padding overrides are a future increment on the same segment rails.

**Key anchors (verified 2026-06-11):**
- `computePaddedLayout` — `src/components/video-editor/videoPlayback/layoutUtils.ts:50` (contain-fit `Math.min` at lines 92–95)
- Editor layout call — `VideoPlayback.tsx:170` (`layoutVideoContentUtil`, calls computePaddedLayout ~line 200)
- Exporters import it — `frameRenderer.ts:36`, `modernFrameRenderer.ts:42`; config fields `wallpaper`/`borderRadius`/`padding` in both `FrameRenderConfig`s
- Region pattern — `src/components/video-editor/webcamLayoutRegions.ts` (`WebcamLayoutRegion`, `isCameraFullAtMs:202`, `eventsToWebcamLayoutRegions:169`)
- Timeline camera track — `timeline/components/viewport/TimelineCanvas.tsx:44` (`HINT_CAMERA`), TimelineEditor props `onCameraSpanChange/onCameraDelete/onCameraAddAtMs:74-76`
- Editor state — `VideoEditor.tsx:407-591` (wallpaper/shadow/borderRadius/padding/aspectRatio), regions state ~521, project snapshot ~1660/1772
- Shortcuts — `src/lib/shortcuts.ts` (`SHORTCUT_ACTIONS:1`, `DEFAULT_SHORTCUTS:75`, labels:84), dialog auto-renders
- Recording sidecar — `electron/ipc/recording/webcamLayoutEvents.ts` (event shape `{timeMs, mode}`, `{version, style, events}` JSON, path helper:21), IPC `webcam-layout-toggle` in `electron/ipc/register/recording.ts:1421`, `beginWebcamLayoutSession` at `electron/main.ts:991`, persist in `electron/ipc/recording/mac.ts:231`, editor import in VideoEditor via `getWebcamLayoutEvents`
- HUD globalShortcut — `electron/main.ts:9` imports it; `unregisterAll` at :877

---

### Task B1: fillFrameRegions module + persistence

**Files:**
- Create: `src/components/video-editor/fillFrameRegions.ts`
- Test: `src/components/video-editor/fillFrameRegions.test.ts`
- Modify: `src/components/video-editor/projectPersistence.ts` (normalize like `webcamLayoutRegions`, ~line 706/1080)

- [ ] Define `FillFrameRegion { id: string; startMs: number; endMs: number }`; functions `isFillFrameAtMs(regions, timeMs)`, `fillFrameProgressAtMs(regions, timeMs, transitionMs = 400)` returning 0..1 with smoothstep ease across each boundary (0 outside, 1 inside, ramp centered on the boundary), `eventsToFillFrameRegions(events)` (clone of `eventsToWebcamLayoutRegions` with mode `"fill" | "framed"`), `addFillFrameRegionAtMs`, `endFillFrameRegionAtMs`, `normalizeFillFrameRegions` (sort, drop invalid/overlapping).
- [ ] TDD: failing tests first (progress is 0 well outside, 1 well inside, ~0.5 at boundary, monotone across the ramp; events round-trip; overlap handling), then implement, then green.
- [ ] Persist: `fillFrameRegions` in `normalizeProjectEditor` + editor snapshot type, defaulting `[]` (follow `webcamLayoutRegions` lines exactly). Round-trip test.

### Task B2: cover layout + animated transition (editor + both exporters)

**Files:**
- Modify: `src/components/video-editor/videoPlayback/layoutUtils.ts` (+ its test file)
- Modify: `src/components/video-editor/VideoPlayback.tsx`, `src/lib/exporter/frameRenderer.ts`, `src/lib/exporter/modernFrameRenderer.ts`

- [ ] `computePaddedLayout` gains optional `fillFrameProgress?: number` (default 0). Internally compute the existing framed result and a cover result (padding 0, `Math.max` scale), then lerp every numeric field of `PaddedLayoutResult` by smooth progress. Unit tests: progress 0 === current behavior (regression), progress 1 covers (scale fills shorter axis, crops longer), 0.5 strictly between.
- [ ] Editor playback: resolve `fillFrameProgressAtMs(fillFrameRegions, currentTimeMs)` in the per-frame layout path; pass to layout; multiply wallpaper/background layer alpha and shadow/radius by `(1 - progress)`.
- [ ] Both exporters: add `fillFrameRegions?: FillFrameRegion[]` to `FrameRenderConfig`; resolve progress per frame at `this.currentVideoTime`; same fades. Existing exporter tests stay green (no regions → progress 0 → unchanged).

### Task B3: timeline track + editor shortcuts

**Files:**
- Modify: timeline (clone camera-track wiring: `TimelineCanvas.tsx`, `TimelineEditor` props), `VideoEditor.tsx`, `src/lib/shortcuts.ts`, ShortcutsContext consumer where editor actions dispatch

- [ ] Fill-frame track on the timeline below/with the camera track: render `fillFrameRegions` segments ("Fullscreen" label), drag-resize via `onFillFrameSpanChange`, delete via `onFillFrameDelete`, `onFillFrameAddAtMs` (clone the camera handlers in VideoEditor).
- [ ] Shortcuts: add `fillFrameOn` (`{ key: ".", alt: true }`) and `fillFrameOff` (`{ key: ",", alt: true }`) to SHORTCUT_ACTIONS/DEFAULT_SHORTCUTS/labels. Editor handlers: ⌥+. starts (or extends) a fill region at the playhead to the next region/end; ⌥+, ends the active region at the playhead (no-op when already in the requested state). Pure helpers from Task B1 do the math.

### Task B4: recording hotkey + sidecar + import + HUD indicator

**Files:**
- Create: `electron/ipc/recording/sceneStyleEvents.ts` (clone `webcamLayoutEvents.ts`; events `{timeMs, mode: "fill" | "framed"}`, file `${videoPath}.scene-style-events.json`)
- Modify: `electron/ipc/register/recording.ts` (IPC `scene-style-toggle`), `electron/main.ts` (begin session at recording start; register `Alt+.`/`Alt+,` globalShortcut during recording only, unregister on stop — send to HUD renderer), `electron/preload.ts` + `electron-env.d.ts` (`getSceneStyleEvents`, `sceneStyleToggle`, `onSceneStyleHotkey`), persist alongside `persistWebcamLayoutEvents` call sites (mac.ts:231 and Windows/browser equivalents)
- Modify: HUD renderer (`useScreenRecorder.ts`/`LaunchWindow`/`RecordingControls.tsx`): on hotkey event → compute `timeMs = getRecordingDurationMs(Date.now())`, send `scene-style-toggle`, show small mode badge ("Fullscreen"/"Framed") in the recording strip
- Modify: `VideoEditor.tsx`: on project open, `getSceneStyleEvents(videoSourcePath)` → `eventsToFillFrameRegions` → seed `fillFrameRegions` when empty (clone the webcam-layout import effect)

- [ ] Implement in that order; recording starts in framed mode; events only recorded while actually recording (not paused).
- [ ] Verify: typecheck, biome, vitest full suite (only known pre-existing binaries.test.ts failure allowed).

### Task B5: full verification

- [ ] `npx tsc --noEmit`, `npx biome check` on touched files, `npx vitest run` — green except known pre-existing failure
- [ ] Manual: editor — add fill region, scrub across boundary (animated), export matches preview; recording — ⌥+./⌥+, during recording → segments appear on open.
