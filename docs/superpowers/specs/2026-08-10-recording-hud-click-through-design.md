# Recording HUD click-through design

## Problem

When recording starts, the Electron main process forces the transparent HUD window to accept mouse events. The native window then intercepts clicks across its entire rectangle, including visually transparent pixels. Controls in the recorded website or application underneath that rectangle therefore stop responding.

## Intended behavior

- Transparent HUD areas pass mouse input to the application underneath while recording.
- The visible HUD bar, its popovers, drag interactions, and the recording webcam preview remain interactive.
- Platforms where Electron mouse-event forwarding is unsupported retain the existing compact interactive fallback window.

## Design

Reuse the renderer-driven hover policy that already provides click-through behavior before recording. The renderer continues to request an interactive HUD while the pointer is over a visible HUD element and requests passthrough after the pointer leaves.

The Electron main process will stop overriding that requested state merely because recording is active. On platforms with passthrough support, recording will keep the full-display transparent overlay and honor the renderer request with `setIgnoreMouseEvents(true, { forward: true })` outside interactive elements. On unsupported platforms, the native window remains interactive and compact.

The policy deciding whether a request can use native passthrough will be expressed as a small pure function so recording behavior can be covered without constructing an Electron `BrowserWindow` in tests.

## Compatibility and risk

The change does not affect capture backends, recorded media, cursor telemetry, or editor behavior. The primary risk is making recording controls temporarily unclickable; retaining Electron's forwarded mouse movement and the existing renderer hover handlers prevents that on supported platforms. Unsupported platforms keep their current fallback rather than relying on unavailable forwarding behavior.

## Testing

- Add a regression test proving that a supported platform honors passthrough requests while recording.
- Prove that interactive requests still disable passthrough while recording.
- Prove that unsupported platforms never enable passthrough.
- Run the focused HUD tests, the complete test suite, TypeScript typechecking, and Biome lint.

## Pull request

The PR will be opened from the `tanmayapex` fork against `webadderallorg/Recordly:main`. Its description will follow the repository's recent convention: problem/root cause, focused change, user impact, verification, and risk.
