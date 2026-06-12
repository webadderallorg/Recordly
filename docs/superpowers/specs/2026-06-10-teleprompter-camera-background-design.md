# Teleprompter Camera Background — Design

**Date:** 2026-06-10
**Status:** Approved (conversation 2026-06-10)

## Goal

Show the live recording camera as a faded background layer behind the
teleprompter text, so the user can check their framing while reading without
looking away from the lens area. The teleprompter window's existing
`setContentProtection(true)` keeps the preview out of recordings.

## Decisions (user-confirmed)

- **Adjustable fade**: a camera toggle button in the teleprompter header plus
  a small opacity slider (shown only while the camera layer is on). Both
  persist in localStorage alongside the other teleprompter settings.
- **Mirrored** (selfie-monitor) rendering, fixed — no un-mirrored option.

## Architecture

### Device selection relay (the camera Recordly records with)

The selected webcam device lives only in the HUD renderer's React state
(`useScreenRecorder`'s `webcamDeviceId`) — it is not persisted anywhere a
second window can read. Add a small relay:

1. **HUD → main**: the HUD sends the current `webcamDeviceId` (or undefined)
   to the main process whenever it changes (one `useEffect` +
   `ipcRenderer.send("webcam-device-changed", deviceId)`).
2. **Main** caches the last value in module state (`electron/windows.ts` or a
   sibling module).
3. **Teleprompter → main**: `ipcRenderer.invoke("get-selected-webcam-device")`
   returns the cached value when the camera layer is toggled on. Fallback:
   `undefined` → system default camera.

### Teleprompter window (renderer)

- Header gains a **camera toggle button**; when on, the footer (read mode)
  gains an **opacity slider** (range ~5%–80%, default ~35%).
- When toggled on in read mode: `getUserMedia({ video: { deviceId: { exact } } })`
  (falling back to default on failure/absence), rendered in a `<video>`
  element positioned absolutely behind the scroll content: `object-fit:
  cover`, `transform: scaleX(-1)` (mirrored), opacity from the slider, behind
  a dark scrim so text stays readable; text gets a subtle text-shadow.
- **Stream lifecycle**: the stream starts only in read mode with the toggle
  on; it stops (tracks ended, camera light off) when toggled off, when
  switching to edit mode, and on window unload. macOS supports concurrent
  camera access, so this works alongside an active recording.
- localStorage keys: `recordly-teleprompter-camera-on` (boolean),
  `recordly-teleprompter-camera-opacity` (number).

## Error handling

- `getUserMedia` failure (permission denied, device busy/missing): toggle
  reverts to off and a small inline note shows; no crash, text mode
  unaffected.
- Device id stale (camera unplugged): retry without the `deviceId` constraint
  (system default).

## Out of scope

A camera picker in the teleprompter (it follows Recordly's selection),
un-mirrored mode, showing the camera in edit mode, audio.

## Testing

- Unit: opacity clamp/persistence helpers (pure functions).
- Manual: toggle on while recording with the same camera; verify framing view,
  fade slider, mirroring, camera light off on toggle-off/edit/close; verify
  the feed never appears in a recording.
