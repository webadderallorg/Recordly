# iPhone and iPad USB capture

Recordly contains a development-preview capture path for recording the screen stream that macOS receives from a connected iPhone or iPad. The feature is currently disabled in packaged builds while physical-device, installed-permission, long-duration audio, recovery and distribution gates remain untested.

## Development preview

The preview requires macOS 14 or later, Xcode/Swift build tools and Recordly's normal development dependencies. Build the helper before starting the app:

```bash
npm run build:ios-helper
RECORDLY_ENABLE_IOS_CAPTURE=1 npm run dev
```

`RECORDLY_ENABLE_IOS_CAPTURE` is read by the Electron main process and is honored only in an unpackaged development run. Setting it does not enable the feature in a packaged application.

Connect one iPhone or iPad using a data-capable USB cable, unlock it and approve the system Trust prompt if one appears. Open the source picker and choose **iPhone / iPad**, then select the device. Close QuickTime or another application if it already owns the device. An empty list does not prove that the device is locked or untrusted; use Refresh after checking the cable and system prompts.

Recordly prepares one device at a time and waits for real video samples before showing Ready. The preview is an aspect-fit, low-bandwidth framing preview. Its longest edge is limited to 480 pixels and it updates at no more than five frames per second; recording uses the native device stream rather than the preview image. Hiding the picker stops preview work without stopping a prepared or active recording.

If Camera or Microphone permission was denied, review Recordly's access in macOS **System Settings → Privacy & Security**, grant the permission needed for the selected inputs, and relaunch before preparing again. Device-screen capture does not require granting desktop Screen Recording permission. Installed-app prompt identity still requires the physical release checks below.

Keep the phone in one orientation during a take. A detected format or transform change stops before incompatible samples are appended and preserves the preceding valid media as an interrupted take. Some physical rotations may change only the displayed content and cannot be detected reliably.

## Video and audio behavior

The helper accepts a compatible baseline H.264 stream for passthrough, or a supported Rec.709 8-bit 4:2:0 uncompressed input for H.264 encoding. Unsupported codecs, color formats and clock mappings fail before or during capture with a specific status. Recordly does not promise lossless framebuffer capture, a particular frame rate, HDR, Display P3, 4K, or 60/120 fps. The displayed geometry and format come from samples actually received; observed frame rate is omitted when it has not been measured.

**Device audio** and **Mac narration** are separate controls. Device audio defaults on when available; narration is optional and uses a microphone identity supplied by the native helper. These settings do not reuse desktop system-audio or browser microphone IDs. If requested audio cannot be opened before recording, Recordly asks for a settings change instead of silently substituting a source. If audio disappears after video begins, the valid video is retained and the result reports the interruption.

Device audio and narration are stored as native sidecars and aligned to the video using common-clock timing. A completed take has one mixed editor soundtrack: one source uses unity gain; two sources use 0.5 linear gain each. The video stream is copied during normal audio assembly. Original source media remains available for recovery under the normal session retention policy.

The mobile source does not support webcam capture, pause/resume, touch control, wireless capture or simultaneous desktop capture. Keyboard, menu and HUD actions reject unsupported operations rather than presenting a false state. Desktop capture preferences are preserved when switching sources.

## Recording and editor workflow

The existing countdown runs only after the source is Ready. Cancelling the countdown keeps the prepared preview and creates no media. The recording timer starts only after the helper accepts the first eligible video sample. Stop enters **Saving recording…** until native finalization, validation, optional audio assembly, session commit and editor handoff finish.

A fresh mobile take opens with its transformed native aspect, no crop, zero corner radius, no cursor overlay or cursor telemetry, and no automatic mouse-driven zooms. These are initial defaults only. Saved crop, aspect, annotations, manual zooms and cursor choices remain authoritative when a project is reopened. Mobile provenance survives raw-session reopen, project save/load and Save As even when no webcam exists.

Interrupted recordings show the recorded outcome in the capture UI and editor. Requested audio is not described as recorded unless committed metadata confirms it.

## Recovery and privacy

The main process owns session directories and validates every media path. Native media, timing checkpoints and an atomic journal are retained when finalization fails or the helper, renderer or parent process exits unexpectedly. On the next launch, **Device recording recovery** can inspect eligible Recordly-created sessions and offer recovery with audio, explicit video-only recovery, Open folder, or confirmed Discard. Recovery remains available while new device capture is disabled. A damaged final fragment, power loss or filesystem failure may still be unrecoverable.

Capture, preview, audio and diagnostics remain local. Diagnostics are opt-in and omit device names, raw device identifiers, home-directory paths and media content. Notifications and sensitive screen content can appear in a recording. Recordly does not automatically suppress or redact them, and it does not bypass protected content.

## Current verification status

Software tests cover protocol validation, native writers and inspection, preview bounds, controller lifecycle, IPC authorization, storage/finalization, persistence, recovery and renderer routing. Synthetic media verifies geometry, timing failures, audio offsets, final video packet preservation and manifest reopen. These checks do not prove physical iPhone/iPad behavior.

All physical release gates G1–G4 remain **Not tested**. This includes real device discovery and permissions, five- and thirty-minute tests, physical unplug/rotation/audio behavior, Intel runtime, signed/notarized clean-account installation, manual keyboard/screen-reader/reduced-motion review and the full macOS/Windows/Linux regression matrix. See [implementation evidence](testing/ios-usb-capture-implementation.md), [feasibility evidence](testing/ios-usb-capture-feasibility.md), and the [acceptance matrix](testing/ios-usb-capture-matrix.md).
