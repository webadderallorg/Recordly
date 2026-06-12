# Timeline Camera Track + Facecam Style — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

1. Make the recorded camera-full segments (`webcamLayoutRegions`) visible and
   fully editable on the editor timeline.
2. Let the user choose, before recording, how camera-full segments render:
   **fit** (current letterbox with background border) or **fill** (camera
   covers the whole frame, cropped, edge-to-edge).

## 1. Camera track on the timeline

- A slim dedicated track renders each region in `webcamLayoutRegions` as a
  blue segment bar (blue matches the teleprompter's camera-full highlight).
- Track appears only when the project has a usable webcam
  (`webcam.enabled && webcam.sourcePath`) AND regions exist or the user adds
  one; respects nothing else — the "Use recorded camera switches" checkbox
  still gates rendering, not track visibility (a disabled state dims the
  segments).
- **Editing** (all updates write back to `webcamLayoutRegions` project state,
  marking the project dirty and flowing into preview/export immediately):
  - Drag either edge → adjust `startMs`/`endMs` (in/out points).
  - Drag the segment body → move it (duration preserved).
  - Click to select; the existing `deleteSelected` shortcut and a context
    affordance delete it.
  - Double-click empty track space → add a new segment at that position
    (default ~3s long, clamped to the video and to neighbors).
- Constraints: segments stay within `[0, videoDurationMs]`, never overlap
  (clamp against neighbors while dragging), minimum length 100ms.
- Implementation reuses the timeline's existing dnd-timeline `Item` pattern
  (drag + resize handles) and row infrastructure
  (`src/components/video-editor/timeline/`), with a new row + item variant.
- Regions are stored and displayed in source time, exactly like zoom regions.
  (When the magnet collapsed-view mode from the companion spec is active, the
  track maps through the same source↔timeline display conversion as every
  other track.)

## 2. Facecam style (fit vs fill)

- `WebcamLayoutStyle = "fit" | "fill"`.
  - **fit** — current behavior: cropped camera letterboxed over the project
    background with `CAMERA_FULL_PADDING_FRACTION` padding, squircle corners,
    shadow.
  - **fill** — camera covers the entire output frame (`Math.max` scale,
    center-cropped), no padding, no corner radius, no shadow.
- **HUD (pre-record):** a style item in the webcam popover
  (`WebcamPopover.tsx`), persisted in HUD localStorage, default `fit`.
  Relayed to the main process with the existing webcam-device-changed pattern.
- **Sidecar:** the layout-events sidecar gains a `style` field
  (`{ version: 2, style: "fit" | "fill", events: [...] }`), written from the
  HUD's choice at recording start. Version-1 sidecars (no style) read as
  `fit`. The reader stays tolerant of both versions.
- **Editor:** project state gains `webcamLayoutStyle` (default `fit`,
  normalized in `projectPersistence`), seeded from the sidecar on fresh-
  recording load (same guard pattern as the regions). A small fit/fill
  selector appears in the webcam settings next to "Use recorded camera
  switches". Persisted in the project file.
- **Renderers:** both `VideoPlayback.tsx` and `modernFrameRenderer.ts` branch
  on the style in their camera-full paths. A `getCoverRect(content, frame)`
  pure function (sibling of `getLetterboxRect` in `webcamLayoutRegions.ts`)
  provides the fill geometry; the existing inner "cover" crop math then crops
  the overflow naturally.

## Out of scope

Per-segment style (one style per project), transitions, multiple camera
tracks, GIF export support (same known limitation as camera-full itself).

## Testing

- Pure: `getCoverRect` geometry; segment clamping/overlap math for timeline
  edits; sidecar v1/v2 read compatibility; style normalization round-trip.
- Manual: record with both styles; drag/move/add/delete segments on the
  track; verify preview + MP4 export match in both styles.
