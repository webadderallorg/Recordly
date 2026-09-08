# iOS USB capture implementation evidence

Date: 8 September 2026. Baseline: `4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1`.

This record separates implemented software behavior from physical and release proof. Tasks 03–15, deterministic portions of Task 16, packaging automation from Task 17 and documentation/policy work from Task 18 are implemented. Task 02's physical feasibility proof and Task 16's physical matrix are pending. The feature remains disabled by default.

## Implementation by task

| Task | Implemented software | Remaining evidence |
| --- | --- | --- |
| 01 | Baseline results and evidence templates recorded; final broad software gates passed. | None for the software baseline. |
| 02 | Public-API probe foundations were incorporated into the tested helper policies; a USB iPhone discovery probe confirmed the muxed-only screen signature below. | First samples, formats, TCC behavior, color, rotation, unplug, sparse delivery and signed installed app. |
| 03 | Versioned shared source, snapshot, protocol, native-time, metadata and error-code validators. Mobile and desktop types narrow at dispatch boundaries. | Hardware-derived support policy remains unverified. |
| 04 | macOS 14 Swift package, bounded NDJSON loop, permission-free self-test, embedded privacy metadata, development/packaged resolution and dual-architecture staging. | Runtime/signing proof for each advertised architecture. |
| 05 | Checked CMIO opt-in, classifier with a physical muxed-only discovery regression, opaque tokens, coalesced discovery/reconciliation, native microphones and permission policy. | Broader physical device classification, signed TCC and repeated physical selection. |
| 06 | Baseline H.264 passthrough, supported Rec.709 8-bit 4:2:0 encode, odd-size padding, fragmented MOV, format/boundary checks and AVURLAsset inspection. | Physical sample formats, color, overload and sparse/static capture. |
| 07 | Host-clock rational timing, signed PCM sidecars, represented gaps and atomic native timing checkpoints. | Physical clock mapping and 30-minute device/narration sync. |
| 08 | Bounded JPEG/RLIP preview parser and nonblocking latest-frame delivery, with orientation/aperture handling. | Sustained physical preview-stall and resource measurements. |
| 09 | Helper process client, authoritative controller state, operation epochs, timeouts, idempotent terminal path and retained exactly-once completion. | Physical helper/device failure behavior. |
| 10 | Safe session allocation, journals, native inspection, FFmpeg audio alignment, video-copy commit, progress watchdog and retryable finalization. | Real captured media and installed bundled-runtime exercise. |
| 11 | Sender-validated namespaced IPC, source narrowing, default-off policy and exclusive desktop/mobile recording lease. | Hardware/platform desktop regressions. |
| 12 | Mobile recorder routing before desktop acquisition, countdown, HUD, unsupported-operation enforcement and native-authoritative status. | Mounted multiwindow and physical interaction run. |
| 13 | Device picker, factual help, native microphone selection, preview disposal, warning presentation and locale structure. | Manual keyboard, screen-reader, reduced-motion and physical preview review. |
| 14 | Manifest v3, v1/v2 compatibility, project provenance, Save As, native-aspect fresh defaults and editor interruption notice. | Physical portrait/landscape editor and export comparison. |
| 15 | Validated recovery registry, explicit video-only recovery, lifecycle cleanup, diagnostics redaction and abortable finalization. | Real fragmented interruption, unplug, sleep, quit and power-loss recovery. |
| 16 | Reproducible synthetic generator/verifier, positive and negative media matrix, and native-inspector-to-finalizer-to-manifest integration. | A01–A16 physical/cross-platform matrix, 30-minute and repetition runs. |
| 17 | Helper build/staging, packaged binary checks, architecture/deployment/plist/entitlement checks, CI workflow and distribution verification integration. | Signed/notarized clean-account installation; real Intel runtime. |
| 18 | User workflow, evidence documents and immutable default-off policy pending release gates. | G1–G4 and support claims required before enabling or README marketing. |

## Software verification snapshot

| Check | Result | Scope and limit |
| --- | --- | --- |
| Native XCTest | Pass: 44 tests, zero failures | Synthetic AVFoundation/CoreMedia media, discovery lifecycle and format-transition fixtures; no device or TCC prompt in the suite. |
| Native helper build | Pass: arm64 and x86_64 staged, macOS 14 target, embedded plist | Cross-build is not Intel runtime or signing evidence. |
| Helper CLI smoke | Pass | Self-test, duplicate request replay, synthetic inspection and EOF finalization. |
| Full JavaScript/TypeScript tests | Pass: 145 files, 1,221 tests; one explicit opt-in native suite skipped | The skipped native integration test was run separately and passed before this discovery/UI update. |
| Opt-in native finalization integration | Pass: one test | Synthetic raw video/PCM → native inspector → production finalizer/FFmpeg → manifest reopen → verifier. |
| TypeScript, localization, full lint and formatting checks | Pass on the reviewed source | No hardware or interactive UI claim. |
| Synthetic media matrix | Pass: 7 positive variants; expected rejection: 5 negative variants | Physical-device evidence is explicitly false in reports. |
| Development macOS package build | Pass for both architecture artifacts: DMG and ZIP, Apple Development signed; notarization skipped | Preceded final review edits; distribution artifacts require a fresh release build. Does not satisfy G4. |
| Final-source host bundle | Pass: normal build pipeline with `--dir --arm64 --publish never`, automatic identity discovery disabled | Refreshed arm64 app has an ad-hoc signature. No release was published; not an installed distribution test. |
| Packaged binary smoke | Pass after final-source bundle refresh, including both helper slices | An x64 `otool` byte-format mismatch was fixed with a regression test; this does not validate notarization or device permission identity. |

The positive synthetic variants are portrait, landscape, odd dimension, delayed microphone, negative offset, internal gap represented as encoded silence, and silent/static. Negative cases verify rejection of wrong rotation, 250 ms displaced audio, missing audio, a two-second truncation and a byte-truncated MOV. Video preservation is compared by hashing demuxed compressed packet payloads rather than whole MOV containers.

The native suite also proves a synthetic 300-second static baseline passthrough and raw single-frame timeline. This is container timing evidence, not a physical five-minute phone test. `observedFrameRate` remains `null`; no estimator or frame-rate guarantee is claimed.

## USB discovery correction — 8 September 2026

On macOS 26.2 (25C5048a), arm64, an unlocked and trusted iPhone connected by USB was missing from the development test app built from `3dd5bd26215860ab781b6ff814adf1b8635bebbb`. The user confirmed the cable, unlock and trust state; the USB registry independently confirmed an iPhone was present. Cable/hub topology and the phone OS version were not recorded.

A noncapturing AVFoundation probe enabled the public CMIO screen-device discovery property successfully. Both modern and legacy muxed discovery returned a connected external source with `modelID: "iOS Device"`, `hasMuxed: true`, `hasVideo: false`, and `hasAudio: false` after approximately two seconds. A separate iPhone camera source advertised `modelID: "iPhone18,1"`, video and no muxed media. No device names, serials or native identifiers were retained in this evidence.

The original classifier rejected the screen source because it required a standalone video media type. The corrected rule requires the exact `iOS Device` model plus muxed media. Preparation still requires actual video samples before readiness; audio availability remains unknown until samples establish it. The observed camera source and generic muxed webcams remain excluded.

The new regression failed against the original classifier, then passed with all 31 native tests after the fix. Both helper architectures were rebuilt. The corrected arm64 helper's real `discover` command returned one device with unknown audio availability and no errors, without preparation or recording. Development logs are `/private/tmp/recordly-discovery-red.log`, `/private/tmp/recordly-discovery-native-tests.log`, and `/private/tmp/recordly-discovery-helper-build.log`; the sanitized discovery result is `/private/tmp/recordly-discovery-fixed-check.json`, and the noncapturing probe source is `/private/tmp/recordly-discovery-probe.swift`. This is partial G1/A01 discovery evidence only: no recording, first frame, audio, duplicate-label/removal test or permission prompt was exercised.

Subsequent fresh helper launches exposed a second startup issue. Retaining the discovery session alone was insufficient. With the app closed, sequential eight-second probes found the screen after approximately two seconds when CMIO and AVFoundation discovery initialized on the main thread with a running main run loop. Main-thread initialization with `dispatchMain()`, and background initialization with a main run loop, both stayed empty. The helper now initializes discovery on the main thread, retains the discovery session until discovery stops, and services the main run loop while its serial engine queue continues to own inventory and capture state. The probe source and sanitized results are `/private/tmp/recordly-discovery-lifecycle-probe.swift` and `/private/tmp/recordly-discovery-main-thread-results.log`.

After this correction, two consecutive fresh launches of the exact development-signed test-app helper returned one iPhone, unknown audio availability, and no errors, without preparation or recording. Reports are `/private/tmp/recordly-discovery-context-packaged-1.json` and `/private/tmp/recordly-discovery-context-packaged-2.json`. All 31 native tests passed again, both architectures rebuilt, and the updated test bundle passed deep signature verification. The native tests and the physical discovery probes are separate evidence; neither establishes first-frame, audio or installed-release permission behavior.

The rebuilt `Recordly iOS Test` app (1.4.0-ios-test.2, arm64, isolated test identity) was reopened and its iPhone/iPad picker visibly listed the connected phone with the ready-to-select discovery message. The phone was not selected and no capture permission or recording was started. A separate delayed-hello process check confirmed the helper stays alive before commands arrive and shuts down cleanly on stdin EOF, without discovery.

## Picker, refresh and preparation follow-up — 8 September 2026

The launcher now keeps permission-free discovery active while mounted, so closing the source picker does not shut down the helper and repeat USB startup. Releasing a prepared source, including through another window or desktop selection, restarts discovery. The recovery section was removed from the picker and More menu; saved media and the internal recovery/storage validation remain intact.

Idle Refresh rebuilds the main-thread CMIO discovery observation. Prepared sources reuse their existing observation. Device-list KVO schedules reconciliation without waiting for the two-second fallback poll, and generation checks ignore callbacks from replaced or stopped observations. The controller waits through immediate empty inventory for up to five seconds, accepts later device arrivals, coalesces repeated requests, and rejects refresh during capture transitions. Refresh shows progress, and successful shared inventory clears obsolete discovery errors.

Preparation had a separate format-transition defect: after requesting raw output, queued compressed samples were immediately rejected. It now requests advertised `420v` or `420f` once and waits within the existing ten-second deadline. Geometry, color and first-sample validation remain required. Encoder recommendations are queried only for advertised H.264 encoding, avoiding an unsupported AVFoundation codec query during passthrough.

Thirteen added controller tests, six native discovery-lifecycle tests and seven native format-negotiation/capability tests cover the update. Regression runs reproduced stale discovery, late helper failures and premature compressed-frame rejection before their fixes. The complete updated suites pass: 1,221 JavaScript/TypeScript tests and 44 native tests. Type, lint, formatting and locale checks also pass. A browser fixture mounting the actual picker verified warm discovery across opening/closing, busy refresh feedback, automatic rediscovery after another window releases a prepared source, clearing obsolete errors after shared recovery, and no recovery-list requests.

The physical format rejection is not yet diagnosed. A temporary metadata-only test helper configured video successfully and reported H.264/JPEG writer codecs plus `420v`/`420f` and other raw outputs, but delivered no video frame before timing out. A first USB check used an obsolete system-profiler report type; a follow-up hardware-registry check confirmed one connected iPhone. The timeout therefore does not establish disconnection. No screen or audio media was saved by this probe, and its instrumentation was removed from the updated test build. Reconnected-device preparation, repeated discovery, recording and the iOS 9:41 status-bar behavior still require physical verification; this follow-up does not pass a release gate.

## Review findings resolved

Independent integration and media reviews found defects at real ownership boundaries. Corrections include:

- preparation/session epochs now prevent an asynchronous cancelled prepare from reopening inputs without a lease;
- the standalone picker remains alive through mobile preparation;
- editor handoff is reserved and memoized before asynchronous work, preventing concurrent duplicate opens;
- last-client cleanup releases prepared resources while a disposable preview close does not end a take;
- legacy source-selection IPC applies the same sender policy before changing mobile state;
- desktop native exit releases the recording lease independently of renderer cleanup;
- malformed preview framing closes that stream and surfaces a warning without corrupting capture control;
- capture warnings and committed interruption/audio outcomes are visible in the picker, HUD and editor;
- disk reserve uses actual media-file growth and reserves a second video-sized output only when audio assembly needs it;
- clock conversion maps durations through converted endpoints and permits one PCM sample of rounding tolerance;
- active sessions are excluded from recovery scans, and recovery cannot manufacture missing timing or counters;
- aborting finalization terminates the child process with bounded escalation while retaining partial output.

Focused regression tests cover these fixes. They remain software evidence and do not replace physical acceptance.

## Running the software checks

```bash
npm test
npx tsc --noEmit
npm run lint
npm run format:check
npm run i18n:check
npm run test:ios-native
npm run build:ios-helper
```

Generate and verify a synthetic session with explicit paths:

```bash
node scripts/fixtures/ios-capture/generate.mjs \
  --output-dir /absolute/new-directory \
  --variant portrait

npm run verify:ios-capture-fixture -- \
  --session-dir /absolute/session \
  --expected /absolute/expected.json \
  --report /absolute/report.json
```

The verifier rejects unknown, missing and nonabsolute arguments. It uses the native media inspector on macOS and the bundled FFmpeg resolver. Some media checks require normal macOS codec/IOSurface access and can fail under a restrictive sandbox.

For local application packaging, this host required system Python for the native Electron rebuild:

```bash
npm_config_python=/usr/bin/python3 npm run build:mac
npm run smoke:packaged-binaries
```

Release distribution verification additionally requires the repository's signing/notarization environment and explicit `--arch` and `--team-id` inputs. A local Apple Development signature is not release proof.

## Release boundary

G1 API/permissions has **Partial** discovery evidence only; G2 physical media fidelity, G3 physical long-duration audio and G4 reliability/distribution remain **Not tested**. No release gate has passed. Keep the release feature disabled; the user-requested isolated development test build is not a release. Do not advertise iPhone/iPad or Intel support or add a README product claim from these results. Physical results belong in [the acceptance matrix](ios-usb-capture-matrix.md), with exact build, OS, generic device family, cable/setup and artifact location.
