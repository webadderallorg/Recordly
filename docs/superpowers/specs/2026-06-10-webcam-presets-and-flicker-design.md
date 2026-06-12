# Webcam Layout Presets Fix + Position-Slider Flicker Fix — Design

**Date:** 2026-06-10
**Status:** Approved (conversation 2026-06-10)

## Goals

1. **Consistent webcam framing across recordings**: the user dials in exact
   webcam position/size/crop once and reuses it for every future recording.
2. **Fix the preview flicker**: dragging the webcam "Custom position"
   Horizontal/Vertical sliders makes the webcam preview momentarily render
   larger before snapping back, on every tick.

## 1. Webcam presets (fix existing feature, no new UI)

### What exists

`editorPreferences.ts` already implements named **editor presets**
(`EditorPreset` with full `EditorPresetSnapshot`, saved to
`recordly.editor.presets`) with save/apply/delete UI in `VideoEditor.tsx`,
and **editor preferences** (`recordly.editor.preferences`) that carry
last-used settings to new projects. Both include the `webcam` settings
object.

### The defect

`applyEditorPresetSnapshot` does `setWebcam({ ...snapshot.webcam })` —
replacing the **entire** webcam settings object, including the per-recording
fields `sourcePath`, `timeOffsetMs`, and `enabled`. Applying a saved preset to
a new recording therefore points the webcam at the *old* recording's webcam
file (or disables it), which is why presets don't deliver consistent framing
today. The same hazard applies wherever preferences seed a fresh project's
webcam settings. Snapshots in localStorage also store the stale `sourcePath`.

### The fix

Define the split once in `types.ts` / a small helper module:

- **Layout fields** (preset/preference-portable): `mirror`, `cropRegion`,
  `corner`, `positionPreset`, `positionX`, `positionY`, `size`, `reactToZoom`,
  `cornerRadius`, `shadow`, `margin`.
- **Per-recording fields** (never portable): `sourcePath`, `timeOffsetMs`,
  `enabled`.

Then:

1. `applyEditorPresetSnapshot` merges layout fields over the **current**
   webcam settings, preserving per-recording fields:
   `setWebcam((current) => ({ ...current, ...pickWebcamLayout(snapshot.webcam) }))`.
2. Preset save/serialize (`normalizeEditorPresetSnapshot`) strips
   per-recording fields (stores `sourcePath: null`, `timeOffsetMs: 0`,
   `enabled` normalized away) so stale paths never persist.
3. The preferences path that seeds a fresh recording's editor state applies
   only layout fields the same way (per-recording fields come from the
   recording manifest). Verify and correct that path during implementation —
   the exact seeding code is identified in the plan.

Result: "Save preset" (existing UI) captures exact framing; applying it — or
just opening the next recording, via preferences — reproduces position, size,
and crop without touching the webcam source.

## 2. Custom-position slider flicker

### Root cause (high-confidence hypothesis; verify first during implementation)

In `VideoPlayback.tsx`, `applyWebcamBubbleLayout` is a `useCallback` whose
deps include `webcamPositionX/Y` (changed on every slider tick). The callback
is a dependency of the heavy stage-layout effect (~line 1070) which, on each
run, **resets the zoom camera container to identity scale** before re-laying
out and re-applying webcam layout with `animationStateRef.current.appliedScale`.
When the preview is parked inside a zoom region (auto-zooms make this the
common case), every slider tick momentarily renders an un-zoomed frame /
wrong-scale webcam before the animation state reasserts — the "flickers
larger then back" the user sees.

### The fix

Decouple webcam layout from the heavy stage-layout effect:

- Move the webcam layout inputs (position, size, margin, etc.) into refs (or
  pass them as arguments resolved at call time) so `applyWebcamBubbleLayout`'s
  identity is stable and the heavy effect no longer re-runs on webcam-field
  changes.
- A new lightweight effect, depending only on the webcam fields, calls
  `applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1)`
  directly — a pure DOM/style update on the bubble, no container reset.

Acceptance: dragging Horizontal/Vertical (and size/margin/roundness) sliders
updates the bubble smoothly with no transient scale jump, including while the
playhead is inside a zoom region; zoom behavior and all other layout paths
are unchanged.

## Out of scope

New preset UI, multiple webcam-specific preset types (the general editor
presets cover it), changes to the export path (layout fields flow through
existing project state).

## Testing

- Unit: `pickWebcamLayout` split (layout vs per-recording fields); preset
  apply merge preserves `sourcePath`/`timeOffsetMs`/`enabled`; snapshot
  serialization strips per-recording fields (extend
  `editorPreferences.test.ts`).
- Flicker: where feasible, a unit test that the heavy layout effect's deps no
  longer include webcam position values (structural), plus manual
  verification dragging sliders inside a zoom region.
- Manual: save preset on recording A → open new recording B → apply preset →
  framing matches exactly and B's webcam video still plays.
