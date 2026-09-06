# Storyboard Feature — Reuse Map

Target: a **Storyboard** workspace for planning videos before recording/editing — a board of
frame cards (title, beat description, duration, transition, status chip), a review/approval
banner for pass-based feedback (plan → sketch → build → animate), per-frame comments, a
narration script, a source view for the board definition, and a preview mode with a
frame timeline, per-layer keyframe editing, and export.

This document maps every part of that feature to code that **already exists** in this repo,
so implementation reuses the editor instead of forking it. All paths verified against
`main` (v1.4.0-beta.1).

---

## TL;DR

Roughly **70% of the storyboard surface can be composed from existing modules**. The timeline,
keyframe markers, playback engine, still-frame renderer, ffmpeg export path, project persistence,
UI kit, and i18n are all directly reusable. The genuinely new code is the board grid itself, the
frame/comment data model (a new block in the existing project schema), markdown source view, and
the review-banner workflow.

---

## 1. Reuse map: storyboard surface → existing code

| Storyboard surface | Reuse from | How |
| --- | --- | --- |
| Frame timeline (preview mode) | `src/components/video-editor/timeline/TimelineEditor.tsx` | Already prop-driven/controlled: feed it frame spans instead of clip/trim regions; one row per frame, drag edges to change duration |
| Drag/resize/snap mechanics | `timeline/components/wrapper/TimelineWrapper.tsx`, `timeline/dnd/engine.ts` | Wraps `dnd-timeline` `TimelineContext`; converts drag events to span changes — reusable as-is for frame items |
| Keyframe editing (diamonds per layer) | `timeline/components/markers/KeyframeMarkers.tsx` | Draggable keyframe markers with `onKeyframeMove(id, absoluteMs)` — exactly the preview-mode interaction |
| Playhead + axis | `timeline/components/playhead/PlaybackCursor.tsx`, `timeline/components/axis/TimelineAxis.tsx` | Drop-in |
| Timeline rows (per-layer tracks) | `timeline/core/rows.ts`, `timeline/core/timelineTypes.ts` | `TimelineRenderItem { id, rowId, span, label, variant }` generalizes; add a `frame` variant |
| Frame/animation preview | `src/components/video-editor/VideoPlayback.tsx` (pixi.js 8) | Ref exposes `play/pause/refreshFrame`; drive one frame composition at a time |
| Keyframe animation math (position/scale/opacity/visual easing) | `src/components/video-editor/videoPlayback/` — `zoomTransform.ts`, `motionSmoothing.ts`, `cursorFollowCamera.ts`, `layoutUtils.ts` | Pure, unit-tested functions — reuse for interpolating storyboard frame properties |
| Frame thumbnails (card art) | `src/lib/exporter/frameRenderer.ts` → `FrameRenderer.renderFrame()` (line 1407) | Offscreen pixi composite of a single frame → capture to blob for the card thumbnail |
| Export board → video | `electron/ipc/export/native-video.ts` → `exportNativeStaticLayoutVideo()` (line 3189) | Chunked ffmpeg render of still frames + audio, then concat — the natural "animatic export" primitive |
| Full-effects export (later) | `src/lib/exporter/modernVideoExporter.ts` (`StreamingVideoDecoder` → `FrameRenderer` → `AudioProcessor` → `VideoMuxer`) | Same pipeline the editor uses; GIF exporter (`gifExporter.ts`) is a frame-sequence precedent |
| Narration audio track + waveform | `AudioRegion` (`video-editor/types.ts`), `audio/waveform/WaveformGenerator.ts`, `timeline/components/waveform/AudioWaveform.tsx`, `timeline/hooks/useTimelineAudioPeaks.ts` | Narration per frame = audio region constrained to the frame span; waveform comes free |
| Narration transcription / script sync | `electron/ipc/captions/` — `generate.ts` (whisper.cpp), `whisper.ts`, `parser.ts`, `silence.ts` | Auto-generate script draft from recorded narration; inverse of captions flow |
| Mic capture for narration read-through | `src/hooks/useScreenRecorder.ts`, `useMicrophoneDevices.ts`, `useAudioLevelMeter.ts` | Launcher-side recording hooks are UI-agnostic |
| Project file persistence (`.recordly`) | `src/components/video-editor/projectPersistence.ts` — `EditorProjectData` (line 169), `validateProjectData` (346), `normalizeProjectEditor` (356); `PROJECT_VERSION = 2` (85) | Add an optional `storyboard` block to `EditorProjectData`; extend validation/normalization the same way v1→v2 was done |
| Atomic save, autosave, project library | `electron/ipc/project/atomicSave.ts`, `hooks/useProjectSaveActions.ts` (1s autosave), `useProjectOpenActions.ts`, `useProjectLibraryController.ts` | Save/load lifecycle is generic — storyboard state rides along |
| Undo/redo | `src/components/video-editor/editorHistory.ts` + `hooks/useEditorHistory.ts` | Snapshot-based; add frame/comment arrays to `EditorHistorySnapshot` |
| Settings/preferences | `electron/appSettingsStore.ts`, `src/lib/appSettings.ts`, `editorPreferences.ts` | e.g. default frame duration, board density |
| Card grid UI | `src/components/ui/card.tsx`, `button.tsx`, `input.tsx`, `tabs.tsx`, `dialog.tsx`, `popover.tsx`, `select.tsx`, `slider.tsx`, `switch.tsx` (shadcn new-york + Tailwind tokens) | Board = CSS grid of `Card`s; thumbnail-model the grid on `ProjectBrowserDialog.tsx` + `useProjectLibraryController.ts` (thumbnail grid with metadata) |
| Status chips (outline/built/animated) | `src/lib/utils.ts` `cn()` + existing badge-like styling | No `badge.tsx` in `ui/` yet — add one small shadcn-style `badge.tsx` (the only new UI primitive) |
| Review/approval banner | `src/components/announcements/EditorAnnouncementBanner.tsx`, `AnnouncementDialog.tsx` | Pattern for a top-of-board dismissible action banner with CTA |
| Per-frame comments (inline edit list) | `timeline/components/panels/CaptionListPanel.tsx` | Ordered list of items with inline text editing — same interaction as frame comments |
| Resizable board/preview/split layout | `react-resizable-panels` (already a dependency, currently unused) | Board ↔ preview split; also the slideshow side panel |
| Slide-list side panel (deck mode) | `ui/tabs.tsx` + `ui/checkbox`-style toggles + list patterns from `CaptionListPanel` | Slides with visibility checkbox, reorder, inspector, notes |
| Card/panel motion | `motion` (dependency, ^12) | Status-chip flips, card pulse on comment submit |
| Toasts | `ui/sonner.tsx` | "Comments saved", "Export started" |
| Mount point (standalone window) | `src/App.tsx` `windowType` switch (line 23) + `electron/windows.ts` `createEditorWindow` (line 900) | Add `windowType="storyboard"` case → own window, same pattern as `editor` |
| Mount point (inside editor) | `EditorEffectSection` (`video-editor/types.ts` line 109) + `layout/EditorSidebar.tsx` `sections` array | Lower-friction alternative: a Storyboard section in the editor sidebar |
| i18n | `src/i18n/config.ts` namespaces, `useScopedT("editor")`, locale JSON under `src/i18n/locales/` | Add keys to `editor.json` (every `t()` takes an inline fallback); validate with `npm run i18n:check` |
| Tests | vitest (node env, colocated `*.test.ts`, `fast-check` for property tests) | Keep frame ordering/duration/transition logic in pure modules and test like `editorHistory.test.ts` |

## 2. What must be built new (no existing equivalent)

1. **Board grid + frame card component** — nothing kanban/grid-like exists; compose from `ui/card.tsx` + grid. Frame reorder = simple dnd (reuse `@dnd-kit`-free approach or `dnd-timeline`'s underlying kit is timeline-specific, so a minimal sortable list is fine).
2. **Storyboard data model** — frames (title, beat, duration, transition in/out, focal point, status), per-frame comments, narration script reference, review-pass state. Lives as a `storyboard` block inside `EditorProjectData`; **bump `PROJECT_VERSION`** and extend `normalizeProjectEditor`.
3. **Review workflow** — pass states (plan/sketch/build/animate), review banner state machine, comment save + "copy approval message". New, small, pure state machine → easy to test.
4. **Markdown source view** — no markdown dependency in the repo today. Either add a tiny MD serializer/parser for `STORYBOARD.md`/`SCRIPT.md`-style round-tripping, or ship the source view as JSON first. Text editing itself: `ui/input.tsx`/textarea + the `Saved/Save` button pattern from `useProjectSaveActions`.
5. **Frame ↔ editor bridge** — "send frame to editor / pull editor state as frame" actions wiring storyboard frames to `ClipRegion`/`ZoomRegion` state. This is glue, not new subsystems.
6. **Slideshow/deck side panel** — assemble from tabs + lists; no new primitives.

## 3. Deliberately *not* a path forward

- **Extensions system** — `EXTENSIONS.md` describes render hooks and settings panels, but the runtime is gone: `src/components/video-editor/ExtensionManager.tsx` is a placeholder ("Extensions are no longer available… disabled"). Do **not** build the storyboard as an extension; make it a first-class view.

## 4. Suggested build order

1. Data model + persistence: `storyboard` block in `projectPersistence.ts` (frames, comments, passes) + history snapshot extension + tests.
2. Board view in a new `windowType="storyboard"` window: card grid, status chips (new `badge.tsx`), comment inputs — static/outline status only.
3. Narration: attach `AudioRegion`-based narration per frame; waveform on the frame timeline; optional whisper transcription to draft `SCRIPT.md`.
4. Preview mode: reuse `TimelineEditor` (frame rows) + `KeyframeMarkers` + `VideoPlayback` driving frame compositions.
5. Review banner + passes on top of the comment model.
6. Export animatic via `exportNativeStaticLayoutVideo`; thumbnails via `FrameRenderer.renderFrame`.
7. Markdown source view last (needs a dependency decision).

## 5. Reference design

The interaction model this map targets: a dark board with a header (title, arc, audience, format,
frame count), Board/Source toggle, Storyboard/Preview modes, review banner with per-pass copy and
a frame-status counter (N Outline / N Built / N Animated), 4-column card grid with numbered
thumbnails, per-frame comment fields, duration + transition metadata, collapsible narration script,
and a preview timeline with per-layer keyframe rows and a narration waveform track.
