# Timeline Magnet, Black Gaps, and B-to-Cut — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

1. **B to cut:** default the existing split-at-playhead shortcut to `B`.
2. **Magnet toggle** (timeline toolbar, ON by default, persisted): controls
   what deleting a clip means and how the timeline displays.
3. **Black gaps:** with magnet OFF, gaps are real black time — played smoothly
   in preview and emitted as black segments in the export (WYSIWYG).
4. **Fix the gap playback glitch:** today the player seek-skips trim regions
   with no re-entry guard, causing the skip→replay→loop freeze the user hit.

## Background (current model)

- `ClipRegion[]` are kept source-time segments; the complement is computed
  into `TrimRegion[]` (`clipsToTrims`). Export removes trim time; preview
  seek-skips trims (`videoEventHandlers.ts` `updateTime` →
  `skipPastTrimRegion`, the glitch site).
- The timeline displays source time, so deleting a clip leaves a visible gap.
- Source↔timeline time mapping already exists
  (`mapTimelineTimeToSourceTime` / `mapSourceTimeToTimelineTime` in
  `types.ts:274-311`).
- Split-at-playhead exists (`handleClipSplit`, default shortcut `C`,
  configurable via the shortcuts dialog; hint text on the timeline canvas).

## 1. B to cut

Change `DEFAULT_SHORTCUTS.splitClip` from `{ key: "c" }` to `{ key: "b" }` in
`src/lib/shortcuts.ts`, update the timeline hint text ("Press B to split
clip") and any labels. Users with saved custom shortcuts keep their bindings
(defaults only apply when unset). No conflict: `b` is unused.

## 2. Magnet (project setting `magnetEnabled`, default true)

A magnet icon toggle in the timeline toolbar; state lives in project editor
state (normalized default `true`) and carries the semantic meaning of gaps:

- **Magnet ON (ripple):** semantics identical to today's data model — deleted
  time is removed (trims cut from export, skipped in preview). What changes
  is the **timeline display**: the timeline renders in *timeline time*
  (gap-collapsed) — clips appear contiguous, the playhead, all tracks (zoom,
  annotations, audio, camera), the ruler, and click/drag interactions map
  through the existing source↔timeline conversion. Deleting a clip therefore
  visibly "pulls everything left" without any data migration.
- **Magnet OFF (gaps):** the timeline renders in source time (as today);
  gaps remain visible and become **black time**:
  - **Preview:** entering a trim region no longer seeks. The video element
    pauses at the gap start, a wall-clock driver advances the playhead
    through the gap in real time, the canvas shows black (screen content
    hidden, background NOT drawn — true black), all audio is silent, then
    the video seeks to gap end and resumes. Scrubbing into a gap shows
    black.
  - **Export:** trim regions are emitted as black segments of identical
    duration with silent audio, so exported duration = source duration of
    clips + gaps. Projects with `magnetEnabled: false` AND at least one gap
    route to the JS/WebCodecs exporter via a new native-static-layout skip
    reason (`unsupported-black-gaps`), mirroring the camera-switch pattern.
- Toggling the magnet only changes display mode and gap semantics; it never
  rewrites clip data, so it is fully reversible and undo-friendly.

## 3. Glitch fix (applies in magnet-ON mode)

In `videoEventHandlers.ts` `updateTime`: after initiating a seek past a trim
region, record the seek target and suppress further trim handling until the
presented time passes the target (or a seeked event fires). This removes the
skip→replay loop when frame callbacks arrive late. (Magnet-OFF mode replaces
seeking with the wall-clock black-gap driver above, which has no such race.)

## Interactions & edge cases

- Audio regions/user tracks during black gaps stay audible only if they were
  placed over that timeline range deliberately — investigate how audio
  regions bind (timeline vs source time) during planning and keep their
  current binding behavior; SOURCE audio is always silent in gaps.
- Speed regions never overlap gaps (they bind to clips).
- Camera-full segments overlapping a gap render black like everything else
  (gap wins — screen and webcam both hidden).
- A gap at the very start/end of the video is preserved in export.
- Switching magnet ON with existing gaps: gaps collapse from display and
  export (time removed) — explained by the toggle's tooltip.

## Out of scope

Drag-to-rearrange clip order, inserting gaps deliberately (only deletion
creates them), GIF export black-gap support (same limitation class as
camera-full), gap support in the native/Breeze export paths.

## Testing

- Pure: display-space conversion helpers used by the timeline (round-trip
  source↔timeline for all track types); black-gap segment derivation for the
  exporter (clips+trims → render plan with black spans); seek re-entry guard
  state machine.
- Manual: delete with magnet ON (ripple, smooth playback, export drops
  time); delete with magnet OFF (black gap plays smoothly, export contains
  black of the right length); B splits at playhead; glitch scenario (delete a
  middle clip, play across the boundary) no longer loops.
