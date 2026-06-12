# In-Recording Camera/Screen Layout Switch — Design

**Date:** 2026-06-10
**Status:** Approved (conversation 2026-06-10)

## Goal

While recording with the webcam enabled, the user presses a button on the
recording HUD — or a global hotkey `Option/Alt + F10` — to switch the final
video between two layouts:

- **screen** — normal: screen content with the webcam bubble overlay.
- **camera-full** — the webcam fills the frame ("fit with background": whole
  camera frame letterboxed over the project background), screen hidden.

Recordly composites webcam over screen at edit/export time (both are separate
recorded files), so the feature records *when* the user switched, not *what*
is captured: each press stamps a timestamped event; the editor converts the
events to layout segments; preview and export hard-cut between layouts at
those timestamps.

## Decisions (user-confirmed)

- **Instant cut** between layouts (no animated transition).
- **Fit with background** for camera-full: entire camera frame visible,
  letterboxed/centered over the project's wallpaper/background, styled with
  the same corner-radius/shadow treatment as the screen content frame.
- **HUD button + global hotkey** `Alt+F10` (consistent with the teleprompter's
  Alt-key family). Hotkey registered only while recording is active.
- **Live presses are authoritative** — no timeline editing UI in v1. A single
  checkbox in the editor webcam settings, "Use recorded camera switches"
  (default on), disables all segments as an escape hatch.

## Architecture

### Recording side

1. **Event sidecar** — `recording-<ts>.webcam-layout-events.json` next to the
   recording, following the cursor-telemetry sidecar pattern
   (`electron/ipc/cursor/telemetry.ts`):
   ```json
   { "version": 1, "events": [{ "timeMs": 15000, "mode": "camera-full" }] }
   ```
   `timeMs` is on the recording's pause-adjusted clock (same basis as the mic
   chunk events in `electron/ipc/register/recording.ts`), so pause/resume does
   not desync events from the video.
2. **HUD button** in `RecordingControls.tsx` next to pause/stop, visible only
   while recording with webcam enabled. Shows the current mode (icon state).
   Pressing toggles the mode and sends the event via IPC.
3. **Global hotkey** `Alt+F10` registered in the main process when recording
   starts and unregistered when it stops (same `globalShortcut` module pattern
   as the teleprompter shortcuts). It relays to the same toggle path as the
   HUD button so the HUD icon stays in sync.
4. The main process owns the event log during recording (current mode + array
   of events) and writes the sidecar when recording finalizes. Recording
   always starts in `screen` mode.

### Editor side

1. **New region type** in `src/components/video-editor/types.ts`:
   ```ts
   interface WebcamLayoutRegion {
     id: string;
     startMs: number;
     endMs: number;
     mode: "camera-full"; // screen mode is the implicit default between regions
   }
   ```
2. **Events → regions conversion** (pure function + tests): consecutive events
   pair up into `camera-full` segments; an unterminated final `camera-full`
   event runs to the end of the video; duplicate same-mode events dedupe.
3. **Project load**: when opening a recording, the editor reads the sidecar
   (same IPC read pattern as other sidecars) and seeds
   `webcamLayoutRegions: WebcamLayoutRegion[]` in `ProjectEditorState`;
   persisted in the project file thereafter.
4. **"Use recorded camera switches" checkbox** in the webcam settings panel
   maps to a `webcamLayoutRegionsEnabled` boolean (default true).

### Rendering (preview + export)

At any time *t*, the active layout is `camera-full` if an enabled region
contains *t*, else `screen`.

- **Preview** (`VideoPlayback.tsx`, Pixi): during camera-full segments, hide
  the screen content layer and render the webcam letterboxed ("fit") and
  centered over the existing background rendering, with the screen frame's
  corner-radius/shadow styling. Hard cut at boundaries.
- **Export** (`modernFrameRenderer.ts` / WebCodecs path): same per-frame logic.
- **Native static-layout export**: gains one skip reason
  (`unsupported-webcam-layout-regions`) in
  `modernVideoExporter.getNativeStaticLayoutSkipReasons` when enabled regions
  exist, so those projects route to the JS compositor automatically. The
  native pipeline is otherwise untouched.

### Geometry

"Fit" letterbox math (pure function + tests): scale the webcam frame
(post-crop) to the largest size fully contained in the output frame minus the
project padding, centered. Reuses the webcam crop; ignores bubble-specific
settings (size %, position) during camera-full.

## Error handling

- Webcam disabled or no webcam file → button hidden, hotkey inert, sidecar
  events ignored on load.
- Missing/corrupt sidecar → no regions; recording behaves exactly as today.
- Events beyond video duration are clamped; zero-length segments dropped.

## Out of scope (v1)

Animated transitions, timeline editing of segments, audio changes, Windows
GPU export support for layout regions (JS-renderer fallback covers it),
camera-only *recording* mode.

## Testing

- Unit: events→regions conversion (pairing, dedupe, unterminated tail,
  clamping); letterbox fit geometry; native-export skip reason.
- Manual: record with several switches (including across a pause), verify the
  cuts land at press points in preview and in an exported MP4, and that the
  checkbox disables them.
