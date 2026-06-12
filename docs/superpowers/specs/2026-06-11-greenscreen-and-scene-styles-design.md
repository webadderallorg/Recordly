# Greenscreen Facecam + Scene Styles — Design

**Date:** 2026-06-11
**Status:** Awaiting Michael's approval

## Goals

1. Replace a physical green screen behind the facecam with an uploaded image,
   non-destructively, identical in editor preview and export.
2. Clean up the key with a garbage matte (mask out walls / screen edges) and
   facecam color controls (brightness, contrast, highlights, shadows).
3. Make background styling **per-scene** instead of global: presentation
   segments show the recording fullscreen edge-to-edge; demo segments show the
   framed look (background image, shadow, padding).
4. A recording-time hotkey toggles presentation/demo scene mode, and the
   editor imports those switches as pre-split style segments.
5. "Remove background" fills the 16:9 canvas (cover-crop) instead of
   letterboxing the 16:10 screen recording on black.

Out of scope (future): freeform brush masking, style crossfade transitions,
virtual background without green screen (ML segmentation).

## 1. Facecam processing pipeline (chroma key, matte, color)

One shared WebGL2 module, `src/lib/webcamProcessing/`, used by both the editor
playback and the exporter so output matches pixel-for-pixel.

**Pipeline order per frame:** crop → garbage matte → chroma key → color
adjust → composite over background image (mirror stays at composite stage,
unchanged).

- **Chroma key:** shader computes chroma distance from key color (fixed
  standard green internally), producing alpha + green-spill suppression.
  Controls: `keyStrength` (tolerance) and `edgeSoftness`. Simple mode only —
  no OBS-style panel.
- **Garbage matte:** rounded-rectangle "keep" region in normalized webcam
  coordinates with a `feather` softness value. Everything outside the shape
  gets alpha 0 (replaced by the background image like keyed pixels). Editing
  UI mirrors the existing Webcam Crop drag-handle widget.
- **Color controls:** brightness, contrast, highlights, shadows — applied to
  the keyed foreground only (so grading doesn't destabilize the key). Active
  independently of keying: if any control is non-default, the pipeline runs
  even with keying off.
- **Fallbacks:** WebGL unavailable → pipeline disabled gracefully (raw webcam
  shown, toast once). Missing background image → unkeyed webcam + notice.
- The alpha/color math lives in pure functions with unit tests; the shader
  mirrors them.

**Settings** extend `WebcamOverlaySettings` (persisted with the project):

```ts
greenscreen?: {
  enabled: boolean;
  backgroundImagePath: string | null; // copied into project assets
  keyStrength: number;   // 0..1
  edgeSoftness: number;  // 0..1
}
mask?: {
  enabled: boolean;
  rect: { x: number; y: number; width: number; height: number }; // normalized
  cornerRadius: number;
  feather: number; // 0..1
}
color?: {
  brightness: number; contrast: number; highlights: number; shadows: number;
  // all default 0 (neutral), range -1..1
}
```

**UI:** webcam panel in the editor gains three groups: "Green Screen"
(toggle, image picker w/ thumbnail, two sliders), "Mask" (toggle, edit-mask
widget, feather slider), "Color" (four sliders, reset).

**Image upload:** native file dialog; image copied into the project's assets
folder so projects stay portable; path stored in settings.

## 2. Scene styles (per-segment backgrounds)

**Data model** (project-persisted):

```ts
interface BackgroundStyle {
  // the fields that are global today:
  backgroundSource: { kind: "wallpaper" | "custom" | "none"; value?: string };
  shadow: number; radius: number; padding: number;
  removeBackground: boolean; // none/fullscreen mode
}
interface StyleSegment { id: string; startMs: number; endMs: number; style: BackgroundStyle }
// project: { defaultStyle: BackgroundStyle; styleSegments: StyleSegment[] }
```

- The existing global controls become `defaultStyle`. Existing projects
  migrate transparently (current values → defaultStyle, no segments).
- Resolution: style at time t = segment containing t, else defaultStyle.
  Gaps and out-of-range times fall back to defaultStyle. Inner⟷outer rect
  changes animate (section 3); all other style changes are hard cuts in v1.
- **Timeline UI:** a style track following the camera-track pattern. "Split
  style at playhead" action; clicking a segment scopes the background tab to
  it. The background tab shows an "Editing: Entire video / Segment" indicator
  so it's always clear what a tweak applies to.
- Playback and export both read the resolved style per frame; the export
  frame renderers already restyle per frame (zoom etc.), so style switching
  is an extension of existing per-frame config, not a new mechanism.

## 3. Fill-frame mode (two nested rectangles)

The screen recording has exactly two layout states — the same content in one
of two rectangles:

- **Inner rect (framed / demo):** recording inset on the background with
  padding, shadow, and corner radius — today's default look.
- **Outer rect (fill frame / presentation):** recording scaled to **cover**
  the full 16:9 canvas, centered, overflow cropped (the automatic version of
  the manual 8%/5% crop). Background, padding, shadow, radius are not shown.

`removeBackground: true` in a style means the outer rect. Switching between
segments with different rects **animates**: the recording scales smoothly
between the inner and outer rectangle using the existing zoom-transition
easing, rather than hard-cutting. (Other style changes — e.g. different
wallpapers — remain hard cuts in v1.)

### Hotkeys (editor + recording)

- **⌥ + > (Option+period):** fill frame (outer rect)
- **⌥ + < (Option+comma):** framed (inner rect)

In the editor: pressing a hotkey at the playhead splits a style segment there
and applies that mode from the playhead forward to the next boundary; no-op
if that mode is already active. Registered through the existing shortcuts
system (rebindable). During recording, the same shortcuts emit scene events
(section 4).

## 4. Recording-time scene hotkey

- The same two shortcuts as the editor (⌥+> fill frame, ⌥+< framed) set the
  scene mode during recording. Recording always starts in framed/demo mode
  (defaultStyle). The HUD shows a small indicator of the current mode.
- Each toggle appends `{ timestampMs, mode }` to a sidecar event file next to
  the recording, following the existing `*.webcam-layout-events.json`
  pattern (new file: `*.scene-style-events.json`).
- On project open, the editor converts events into initial `styleSegments`:
  presentation → `removeBackground: true` style; demo → defaultStyle. A
  "Use recorded scene switches" toggle mirrors the existing "Use recorded
  camera switches" behavior; segments stay fully editable afterwards.

## Error handling summary

- Style segments: overlaps prevented at creation; gaps resolve to
  defaultStyle; segments clamped to clip bounds on trim.
- Scene event file missing/corrupt → no segments, default style, no error.
- Mask rect degenerate (zero area) → treated as disabled.
- All new settings round-trip through project persistence with defaults for
  older project files.

## Testing

- Pure-function unit tests: key alpha math, matte falloff, color transforms,
  style-at-time resolution, segment split/clamp logic, scene-event → segment
  conversion, persistence migration (old project → defaultStyle).
- Existing suites must stay green (typecheck, biome, vitest).
- Manual verification: record with hotkey toggles → segments appear; export
  matches editor preview.

## Build order

1. Webcam processing pipeline (key + matte + color) with editor preview.
2. Export integration (both frame renderers).
3. Scene styles data model + migration + timeline UI + fill-frame mode.
4. Recording hotkey + event sidecar + editor import.
