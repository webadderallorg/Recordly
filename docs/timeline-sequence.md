# Clip sequence timing

Primary footage is an ordered, contiguous sequence. A visual clip separator has no duration. Both sides of a cut at 2.8 seconds represent 2.8 seconds, even if the second clip starts at a different point in the source recording.

- `ClipRegion.startMs/endMs`: edited timeline coordinates.
- `sourceStartMs`: the retained recording in-point. Packing or reordering never derives this from the new timeline position.
- `speed`: source milliseconds consumed per timeline millisecond.
- `clipSequence.ts`: packs trims/deletes/speed changes, handles explicit insertion indices, and maps connected effects and audio anchors.
- `timeline/core/clipPresentation.ts`: maps media time into inset clip rectangles and back. Scrubbing a separator returns its cut timestamp. The playhead does not wait or animate through a separator.

Clip resizing is constrained by available source footage and minimum clip duration, rather than collision with the next clip. Dragging a clip chooses an insertion index rather than looking for empty space. Source-based captions are reprojected from their original cues. Imported audio retains its duration as its anchor moves. Annotation selection is independent of whether the annotation is visible at the current playhead time.

Legacy projects with primary-track gaps are normalized before establishing the loaded undo baseline. Editing and export use the same contiguous clip positions.

## Verification

135 focused unit tests passed for sequence packing/rippling, persistence, drag and resize resolution, visual seam mapping, playback, annotation visibility and deletion shortcuts. All 13 renderer regressions passed for block deletion, dragged annotation selection, background transitions, gap-free trims, clip reordering, and connected annotation/audio undo. These browser checks use fixture media and a mocked Electron bridge.

## Boundary snapping and preview motion

Timeline effects use the same media-to-display mapping as clips and the playhead. Dragging or resizing a zoom, annotation, caption, or audio block snaps within 8 screen pixels of other block boundaries, including clip cuts, at every timeline zoom level. Dragging preserves the block duration. Moving beyond that distance releases the snap. Zoom blocks can span visual separators continuously.

Hover previews and caption placement use the same inverse mapping. Keyframe positions and playhead snapping use media time consistently. Source-video seeks at contiguous cuts preserve camera springs; explicit timeline seeks still snap to the requested frame.

Caption visibility was checked in the real renderer with fixture footage at 1×, 2× and 4×, including source-frame matching, cue visibility boundaries and moving playback. The caption test captures the preview at 2×. This verifies rendering and timing, not speech-recognition accuracy or a packaged export.
