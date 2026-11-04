# Cursor tracking on Hyprland

## Why the overlay can freeze

Recordly records cursor positions separately from the video, then renders an overlay from that telemetry. Hiding the cursor in the screen-capture stream does not provide cursor telemetry.

The original Linux path in `electron/ipc/cursor/telemetry.ts` uses the most recent `uiohook-napi` mouse-move position for up to 1,000 ms. After that it falls back to Electron's `screen.getCursorScreenPoint()`. The hook's Linux backend is X11-based; it cannot reliably track the pointer over native Wayland surfaces. Electron likewise does not support global cursor-position queries on Wayland. This explains a cursor that briefly moves around XWayland surfaces, then freezes when native Wayland windows are used. Extending the cache expiry would only retain the last stale position longer.

## Hyprland backend

`electron/ipc/cursor/hyprland.ts` queries Hyprland's request socket:

```
$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock
```

It sends `j/cursorpos`, the JSON equivalent of `hyprctl -j cursorpos`. Requests are asynchronous, sequential, and spaced at the existing cursor sampling interval (33 ms). No subprocess is spawned per frame. Requests have a timeout and a bounded response size; failures warn once per recording and retry with backoff. The last valid compositor position is retained during transient failures. Stopping capture closes pending requests, cancels polling, and clears the cached position.

Compositor positions take precedence over both XWayland hook positions and Electron positions. They are logical coordinates and must not undergo the physical-to-logical conversion used for X11 hook events.

The backend is enabled only on Linux with the Hyprland instance and runtime-directory environment variables. Windows, macOS, and other Linux sessions retain their previous position sources.

## Browser recording startup timing

The browser capture path now waits for MediaRecorder's `start` event before
starting its recording clock and cursor telemetry, rather than treating the
synchronous `start()` request as the start of encoded media. The renderer passes
that clock boundary to the main process so IPC delivery does not create a second
independent origin. Native capture startup is unchanged.

The event is a muxer startup boundary, not a frame-accurate capture timestamp.
This avoids applying an arbitrary fixed offset for startup latency.

## Local-only builds

Set `VITE_SKIP_ONBOARDING=true` to skip mandatory sign-in onboarding and allow
local recording without a cloud session:

```sh
VITE_SKIP_ONBOARDING=true npm run dev
# Or embed the option in a packaged Linux build:
VITE_SKIP_ONBOARDING=true npm run build:linux
```

The option is disabled by default. Vite embeds it at build time, so setting it
when launching an existing AppImage has no effect. It does not fabricate an
authenticated session, grant access to cloud features, or bypass OS capture
permissions. Both the onboarding UI and the local recording session check honor
the option; skipping only the UI would leave Record unable to start.

## Manual verification

1. Start Recordly from the Hyprland session (`npm run dev`, or rebuild your package). An already-installed binary will not pick up source changes.
2. Confirm `hyprctl -j cursorpos` returns changing coordinates as the pointer moves.
3. Make a new 10–20 second full-screen recording. Move across native Wayland windows as well as Recordly, pause/resume once, and keep moving beyond the first second.
4. Check editor playback and an exported video. The overlay should follow the recorded path throughout.
5. Record again to verify cleanup between recordings. Old recordings with missing/stale telemetry cannot recover their original cursor paths from this change.

## Scope and limitations

- This backend supplies position, not global click events or cursor shape. Existing X11 hooks can still miss clicks over native Wayland windows.
- This is Hyprland-specific, not generic Wayland support.
- Recording geometry still uses Recordly's existing selected-display/window/area mapping. Portal selection of a different target, native Wayland window bounds, and mixed-scale multi-monitor layouts need separate end-to-end validation. Test a single full display first.

References: [Electron screen API](https://www.electronjs.org/docs/latest/api/screen), [Hyprland IPC](https://wiki.hypr.land/IPC/).
