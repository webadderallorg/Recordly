# iOS USB capture implementation evidence

Date: 8 September 2026. Baseline: `4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1`.

This record separates implemented software behavior from physical and release proof. Tasks 03–15, deterministic portions of Task 16, packaging automation from Task 17 and documentation/policy work from Task 18 are implemented. Task 02's physical feasibility proof and Task 16's physical matrix are pending. The feature remains disabled by default.

## Implementation by task

| Task | Implemented software | Remaining evidence |
| --- | --- | --- |
| 01 | Baseline results and evidence templates recorded; final broad software gates passed. | None for the software baseline. |
| 02 | Public-API probe foundations were incorporated into the tested helper policies. | Entire physical probe: real source identity, formats, TCC behavior, color, rotation, unplug, sparse delivery and signed installed app. |
| 03 | Versioned shared source, snapshot, protocol, native-time, metadata and error-code validators. Mobile and desktop types narrow at dispatch boundaries. | Hardware-derived support policy remains unverified. |
| 04 | macOS 14 Swift package, bounded NDJSON loop, permission-free self-test, embedded privacy metadata, development/packaged resolution and dual-architecture staging. | Runtime/signing proof for each advertised architecture. |
| 05 | Checked CMIO opt-in, positive fixture-based classifier, opaque tokens, coalesced discovery/reconciliation, native microphones and permission policy. | Real device classification, signed TCC and repeated physical selection. |
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
| Native XCTest | Pass: 30 tests, zero failures | Synthetic AVFoundation/CoreMedia media; no device or TCC prompt. |
| Native helper build | Pass: arm64 and x86_64 staged, macOS 14 target, embedded plist | Cross-build is not Intel runtime or signing evidence. |
| Helper CLI smoke | Pass | Self-test, duplicate request replay, synthetic inspection and EOF finalization. |
| Full JavaScript/TypeScript tests | Pass: 145 files, 1,208 tests; one explicit opt-in native suite skipped | The skipped native integration test was run separately and passed. |
| Opt-in native finalization integration | Pass: one test | Synthetic raw video/PCM → native inspector → production finalizer/FFmpeg → manifest reopen → verifier. |
| TypeScript, localization, full lint and formatting checks | Pass on the reviewed source | No hardware or interactive UI claim. |
| Synthetic media matrix | Pass: 7 positive variants; expected rejection: 5 negative variants | Physical-device evidence is explicitly false in reports. |
| Development macOS package build | Pass for both architecture artifacts: DMG and ZIP, Apple Development signed; notarization skipped | Preceded final review edits; distribution artifacts require a fresh release build. Does not satisfy G4. |
| Final-source host bundle | Pass: normal build pipeline with `--dir --arm64 --publish never`, automatic identity discovery disabled | Refreshed arm64 app has an ad-hoc signature. No release was published; not an installed distribution test. |
| Packaged binary smoke | Pass after final-source bundle refresh, including both helper slices | An x64 `otool` byte-format mismatch was fixed with a regression test; this does not validate notarization or device permission identity. |

The positive synthetic variants are portrait, landscape, odd dimension, delayed microphone, negative offset, internal gap represented as encoded silence, and silent/static. Negative cases verify rejection of wrong rotation, 250 ms displaced audio, missing audio, a two-second truncation and a byte-truncated MOV. Video preservation is compared by hashing demuxed compressed packet payloads rather than whole MOV containers.

The native suite also proves a synthetic 300-second static baseline passthrough and raw single-frame timeline. This is container timing evidence, not a physical five-minute phone test. `observedFrameRate` remains `null`; no estimator or frame-rate guarantee is claimed.

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

G1 API/permissions, G2 physical media fidelity, G3 physical long-duration audio and G4 reliability/distribution are all **Not tested**. Do not enable the packaged feature, advertise iPhone/iPad or Intel support, or add a README product claim from the software results above. Physical results belong in [the acceptance matrix](ios-usb-capture-matrix.md), with exact build, OS, generic device family, cable/setup and artifact location.
