# Recordly — USB iPhone / iPad Screen Capture
## Feature specification v1.0

Date: 8 September 2026  
Repository: `webadderallorg/Recordly`  
Inspected baseline: `4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1` (`chore: release v1.4.0`). Its parent is `68bca43f6a8c1842ab9acfab75cfad817f737cb4`, used in the earlier feasibility assessment.  
Companion document: `02-implementation-plan.md`.

This is a proposed product and engineering specification, not a claim that the feature has been implemented or tested. Repository integration points and documented API behaviour were inspected. A connected-device test, a macOS build, and signed-distribution permission tests have not been performed for this specification. Numerical thresholds below are proposed acceptance targets, not observed performance.

## 1. Product decision

Add a first-class **iPhone / iPad** recording source to Recordly on macOS. A user connects a device with a data-capable USB cable, unlocks it and grants the normal device trust permission, selects its screen, records, and lands in Recordly's existing editor.

Use a bundled Swift helper with CoreMediaIO and AVFoundation. Do not capture an iPhone Mirroring or QuickTime window. Do not implement an iOS app, network transport, screen-control service, or a replacement editor.

The delivered video should be as faithful to the **stream macOS receives from the device** as practical. This is deliberately not a promise of lossless access to the physical display framebuffer, 4K, 60/120 fps, HDR, Display P3, or parity with an on-device recording. Input capabilities must be measured rather than inferred from the phone model.

The primary path preserves a compatible compressed device stream without another video encode. An explicitly identified H.264 encode path handles supported uncompressed SDR inputs. Both feed the existing editor with a normal local media file. Normal capture finalisation must not re-encode the video a second time.

### 1.1 Success from the user's perspective

“I plugged in my phone, selected it in Recordly, recorded my app with its sound and optional narration, and immediately edited a clean portrait or landscape video. There was no desktop window border, stray Mac cursor, or unexplained quality drop.”

### 1.2 Existing code that matters

At the inspected baseline:

- `electron/ipc/types.ts` and launcher source types describe screen/window sources, not physical iOS capture sources.
- `SourcePopover.tsx` fetches Electron desktop sources; `launchPopoverTypes.ts` defaults an unrecognised source to a screen. A phone must bypass that default.
- `useScreenRecorder.ts` orchestrates recording and selects native desktop capture using screen/window identifiers. Routing must happen before desktop permissions, cursor capture and browser fallback.
- `electron/ipc/project/session.ts` writes session-manifest version 2 and removes the manifest when no webcam is attached. Mobile metadata cannot survive through that path unchanged.
- `projectPersistence.ts` has project version 2, a `videoPath`, and editor settings. Mobile provenance requires an optional, validated addition without resetting user edits.
- Native helpers are already packaged for `darwin-arm64` and `darwin-x64` with a macOS 14 deployment target. Native binaries are unpacked from ASAR; users must not need Xcode to run a packaged app.

These observations justify a new capture backend plus targeted source, session and launcher changes—not a rewrite of the recording architecture. See the source register at the end.

## 2. Scope and explicit exclusions

### 2.1 Required for v1

| ID | Requirement |
|---|---|
| F01 | macOS-only source category with lazy device discovery and connect/unlock/trust guidance. |
| F02 | Distinguish eligible device-screen sources from built-in cameras, webcams, virtual cameras and ordinary Continuity Camera lens feeds. |
| F03 | Select one device; show a low-bandwidth live preview and actual observed format information. |
| F04 | Record the device screen through a native pipeline at its delivered dimensions and timing. |
| F05 | Record device audio when exposed and enabled; optionally record a selected Mac microphone for narration. |
| F06 | Use the existing countdown, Record, Stop and Discard flow; accurately report starting, recording and finalising states. |
| F07 | Open a validated recording in the existing editor with mobile-safe initial defaults. |
| F08 | Handle device removal, permission denial, format changes, storage failures and process failures without reporting false success or deleting recovery candidates. |
| F09 | Persist capture metadata through raw-session reopen and project save/load. |
| F10 | Ship prebuilt, signed and verified native helpers for the architectures advertised as supported. |
| F11 | Provide opt-in, redacted diagnostics and an explicit recovery flow. |
| F12 | Preserve desktop capture behaviour on macOS, Windows and Linux. |

Support iPhone and iPad through the same backend. Advertise iPad support only after the iPad acceptance cases pass. There is no hardcoded hardware-model list in the UI. The support matrix lists tested device/OS combinations; device discovery is not itself a compatibility guarantee.

### 2.2 Deliberately outside v1

Wireless/AirPlay capture; Windows/Linux physical iPhone capture; Android capture; an iOS companion app; Mac-controlled touch/keyboard input; touch coordinates, automatic touch-driven zooms or gesture overlays; simultaneous multi-device recording; simultaneous desktop and phone capture; webcam overlays while recording this source; pause/resume; automatic reconnection into the same take; seamless orientation changes within a take; HDR/wide-gamut guarantees; ProRes/HEVC quality selectors; device bezels, fake status bars or notch reconstruction; independent device/narration mixing controls in the editor; cloud upload or telemetry services.

Existing manual zoom, backgrounds, annotation, trimming and export features remain available. This feature does not introduce another subscription, login, or service dependency.

### 2.3 Why not the alternatives?

A mirrored-window integration depends on another application, visible window geometry and its interaction/permission behaviour. Importing a QuickTime recording is a useful fallback but is not integrated capture. A companion iOS application adds installation, distribution and transport concerns without being necessary for the selected wired workflow. Apple documents recording a connected device directly in QuickTime; CoreMediaIO exposes an opt-in for screen-capture devices. [A1, A2]

## 3. UX and interaction contract

### 3.1 Source picker

Add an **iPhone / iPad** tab or section to the existing source picker on macOS only. Reuse Recordly's existing popovers, buttons, typography, spacing, semantic colours and Phosphor icons. Do not add a SwiftUI settings window or a second visual design system.

Do not enumerate desktop sources merely to populate the device tab. In particular, the device flow must not require Mac Screen Recording or Accessibility permission when its native capture path does not need them. Source-specific permission preparation must also cover launcher startup behaviour, not only the Record button.

Empty-state copy:

> Connect your iPhone or iPad with a USB cable. Unlock it and tap Trust if asked.

Secondary help: “Use a cable that supports data. Close QuickTime or other apps using the device.” Actions: **Refresh**, **Connection help**. Do not claim the device is untrusted or locked just because discovery returned an empty array. The public capture API may not distinguish those states.

A discovered row shows its human-readable name, a device icon and availability. Duplicate names must remain distinguishable, using a session-local ordinal or other non-sensitive distinction. Identification and routing use opaque IDs, never names.

No automatic recording, no automatic selection of a different device, and no global camera permission prompt merely from opening Recordly. Permissions are initiated by the device-source interaction.

### 3.2 Preview and preparation

Selecting a row obtains an exclusive prepared session and displays a correctly oriented, aspect-fit preview. The same native session continues into recording; opening/closing the popover must not recreate the physical capture session.

Preview is deliberately lightweight: longest image edge at most 480 pixels and at most 5 updates/second. It is a framing/status preview, not a measure of capture quality. Show **“Preview quality only — recording uses the device stream.”** Do not persist preview frames.

After media arrives, show **“1170 × 2532 · SDR”** or equivalent *observed* values. Show an observed frame-rate range only once sufficient samples exist; mark it as observed. Never fill it from a marketing model table. A source that has been discovered but has not produced frames is not Ready.

When preview is hidden, suspend its JPEG conversion and delivery, not capture. A frozen/blocked renderer must not obstruct media writing.

### 3.3 Recording controls

For this source, replace the meaning of the desktop System Audio control with a separate, clearly labelled **Device audio** setting. Do not silently repurpose the stored desktop preference. Default device audio on when available, Mac narration off, and use a separate mobile preference namespace.

Narration uses the native helper's microphone list. Chromium device IDs are not assumed to equal AVFoundation IDs. Do not resolve microphones by label when names collide. Exclude the selected phone's audio endpoint from narration choices to avoid recording it twice.

Hide or disable webcam and pause/resume controls with an explanation. The corresponding keyboard shortcuts and IPC endpoints must reject unsupported operations too. Preserve desktop settings while displaying effective mobile settings.

Record begins only from Ready, following the existing countdown. During countdown, Cancel returns to Ready and keeps no media. Revalidate source identity and availability before arming. Show **Starting recording…** until the helper has accepted the first decodable video sample after the recording boundary. Only then show the recording indicator and timer.

Stop changes the UI to **Saving recording…**. Disable further starts until the recording is committed or a recoverable failure is displayed. Keep the native recording status authoritative across all launcher/HUD windows.

Discard before media starts cancels immediately. Discard after capture starts asks **“Discard this recording?”**, with **Keep recording** and **Discard**. Deletion is limited to the current session directory and must never follow arbitrary renderer paths.

### 3.4 During recording

Show the selected device, elapsed time, active audio sources and Stop. The phone preview is view-only: clicking it does not interact with iOS. The user continues operating the physical phone.

A quiet source or a dark picture is not an error. Do not identify phone lock, DRM, or a stalled stream by black-pixel heuristics. No-frame warnings describe the observation, not a guessed cause. Do not stop a sparse/static stream solely because its pixels or frame timestamps have not changed; this must be covered by the media-duration tests.

On an observed incompatible format change, stop before appending incompatible samples and preserve the preceding take. Show:

> The device's video format changed. Your recording up to that point was saved. Keep one orientation during a take and start a new recording.

This is not a promise to detect every physical rotation: some device streams change their content without an identifiable format/transform change. Tell the user to use a fixed orientation. Recordly does not lock the phone orientation remotely.

### 3.5 Accessibility and polish

All selection and recording controls are keyboard-operable, have visible focus, and expose names and states to accessibility APIs. Announce Ready, Recording, Saving and terminal errors, not every progress tick. Preserve focus after discovery updates. Never rely on colour alone.

Use existing motion tokens; status crossfades should be approximately 120–180 ms, respect reduced motion, and never animate live-preview layout continuously. Put detailed troubleshooting in a disclosure, not a mandatory setup wizard. All new strings use the existing localisation system; untranslated keys follow the repository's established fallback policy and pass `i18n:check`.

## 4. Architecture and ownership

### 4.1 Components

| Component | Owns | Must not own |
|---|---|---|
| React source UI / recorder adapter | User intent, preview rendering, accessible status presentation | Capture process lifetime, destination paths, raw full-resolution media |
| Electron `IOSCaptureController` | Exclusive recording lease, helper lifecycle, validated IPC, progress/status snapshot, storage, finalisation and editor handoff | Native camera frames or UI-specific React state |
| Swift helper | Discovery, AVFoundation sessions, native identities, sample timing, native media writing, preview conversion | Project editor settings, arbitrary renderer instructions, network services |
| Existing editor integration | Local media import, persisted presentation defaults, save/load and export | Keeping the phone connected or driving its capture session |

Full-resolution samples flow directly from AVFoundation to native writers. Only low-resolution JPEG previews cross into JavaScript. Use a separate Swift package for a testable capture-core library and a small executable. Do not turn `ScreenCaptureKitRecorder.swift` into a desktop/mobile switchboard.

### 4.2 Source identity

Introduce a discriminated `CaptureSource` union containing the existing desktop source and a new `IOSDeviceSource`. The new member has `sourceType: "ios-device"`, `id: "ios-device:<opaque-token>"`, `deviceToken`, `displayName` and observed capabilities. Desktop-only functions retain desktop-specific argument types.

The token maps to AVFoundation's identity inside the helper, is stable through discovery refreshes within that helper lifetime, and is invalidated when that identity disappears or the helper restarts. Never persist it as a reconnect guarantee. v1 does not auto-select a remembered phone on the next application launch.

Capabilities include video availability, device-audio availability (`unknown | available | unavailable`), native microphone options, recording mode, format descriptor, and explicit `supportsPause: false`, `supportsWebcam: false`, `supportsTouchTelemetry: false`.

Do not pass a mobile source through `mapRawSource`, `desktopCapturer`, display/window parsing, window highlighting, cursor tracking, or browser desktop fallback. An iOS capture failure remains an iOS capture failure; recording the Mac desktop instead is unacceptable.

### 4.3 Lifetime and exclusivity

There is one main-process controller and at most one mobile helper at a time. Start it lazily for discovery. Retain the selected native session for preview and capture. Close an unselected discovery-only helper once no device UI client remains; stop preview when hidden. Release a prepared device on deselection or explicit close.

Integrate a small shared recording lease with existing desktop start paths so no window can start desktop recording while mobile capture is arming, recording or finalising, and vice versa. This is a narrowly scoped concurrency guard, not a universal backend framework rewrite.

Main-process state is authoritative. Renderer subscriptions receive a complete snapshot immediately and ordered updates subsequently. Unmounting a popover cannot stop a take. A renderer crash while recording should trigger safe stop/finalisation in the main process and preserve the result for reopen.

## 5. Native discovery and permission contract

### 5.1 Discovery

Before enumeration, set `kCMIOHardwarePropertyAllowScreenCaptureDevices` through CoreMediaIO and check its `OSStatus`. Do not enable the wireless-screen-capture property. Keep this opt-in scoped to the dedicated helper process. [A2]

Use an availability-aware AVFoundation discovery session. Probe muxed external devices. Allow an additional discovery category only when the supported OS exposes a positively identified iOS screen source there. A recent idb change proposes including Continuity-type discovery for macOS 26 and filtering muxed devices with the model identifier `iOS Device`; this is implementation evidence, not an Apple guarantee. The discovery classifier must therefore be a small, separately tested compatibility policy. [P1]

Classifier rule, corrected after the 2026-09-08 USB discovery probe: a candidate must advertise muxed media and match the observed `iOS Device` model signature. The physical screen source advertises muxed media without a standalone video media type; actual video samples are validated during preparation before readiness. Any extra model signature requires recorded hardware evidence and a fixture. A device's user-assigned name, its portrait dimensions, or `.external` alone is never sufficient. Ordinary Continuity Camera lens feeds remain excluded. Never use a sole arbitrary camera as fallback. See [discovery evidence](../../testing/ios-usb-capture-implementation.md).

Subscribe to connect/disconnect and discovery changes. Coalesce changes for 250 ms. While the device UI or a prepared source is active, a 2-second reconciliation poll may repair missed events. Initial enumeration may settle asynchronously; retry within a 10-second discovery window, without blocking the UI. After that, display the empty state while continuing event-driven discovery.

### 5.2 Permissions

Camera-style media access may be required even though the feature records a device screen. Explain this before prompting: **“macOS uses camera access to receive your connected device's screen.”** Request audio access only for enabled audio capture that requires it.

Use the app's existing Electron permission entry point where appropriate; the native helper independently verifies actual authorisation before opening inputs. Do not assume a parent app grant automatically authorises every unsigned helper. The release gate exercises the signed installed application and helper, not only Terminal or Xcode.

Update the parent usage strings to include connected-device screen capture. The helper has an embedded Info.plist with appropriate identifiers and usage strings, and is signed with the required hardened-runtime camera/audio-input entitlements. Preserve the existing ContinuityCamera declaration where needed. An Info.plist boolean named like an entitlement is not a substitute for an actual signing entitlement. [A9, R7]

Do not use private APIs, root privileges, developer mode, jailbreaks, WebDriverAgent, AppleScript UI automation, or custom USB drivers. Device trust is performed by the user through Apple's system UI. If a supported configuration cannot work with the public capture path and standard distribution, fail its compatibility gate instead of adding an undocumented workaround.

## 6. Video capture and quality policy

### 6.1 Prepare and inspect

Configure `AVCaptureSession` on a serial queue; `startRunning()` is blocking and must not run on a UI queue. Attach one selected input and video/audio outputs as needed. Observe runtime errors, input removal and delivered format descriptions. [A3]

Request device-native video samples using `AVCaptureVideoDataOutput.videoSettings = [:]`. The empty dictionary and `nil` are not interchangeable: Apple documents the former as device-native and the latter as a default uncompressed format. Inspect actual samples to identify compressed versus pixel-buffer input. Prevent automatic preview-size downscaling where the SDK supports that setting; validate the dimensions that actually arrive. [A4, A5]

Do not force desktop 3840 × 2160 or minimum-60-fps constants onto the device. Prefer the delivered/default screen format. Any format negotiation must use advertised formats and explicit capability checks, not assumptions about iPhone screen dimensions. Preserve variable-rate presentation timing.

### 6.2 Mode A: compressed passthrough

For a compatible H.264 SDR stream, use `AVAssetWriter` with `.mov`, an appropriate source format hint, and an `AVAssetWriterInput` whose `outputSettings` is `nil`. Apple documents this as passing samples through without re-encoding. This does not undo compression performed before the Mac receives them. [A6]

A recording begins on a decodable sync sample at or after the requested start boundary. Do not include preview/pre-countdown footage just to get an earlier keyframe. Preserve decode order, composition offsets, durations, codec configuration and colour metadata. B-frames mean presentation timestamps need not be monotonically increasing in decode order: do not incorrectly reject them.

The prepare gate must verify that both Recordly's preview and export decode this media correctly. Do not accept a codec merely because AVFoundation can write it. Do not assume MOV implies H.264 or safe metadata.

### 6.3 Mode B: H.264 encode

For supported uncompressed SDR input, use a native H.264 writer path with source dimensions and observed timing. Derive compatible settings from AVFoundation after configuring the session, then apply the explicit quality policy. Validate `canApply` / `canAdd`; fail preparation if the encoder cannot handle the source. [A7]

Proposed initial bitrate target: `clamp(width × height × observedFPS × 0.12, 12,000,000, 60,000,000)` bits/second. This is a starting tuning parameter, not an image-quality guarantee. Aim for a keyframe interval no longer than 2 seconds in the encode path. Do not request duplicate 60-fps frames to make a 30-fps source look higher-spec.

Preserve visible pixel dimensions. If the encoder requires even coded dimensions, pad to the next valid dimension and represent the original display aperture correctly; do not truncate a row/column or stretch the screen. Include odd-dimension fixtures.

Keep the source's known colour interpretation and perform a real colour conversion when needed. Do not “fix” colour by relabelling unconverted pixels as Rec.709. v1 certifies tested SDR input/output paths. Untested HDR/wide-gamut combinations must be rejected or explicitly marked unsupported at preparation, not silently tone-mapped under a native-quality claim. Unknown metadata requires a validated compatibility policy and a diagnostic flag rather than invented certainty. If native compressed delivery cannot satisfy the passthrough gates, preparation may explicitly renegotiate a supported uncompressed output for this encode mode, revalidate geometry/colour and select that mode before Record. If no validated raw-output route exists, report Unsupported format; do not pretend the compressed packets can be appended to a raw encoder unchanged.

Mode selection happens before recording. A mode switch during a take is not allowed. Show the chosen mode in recording details as **Original device stream** or **High-quality H.264**; this is diagnostic information, not a complicated quality selector.

### 6.4 Writing, preview and backpressure

Write video into a session-owned `source-video.mov`. Enable movie fragments before writing, initially targeting a 1-second first fragment and 10-second subsequent fragments, consistent with Apple's documented recovery/performance guidance. Evaluate a shorter steady interval only with evidence. Recovery still depends on what was durably written; do not promise an exact maximum loss interval. [A8]

Use bounded work queues. A proposed media-queue ceiling is the first of 6 pending video buffers, 64 MiB or 200 ms of queued media; tune only with recorded evidence. Never let preview buffers hold the capture pool indefinitely. Preview gets a latest-frame-only, independent, disposable queue and is dropped before recording work.

Do not drop arbitrary compressed inter-frame packets and keep recording as though the result is intact. When compressed sample continuity is lost, stop safely and mark the result incomplete. For a validated raw-input path, late frame drops may be counted and surfaced; sustained overload must stop rather than consume unbounded memory. Record delivered, accepted and dropped counts separately.

Check every append and writer status. A file existing on disk does not imply successful recording. Stop only reports a complete take once writers have finished and the media is validated.

## 7. Time and audio contract

### 7.1 Common clock

Use media timestamps, not `Date.now()`, IPC arrival time or browser MediaRecorder chunk time, as the basis of A/V alignment. Convert samples from each capture session's synchronisation clock into a common host-clock domain. Use the current `synchronizationClock` API where available and a deployment-compatible `masterClock` adapter where needed. CoreMedia provides conversion and relative-rate APIs. [A10, A3]

Define `T0` as the host-clock presentation time of the first accepted decodable video sample. Store native time values as integer ticks plus timescale; use strings for 64-bit values crossing JSON. JSON floating-point milliseconds are for display only.

For stream j, map sample time into the common domain: `relativeTime = convertToHost(sampleTime, clock_j) - T0`. Preserve video decode/presentation relationships. Mapping an entire stream by subtracting its *own* first timestamp without retaining its offset is forbidden: that falsely aligns delayed microphones to zero.

A capture-session clock that is absent or cannot be mapped reliably is a preparation failure for the affected combination, not permission to estimate alignment from callback receipt. The hardware gate validates this requirement.

### 7.2 Separate native audio sidecars

Keep phone audio and narration as independent native sidecars during capture. Use audio-only fragmented MOV files (`device-audio.mov`, `microphone.mov`) with uncompressed PCM where available so audio processing is postponed to finalisation. If a device provides compressed audio, decode through the documented native audio path; do not assume byte payloads are PCM.

Each sidecar can start when its first sample arrives, independently of video. This avoids delaying the video writer until a quiet phone produces audio. The sidecar begins at its own local zero, while the journal records its common-clock offset, format and timebase mapping. Preserve internal discontinuities with explicit sample timestamps/PCM silence or documented segment records; normalising just the first offset is not sufficient.

Narration is captured natively from a separately selected Mac input, not by reusing a browser microphone recorder with unrelated timing. A microphone disappearing does not switch to the default microphone. Stop the take safely and retain the preceding audio/video with an interruption warning.

For device audio with no observed samples, show an unavailable/not-received warning, preserve video, and do not declare microphone denial. A silent valid audio stream is not the same as no audio stream. If required audio could not be opened before start, require the user to disable it or fix it; do not silently change their choice.

### 7.3 Final audio assembly

The main process uses the existing bundled FFmpeg path resolver to create `recording.mov` from source video and available audio sidecars. Copy the video stream. Align audio using the stored common-clock offsets, trim audio that precedes T0, insert leading and internal silence where required, and resample to a common 48 kHz output timeline.

Do not repair drift by blindly stretching every audio file to video duration. Use measured timing/clock mapping; test correction on fixtures with known offsets and rates. Resampling must preserve intended timing, not hide a stopped microphone. Trim/pad the mixed audio to the validated recording boundary without shortening the video to the shortest audio stream.

With one enabled source, use unity gain. With two, mix each at 0.5 linear gain (approximately -6 dB) with automatic loudness normalisation disabled. Encode the resulting single soundtrack as AAC, initially 192 kbps stereo, with a mono-only narration configuration permitted at 128 kbps. Record the actual output configuration. Retain original sidecars until the user discards/deletes the take under the normal media-retention policy.

v1 exposes one mixed soundtrack in the existing editor; independently editable narration and phone-audio tracks are not promised. A failed mux/mix never destroys the source video. Offer retry or **Open without audio** as an explicit user action.

A sidecar's timestamps and timing metadata must agree about gaps. Do not insert a gap twice when it is already represented in the media timeline. The finaliser applies one mapping from each sidecar's local timeline to the common video timeline and tests both encoded silence and missing-sample gaps.

### 7.4 Duration

Take duration is bounded by the actual start/stop media timeline. Tests must cover sparse/static delivery and quiet audio: a valid five-minute static-screen take must not become a one-frame short clip, and late/absent audio must not clip video duration. Represent a held final frame through the stop boundary using valid sample/container timing; do not fabricate motion or report synthetic frames as captured frames. If a source's timing cannot satisfy this contract, preparation must use a validated compatible path or reject that configuration.

## 8. Helper and Electron protocol

### 8.1 Transport

Spawn the bundled helper directly with `shell: false`. Use stdin/stdout for UTF-8 newline-delimited JSON. Reserve stdout for protocol messages and stderr for bounded, redacted diagnostics. Drain both continuously. Do not use a localhost web server, TCP port or executable path supplied by a renderer.

Every command carries `protocolVersion: 1`, `requestId`, `command`, and relevant `sessionId` / generation. Responses distinguish command acceptance from state completion. Events carry a monotonic sequence and session/generation so late events from a previous device cannot mutate the current UI. Device-source generations validate inventory selection; preparation/preview generations are a separate counter incremented on each preparation and helper restart. Active-session media is not invalidated merely because another device changes the inventory.

Reject malformed JSON, unsupported versions, unknown commands, overlong IDs and lines larger than 64 KiB. Cap outstanding commands at 8. Duplicate state-changing requests with the same ID and session return the same recorded result; they must not start another writer. Retain a bounded recent-request cache.

### 8.2 Commands and events

| Command | Purpose / completion condition |
|---|---|
| `hello` | Report helper build, protocol version and supported backend capabilities. |
| `discover` | Start/refresh device and microphone inventory; returns a snapshot, then inventory events. |
| `prepare` | Open selected source and optional microphone; complete only after valid video samples and a selected recording mode. |
| `setPreviewEnabled` | Enable/disable preview work for the current prepared generation. |
| `start` | Arm files; emit `recordingStarted` only after the first eligible sample is accepted. |
| `stop` | Idempotently finish writers and return native source paths plus timing metadata. |
| `cancel` | Cancel a not-yet-started take or finish a take marked for explicit discard. Main owns deletion. |
| `release` | Release a prepared session; reject during active recording unless it first stops. |
| `inspectMedia` | Inspect a main-approved session file without starting capture or requesting camera access. |
| `shutdown` | Safe stop/release on application exit or stdin EOF. |

Events: `inventoryChanged`, `prepared`, `recordingStarted`, `progress`, `warning`, `nativeFinalized`, `error`. `progress` is at most once per second and reports actual counters and timeline data, not synthetic percentage-complete values. Native finalisation and final editor commit are distinct events.

### 8.3 Preview pipe

Use an additional binary pipe (child fd 3), not base64 in JSON control messages. Frame records have a fixed 24-byte, big-endian header: magic `RLIP` (4 bytes), version (u16), flags (u16), generation (u32), sequence (u32), JPEG length (u32), reserved zero (u32), followed by JPEG bytes. Maximum JPEG payload: 128 KiB. Invalid headers close the preview stream and surface a warning without corrupting the recording control parser.

The helper writes previews on an independent non-blocking/async queue. At most one queued preview is retained at each boundary. Main forwards the latest JPEG only to the authorised requesting window; the renderer replaces/revokes object URLs. Closing a preview consumer must never deadlock the native writer.

### 8.4 Renderer API

Expose a small namespaced API, for example `electronAPI.iosCapture`, with `getSnapshot`, `discover`, `prepare`, `start`, `stop`, `cancel`, `release`, `onState`, and `onPreview`. Each subscription returns an unsubscribe callback. `prepare` accepts settings and a source token; `start` accepts the main-issued prepared session ID. Neither accepts a destination file path or command line. Main revalidates that prepared session before arming.

Main validates sender frame/window identity, argument schemas, ownership and current session state on every call. Map helper result paths back to the main-allocated session directory; reject escapes, symlinks and unexpected basenames. Renderer clients cannot choose a helper executable or invoke arbitrary native commands.

## 9. State machine and failure semantics

State sequence:

`unavailable → idle/discovering → preparing → ready → countdown → starting → recording → stopping → finalising → completed`

Alternative terminals: `cancelled`, `failed`, `interrupted`, `recoveryAvailable`. This sequence includes UI presentation: countdown is a UI substate of Ready, while main remains Ready until the start request. Cancelling the countdown returns to Ready without creating media. Discovery and preview visibility are orthogonal to the active recording state.

| Situation | Required action |
|---|---|
| Start while another backend holds the lease | Reject `RECORDING_BUSY`; no native/session changes. |
| Device removed during countdown/preparation | Cancel start, release resources, show connection help. |
| Start succeeds as a command but no decodable video arrives within 10 s | `NO_VIDEO_SAMPLES`; no red recording state and no successful empty take. |
| Stop requested while starting | Cancel the arm; finalise only if actual media was accepted. |
| Double Stop or racing Stop/disconnect | One native finalisation and one final editor commit. |
| Confirmed device removal/runtime capture failure | Stop, finalise valid preceding media, mark interrupted. |
| Incompatible width/height/codec/transform/colour format change | Reject new samples, safely stop the preceding take. |
| No new frames / black frames | Describe observed lack of frames if needed; do not infer lock or stop solely from a static/dark screen. |
| Permission denied/restricted | Specific explanatory state and settings action; no retry prompt loop. |
| Device busy | Explain another app may be using it; explicit Retry. No process killing. |
| Audio absent or interrupted | Follow section 7; no silent device substitution or undetected soundtrack loss. |
| Storage reserve reached | Graceful stop and warning; preserve recovery data. |
| Helper exits/crashes | Release lease after cleanup, reject pending calls, offer validated recovery candidates. |
| Preview backpressure | Drop preview only. |
| Writer backpressure / append failure | Stop or fail according to section 6; never unbounded buffering. |
| Mux/finalisation error | Keep native files and journal; Retry or explicit video-only open. |
| Renderer crash | Main safely finalises, retains result and restores state after renderer restart. |
| System sleep / application quit | Request safe stop immediately; native stdin EOF also initiates finalisation. No automatic recording on wake. |
| Packaged helper missing / incompatible protocol | Mark feature unavailable with reinstall/update guidance. No runtime compilation. |

Use stable machine-readable error codes and separate localised user messages. Proposed codes include `UNSUPPORTED_PLATFORM`, `HELPER_UNAVAILABLE`, `PROTOCOL_MISMATCH`, `PERMISSION_DENIED`, `DEVICE_NOT_FOUND`, `DEVICE_BUSY`, `UNSUPPORTED_FORMAT`, `NO_VIDEO_SAMPLES`, `CLOCK_MAPPING_UNAVAILABLE`, `RECORDING_BUSY`, `FORMAT_CHANGED`, `DEVICE_DISCONNECTED`, `AUDIO_INTERRUPTED`, `DISK_SPACE_LOW`, `WRITER_FAILED`, `FINALIZATION_FAILED`, `HELPER_EXITED`, `INVALID_REQUEST`, `UNSUPPORTED_OPERATION`.

A 10-second native-stop grace period begins graceful termination escalation, not deletion. If an encoder or FFmpeg remains alive, preserve files before termination; FFmpeg receives a progress/stall watchdog rather than a tiny fixed total duration. A long take can legitimately require longer audio processing. UI elapsed timers never substitute for native acknowledgements.

## 10. Storage, recovery and project persistence

### 10.1 Session layout

Allocate a unique directory under Recordly's approved recording storage, not beside an arbitrary renderer path:

```
<recordings>/ios-<session-uuid>/
  capture-journal.json
  native-timing.json        # helper-owned, survives loss of the parent
  source-video.mov
  device-audio.mov          # only when samples exist
  microphone.mov            # only when samples exist
  recording.pending.mov     # finalisation output, never opened as complete
  recording.mov             # validated, committed editor source
  <existing session-manifest filename>
  diagnostics.json          # redacted and bounded
```

Video-only sessions may commit `source-video.mov` directly as their editor source rather than create a duplicate. A/V finalisation writes a separate destination. For that case preflight finalisation capacity for another video-sized file; a mux operation is not free in disk space just because it copies video packets.

Before recording, require a writable local destination and at least 1 GiB available. During capture check periodically; the reserve must cover approximately 60 seconds of measured incoming data plus space for the projected final copy and a 256 MiB minimum safety buffer. Compute with byte rates, not resolution alone. Gracefully stop before exhausting that reserve. Report storage estimates as estimates, not remaining-time promises.

The journal is created before writers and atomically replaced for lifecycle changes. Main and helper have non-overlapping ownership: main owns lifecycle/files/commit, helper owns native timing counters and finalisation results; main merges those into the journal. Do not have both processes independently rewrite the same file. The helper atomically maintains a separate `native-timing.json` containing stream offsets, timing/format changes and its terminal result; update it at first samples, relevant changes, periodic checkpoints and stop. Recovery uses that file if the parent crashed before consuming stdout. Loss of timing metadata permits an explicitly labelled video-only recovery, not a guessed A/V mix.

Record source kind, session state, source-format fingerprint, recording mode, actual media geometry and colour metadata, timebase/offset/rate information, enabled and observed audio sources, stop reason, created time, expected relative files and validation result. Do not store the phone's raw unique ID, serial number or personal name.

### 10.2 Commit boundary

Native finalisation completes first. Main checks file size, presence of a decodable video track, nonzero valid duration, expected dimensions and selected audio results. Use a new native `AVURLAsset`-based inspector and the application's actual decode smoke test where needed; do not assume `ffprobe-static` is available in packaged macOS builds—the inspected packaging excludes its Darwin binaries.

After optional mix/remux, validate the final file, atomically rename it, write the recording-session manifest, mark the journal committed, and hand it to the editor exactly once. A recovered/interrupted take is visibly distinguished from a normal completed take.

### 10.3 Session manifest

Introduce version 3 for mobile recording-session manifests. Keep readers for versions 1 and 2. Add optional `captureMetadata` and persist `hideOverlayCursorByDefault`; remove the current “no webcam means delete manifest” condition when meaningful capture metadata exists. Existing desktop/webcam manifests can remain version 2 unless the new fields are used.

Read relative paths only after validating they resolve inside the session directory. Missing optional audio/diagnostic sidecars do not make an otherwise valid committed video unopenable. Malformed provenance falls back safely to ordinary media presentation, never executable behaviour.

### 10.4 Saved projects and presentation

Extend `EditorProjectData` with an optional validated `captureMetadata` field without unnecessarily changing the main project version. Preserve it in save/load, snapshots, Save As and reopen. File-path-bearing recovery data stays in the capture journal, not exported project provenance. User-visible editor settings are already explicit and must remain authoritative.

For a fresh mobile take: no cursor overlay, no cursor telemetry loading, no automatic mouse-driven zoom generation, no crop, and a source-native canvas/aspect so no pixels are cut off. Use existing wallpaper/padding/shadow defaults that do not crop the source; set initial corner radius to zero. The user may then choose 9:16, 16:9, 1:1 or other existing presentation options. An iPhone screen is not assumed to be exactly 9:16.

Apply these defaults once on fresh import, not on every open. Saving and reopening must preserve manual zooms, annotations, aspect/crop and user-changed cursor settings. Existing desktop projects must not acquire mobile defaults.

### 10.5 Recovery

At launch, inspect only session directories created by this feature that contain an incomplete journal. Validate candidate media before offering **Recover recording**, **Open folder**, or **Discard**. Never label an unrecoverable file as recovered. Never automatically delete incomplete sessions by age. Respect the user's normal recording-retention/deletion actions.

Fragmentation improves the chance of retaining already written media; the last fragment or an extremely short recording may still be lost. Power loss, filesystem failure and an encoder crash are not all equally recoverable. Record the limits honestly. [A8]

## 11. Privacy, security and platform constraints

All capture, preview, audio and diagnostics remain local. No analytics SDK, pairing server, local web listener or network permission is introduced. Device content is never logged. Display names appear only where needed in the current UI; diagnostics use session tokens and generic device family.

Do not bypass protected/DRM content or attempt to decode capture-protected frames. Do not infer a protected app from black pixels. Remind users that notifications and sensitive on-screen information may appear in recordings; do not promise to suppress notifications or redact content automatically.

Validate IPC request sizes/types, sequence numbers, allowed senders, relative media paths and symlink boundaries. Escape device labels as text. Bind device/microphone selection to current inventory generations. Do not accept arbitrary FFmpeg filters or shell strings from the renderer. Execute bundled binaries by exact resolved paths, with argument arrays and bounded output logs.

Use an appropriate sleep-prevention assertion during an active take, released on every terminal path. This does not prevent forced sleep or guarantee recording through lid closure. No background recording begins without explicit user action.

## 12. Build and distribution

Keep the current macOS 14 minimum target unless a separately approved repository change raises it. Build the new helper for both existing macOS architectures, but advertise native recording on an architecture only after its hardware/runtime acceptance gates pass. Do not treat Rosetta execution as a substitute for testing an Intel support claim.

The new Swift package compiles into `recordly-ios-device-helper`, staged under `electron/native/bin/darwin-arm64/` and `darwin-x64/`. Extend `scripts/build-native-helpers.mjs` to build/stage it without altering existing helpers. It may compile from source in development; installed builds must use the bundled binary and fail clearly when missing.

Include the helper in package contents, ASAR-unpack checks, signature/notarisation verification and packaged-binary smoke checks. Validate its embedded privacy metadata and actual entitlements in each Mach-O slice. Smoke mode `--self-test` must run without connecting a phone or triggering TCC permission dialogs. It validates protocol, file layout, clock-independent policies and linkage—not hardware capture.

Add macOS-only native tests; Windows/Linux CI must not attempt Swift device capture. Keep their existing tests and build checks. Update user docs with cable/trust steps, audio semantics, fixed-orientation limitation, quality wording and recovery behaviour.

## 13. Acceptance criteria and release evidence

| ID | Required evidence |
|---|---|
| A01 Discovery | Distinct tokens for two same-name devices; unrelated webcams and physical Continuity Camera feeds excluded; connect/unplug refresh works. |
| A02 Permissions | Clean signed installation: allow, deny, change in Settings and relaunch; no requirement to open QuickTime first; no desktop-screen permission gate for video-only phone capture. |
| A03 Readiness | Discovered-only device cannot record; 10-second no-sample failure is understandable; cancel/stop during start produces no false-success take. |
| A04 Native fidelity | Delivered geometry, visible aperture and orientation preserved; preview resizing cannot change recording geometry. |
| A05 Passthrough | For eligible deterministic fixtures, captured compressed payloads remain unchanged through normal video-copy finalisation; decode starts cleanly including keyframe/B-frame cases. |
| A06 Encode | Moving UI/text test at delivered resolution passes visual review; no forced scaling, stretched aspect or persistent overload. |
| A07 Colour | On-device reference, QuickTime USB, native source and final Recordly export compared on the same test UI; no unexplained gamma/range/colour shift relative to the received source. Wider-gamut differences documented, not concealed. |
| A08 Audio sync | Phone-only, narration-only and both; known positive/negative start offsets; start and end alignment within 80 ms on a 30-minute flash/click fixture; delayed start and internal gaps handled. |
| A09 Static duration | A five-minute static/dark UI and quiet audio retain the intended timeline; no false lock detection or one-frame short take. |
| A10 Interruptions | Unplug, format change, microphone removal, disk pressure, helper exit, renderer crash and quit produce honest completion/interruption states and retain valid preceding media. |
| A11 Persistence | Fresh recording, raw media reopen, project save/reopen, Save As and missing optional sidecars preserve intended settings and do not alter desktop projects. |
| A12 Export | Portrait and landscape source; native aspect, 9:16 and 16:9 compositions; manual zoom and annotation; existing preview and export agree on geometry, duration and sound. |
| A13 Performance | Preview backpressure cannot stall recording; no monotonic memory growth in a 30-minute take; writing queues remain bounded. For tested encode configurations, unexplained video loss below 1%; passthrough packet loss is not silently accepted. |
| A14 Repeatability | 20 consecutive start/stop cycles without leaked helper/session/input; double-stop and stale callbacks do not produce duplicate editor opens. |
| A15 Packaging | Installed signed/notarised app works without Xcode or repo files; both advertised architectures have smoke and physical-device evidence. |
| A16 Regression | Existing macOS desktop/audio capture, Windows WGC/browser paths, Linux portal paths, webcam sessions and old project formats retain baseline behaviour. |

Minimum physical matrix: Apple Silicon with a current USB-C iPhone; a Lightning iPhone/cable if advertised; at least one iPad before advertising iPad support; a real Intel Mac if Intel capture is advertised; oldest supported macOS and the latest stable macOS used for release. Record exact macOS, iOS/iPadOS, device family, cable/hub, app build and recording mode. Include at least one direct-cable and one hub test. Do not market OS beta compatibility based only on compilation.

A proposed already-trusted-device readiness target is within 5 seconds under normal test conditions; the UI remains correct when slower. This is a measured UX target, not a guarantee of Apple's enumeration latency.

## 14. Gates, rollout and definition of done

**G1 — API/permission feasibility:** prove positive device-screen classification, first frames and signed-helper permission identity on the target systems. Failure blocks feature enablement on that combination.

**G2 — media fidelity:** prove input format, native/passthrough viability, editor compatibility, colour and sparse-stream duration. Failure selects a validated encode path or marks the configuration unsupported. It does not justify a desktop-window fallback.

**G3 — audio:** prove common-clock mapping, sidecar timing and 30-minute sync. Until it passes, narration stays developer-only and the feature is not called v1 complete.

**G4 — reliability and distribution:** interrupted-media recovery, session/project compatibility, resource cleanup and signed installed-app testing pass before general availability.

Start behind an internal build-time flag, default off. Keep source UI absent when disabled. Progress to a labelled beta after G1–G3, then enable generally after G4 and the acceptance matrix. No server-side rollout service is necessary. Already recorded videos must remain openable when capture is disabled later.

Done means all F01–F12 requirements, A01–A16 acceptance cases and G1–G4 gates have evidence, the shipped binary includes the helper, and no success/quality claims exceed the actual support matrix. A working preview alone is not done.

## 15. Source register

All repository references below use the inspected baseline. API behaviour is documented at the linked sources; device-specific behaviour still requires the gates above. URLs were consulted on 8 September 2026.

- R1 — Repository baseline: https://github.com/webadderallorg/Recordly/commit/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1
- R2 — Package/scripts: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/package.json
- R3 — Source popover: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/src/components/launch/popovers/SourcePopover.tsx
- R4 — Launcher source mapper: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/src/components/launch/popovers/launchPopoverTypes.ts
- R5 — Recorder hook: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/src/hooks/useScreenRecorder.ts
- R6 — Session persistence: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/electron/ipc/project/session.ts
- R7 — Packaging: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/electron-builder.json5
- R8 — Native builds: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/scripts/build-native-helpers.mjs
- R9 — Project persistence: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/src/components/video-editor/projectPersistence.ts
- R10 — Packaged-binary smoke checks: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/scripts/smoke-packaged-binaries.mjs
- R11 — Native helper paths: https://github.com/webadderallorg/Recordly/blob/4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1/electron/ipc/paths/binaries.ts
- A1 — Apple connected-device QuickTime recording: https://support.apple.com/en-au/guide/quicktime-player/qtp356b55534/mac
- A2 — CoreMediaIO screen-device opt-in: https://developer.apple.com/documentation/coremediaio/kcmiohardwarepropertyallowscreencapturedevices
- A3 — AVCaptureSession, configuration and synchronisation clocks: https://developer.apple.com/documentation/avfoundation/avcapturesession
- A4 — Native versus uncompressed video settings: https://developer.apple.com/documentation/avfoundation/avcapturevideodataoutput/videosettings
- A5 — Automatic preview-size buffer configuration: https://developer.apple.com/documentation/avfoundation/avcapturevideodataoutput/automaticallyconfiguresoutputbufferdimensions
- A6 — AVAssetWriterInput passthrough semantics: https://developer.apple.com/documentation/avfoundation/avassetwriterinput/outputsettings
- A7 — Recommended settings after configuring the session: https://developer.apple.com/documentation/avfoundation/avcapturevideodataoutput/recommendedvideosettings(forvideocodectype:assetwriteroutputfiletype:)
- A8 — Fragment recovery: https://developer.apple.com/documentation/avfoundation/avassetwriter/moviefragmentinterval ; https://developer.apple.com/documentation/avfoundation/avassetwriter/initialmoviefragmentinterval
- A9 — Electron media permission API and usage descriptions: https://www.electronjs.org/docs/latest/api/system-preferences
- A10 — CoreMedia clock conversion/rate APIs: https://developer.apple.com/documentation/coremedia/cmsyncgetrelativerate(_:relativeto:)
- P1 — Primary implementation evidence, not a platform guarantee: https://github.com/facebook/idb/pull/938 (discovery/authorisation changes for macOS 26; do not copy code without reviewing its licence and suitability).
