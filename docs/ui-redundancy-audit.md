# HeroUI editor redundancy audit

Reviewed 19 September 2026 in the `recordly-heroui` redesign. Findings use the current renderer and source, including the existing uncommitted redesign work.

## Cleaned up

| Area | Problem | Change |
| --- | --- | --- |
| Zoom inspector | Two Delete Zoom buttons for the same selected block: one in the scrolling content, another in the fixed footer. | Kept the fixed footer action. |
| Extensions navigation | A permanent tool tab leads only to “Extensions are no longer available.” | Removed the navigation entry; retained the existing compatibility component. |
| Account navigation | A permanent button only shows “Account coming soon.” | Removed the placeholder button. |
| Clip and Caption inspectors | The panel title is repeated immediately as a section heading without introducing a subsection. | Kept the panel title and removed the repeated heading. |
| Basic Zoom inspector | Animation heading, Reset button and directions to Settings appear without an animation control. The actual control is Advanced-only. | Grouped these with Classic Animation under Advanced. |

## Further consolidation opportunities

These are recommendations, not additional changes in this patch.

1. **Crop has two separate editing surfaces.** The toolbar opens the visual Crop Video dialog; Scene → Advanced offers four inset sliders for the same crop state. Put precise inset inputs and reset inside the crop dialog so there is one place to edit cropping. Preserve numeric precision when consolidating.
2. **Zoom controls are scattered across two inspectors.** The block inspector contains Mode, Amount and Classic Animation; Settings contains Connect neighboring zooms, automatic suggestions and Motion Presets. Group motion settings in a clearly labelled project-wide subsection alongside Zoom controls, instead of a message directing users elsewhere. Some motion presets also affect the cursor, so their scope must stay explicit.
3. **Adding content is split between Add Layer and adjacent buttons.** Add Layer offers annotation/audio, while Add Zoom is a separate icon. A single Add menu could enumerate all supported insertions; keep Split separate as an editing operation. Hover-to-add is useful direct manipulation and need not be removed.
4. **Support commands occupy permanent editing-toolbar space.** Discord and Feedback sit beside project opening and Undo/Redo. A single Help menu could contain both plus shortcut help. This is lower-priority toolbar clutter, not two identical functions.
5. **Audio repeats its inspector title.** An “Audio” heading inside the Audio inspector mainly provides a home for Reset. Move Reset to the inspector header when standardizing section actions.
6. **Saved Presets and Motion Presets need clearer scope.** The header stores whole-editor presets; Settings applies motion presets. These are different functions, but the repeated naming obscures that distinction. Label the former “Style presets” and the latter “Motion” or explain their scope.

Removed the unused compatibility timeline toolbar and its design-catalog fixture, plus the unmounted TimelineAxis and ClipMarkerOverlay components. Removed ignored SliderControl props and their call-site values.

## Interaction defects fixed

- Connected `handleClipDelete` to `TimelineEditor.onClipDelete`. Previously Backspace reached a no-op because the callback was absent.
- Routed Delete, Backspace and the configured delete shortcut consistently for every selected block type before the timeline-focus check. Inspecting a block no longer makes it undeletable. Form controls, editable text, composition events and overlay controls retain their own keyboard behavior.
- Removed the clip-only Backspace special case, which bypassed shared selection priority.
- Preserved a selected caption fragment when the playhead leaves its time span. Deletion still maps the fragment to its source caption cue.
- Removed unnecessary requirements for optional selection callbacks from clip, annotation and audio deletion.
- Cleared stale keyframe selection when selecting a timeline block.
- Cleared block selection when navigating to a global sidebar tool. A selected annotation previously overrode every tool's inspector, making Cursor, Scene, Webcam and Settings appear to show the same content.

## Validation

Passed: TypeScript checking, 72 focused unit tests, 14 browser tests, targeted lint, and diff whitespace checks.

Regression coverage includes keyboard deletion for each block type, inspector deletion, clip undo, caption deletion after seeking, text-entry protection, and switching away from an annotation inspector. Unit coverage includes both delete keys, configured shortcuts, selection priority, editable/overlay guards and composition/modifier handling. Browser tests use the real renderer with a mocked Electron bridge and fixture media; packaged Electron is not exercised here.

## Videos library and HUD follow-up

- HUD source/device rows and source/region triggers use ghost buttons. Project cards fit the 300px HUD popup, scroll vertically with thin scrollbars, and no longer truncate the library at 24 entries.
- Caption generation skips session re-registration when the source is unchanged, preserving active companion-audio approvals. Local media URLs resolve the current server port; preview retries a failed local load once through the existing approved-media API.
- Videos uses a secondary header button at the far left and replaces the existing left inspector with lightweight file cards (no embedded video players). It lists files in the configured recordings directory. Removal stages the selected recordings and their capture companions using filesystem moves. Undo restores the latest removal without copying media or overwriting newer files; the next removal or app exit sends staged files to system Trash. This replaces the earlier hide-only behavior. Automatic recording age/count pruning is removed.
- Timeline drops insert at a clip boundary. Since preview/export share a single source, imports prepare an immutable combined source in `.recordly-media`. New footage fits the current source canvas/frame rate; subsequent imports copy existing prepared video, with lossless system/mic companions and shifted cursor telemetry. Preparation takes time for large recordings. Clip source bounds prevent trimming into the next recording. Timeline history can undo/redo insertions because existing source offsets are retained.
- The existing FFmpeg metadata parser is now shared by import and export, rather than duplicating it or depending on the incompatible FFprobe binary found in this development install.

Validation: real FFmpeg integration covers differing dimensions, audio routing, repeated inserts, and original preservation. Browser tests cover library removal/undo, drag insertion/undo/redo, caption generation without session reset, preview recovery, and 30 projects in the HUD popup. Caption visibility at 1x/2x/4x and gap snapping remain covered.


## Clips, overlays, and cloud integration

- The Videos inspector uses shared search, checkbox, menu, and button controls. File rows support selection, double-click/+ insertion, and drag-to-timeline; bulk Trash is in the actions menu. No library video elements are loaded.
- Webcam imports normalize and concatenate a separate webcam track, account for capture start offsets, and preserve source-time visibility ranges. Preview and both renderer paths hide the bubble in screen-only spans. Saved projects preserve these ranges; style presets omit them and preserve the current source's ranges when applied.
- Imported click, mouse-up, right-click, and cursor-shape samples retain event types, shifted timestamps, and letterbox-adjusted coordinates.
- Annotation drag bounds now use the complete canvas. Position percentages may extend outside the recording rectangle and survive save/reload; export uses the same coordinates. Webcam and caption overlays already use their own canvas layout.
- Zoom blocks show the icon with the full label when space allows; narrow blocks hide the icon and mode while retaining the numeric multiplier.
- Cloud integration was ported from the cloud worktree, including its current service/viewer edits, desktop authentication, multipart uploads, and preparation of the current edit for sharing. Account lives at the bottom of the tool rail; Create share link lives in Export. Nothing was deployed or uploaded. Live sign-in requires the public Supabase environment settings described in authentication.md.


Thumbnail and sign-in refinement: Videos uses lazily requested 160×90 JPEG stills, cached by source path, modification time, and size. It displays unmodified filenames, including extensions, with ellipsis and the full hover title. Sign-in uses HeroUI Modal, Form, TextField, Input, Button, and Alert components with shared styling.
