# Recordly USB iPhone / iPad Capture Implementation Plan

> **For agentic workers:** Execute this plan task-by-task using the installed `superpowers:subagent-driven-development` or `superpowers:executing-plans` workflow. Read the specification first. The checkboxes are implementation work to be performed, not claims of completed work. Review each task's contracts and tests before merging it.

**Goal:** Add reliable, native USB device-screen recording to Recordly on macOS, including device audio, optional Mac narration, recovery and existing-editor integration.

**Architecture:** A dedicated Swift capture helper writes native media; Electron owns its lifecycle, an exclusive recording lease, validated IPC, finalisation and persistence. React presents source selection, compressed previews and authoritative recording state. Existing desktop backends and the editor remain in place.

**Tech stack:** The repository's existing Electron/React/TypeScript/Vite/Vitest/Biome stack; Swift, AVFoundation, CoreMediaIO, CoreMedia and VideoToolbox; the existing bundled FFmpeg resolver. No new server, driver, browser-recording dependency or required third-party Swift package.

**Spec:** `01-feature-spec.md`, version 1.0, 8 September 2026. Suggested repository location: `docs/superpowers/specs/2026-09-08-ios-usb-capture.md`. Suggested repository location for this plan: `docs/superpowers/plans/2026-09-08-ios-usb-capture.md`.

**Baseline:** `4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1` (`v1.4.0` release commit). All existing paths named below were surfaced through repository inspection or are directly identified existing integration paths. Paths marked **Create** are proposed. Do not assume they already exist. Line numbers are intentionally not used because the implementation spans multiple commits; function and type names are the edit anchors.

## Global constraints

macOS 14 is the existing native deployment floor. Build for `darwin-arm64` and `darwin-x64`; advertise only physically validated combinations. iPhone and iPad share the backend; iPad advertising requires its tests.

The source discriminator is exactly `ios-device`. Use device-screen media, not QuickTime/iPhone Mirroring windows or a Continuity Camera lens feed. Do not fall back to Mac desktop recording when this source fails.

No pause/resume, webcam recording, touch telemetry, wireless transport, remote device control, HDR promise or multi-device take in v1. Device audio and optional native Mac narration are in scope. Do not use browser microphone timestamps for the native recording timeline.

Full-resolution capture stays native. Preview is capped at 480 pixels on its longest edge, 5 frames/second and 128 KiB per JPEG. Record control uses version-1 NDJSON; preview uses the separate RLIP pipe described in the spec.

Complete means media validated, finalisation committed and editor handoff performed once—not merely “helper exited” or “file exists.” Do not delete recoverable source files after an error. Do not report native-quality, frame-rate or recovery guarantees unsupported by evidence.

All TDD steps must first fail for the intended missing behaviour, then pass. Fixtures and fake helpers test orchestration without a phone; real hardware gates test platform behaviour. Mocks cannot satisfy those gates.

## 1. File map and ownership

### New shared contracts

- **Create** `src/shared/iosCapture.ts`: portable types, runtime validators, capability constants, protocol names and type guards. No Node, Electron or DOM imports.
- **Create** `src/shared/iosCapture.test.ts`: source discrimination, runtime parsing, time-value validation and capability tests.

### Native package

**Create** `electron/native/ios-device-capture/Package.swift`, a macOS-14 package with library target `IOSCaptureCore`, executable target `IOSDeviceCaptureHelper` producing `recordly-ios-device-helper`, and test target `IOSCaptureCoreTests`.

**Create** the following under `electron/native/ios-device-capture/`:

```
Resources/Info.plist
Sources/IOSDeviceCaptureHelper/main.swift
Sources/IOSCaptureCore/Protocol.swift
Sources/IOSCaptureCore/DeviceClassifier.swift
Sources/IOSCaptureCore/DeviceDiscovery.swift
Sources/IOSCaptureCore/CaptureEngine.swift
Sources/IOSCaptureCore/CaptureClock.swift
Sources/IOSCaptureCore/VideoWriter.swift
Sources/IOSCaptureCore/AudioWriter.swift
Sources/IOSCaptureCore/PreviewEncoder.swift
Sources/IOSCaptureCore/MediaInspector.swift
Sources/IOSCaptureCore/NativeTimingStore.swift
Tests/IOSCaptureCoreTests/ProtocolTests.swift
Tests/IOSCaptureCoreTests/DeviceClassifierTests.swift
Tests/IOSCaptureCoreTests/CaptureClockTests.swift
Tests/IOSCaptureCoreTests/VideoWriterTests.swift
Tests/IOSCaptureCoreTests/AudioWriterTests.swift
Tests/IOSCaptureCoreTests/PreviewEncoderTests.swift
Tests/IOSCaptureCoreTests/MediaInspectorTests.swift
Tests/IOSCaptureCoreTests/CaptureEngineTests.swift
```

A fixture generator belongs under **Create** `scripts/fixtures/ios-capture/`; synthetic media must have known timing, geometry and colour. Do not check personal recordings into the repository.

### Electron backend

**Create**:

```
electron/ipc/recording/ios/protocol.ts
electron/ipc/recording/ios/helperProcess.ts
electron/ipc/recording/ios/preview.ts
electron/ipc/recording/ios/controller.ts
electron/ipc/recording/ios/permissions.ts
electron/ipc/recording/ios/featurePolicy.ts
electron/ipc/recording/ios/storage.ts
electron/ipc/recording/ios/finalize.ts
electron/ipc/recording/ios/recovery.ts
electron/ipc/recording/recordingLease.ts
electron/ipc/register/iosCapture.ts
```

Create adjacent `.test.ts` files for every pure or orchestration module above, and fake-process fixtures under `electron/ipc/recording/ios/__fixtures__/`. The fake helper is a small Node program used only by tests, never shipped as the native backend.

**Modify** existing `electron/ipc/handlers.ts`, `electron/ipc/types.ts`, `electron/ipc/state.ts`, `electron/ipc/paths/binaries.ts`, `electron/ipc/register/sources.ts`, `electron/ipc/register/recording.ts`, `electron/ipc/register/project.ts`, `electron/ipc/project/session.ts`, `electron/preload.ts`, `electron/electron-env.d.ts` and `electron/main.ts` only at their registration, type, lifecycle and handoff boundaries. Add/update adjacent tests as appropriate. Do not transplant the new implementation into the large existing `recording.ts`.

### Renderer and persistence

**Create** `src/hooks/useIOSDeviceRecorder.ts` and its `.test.ts`, `src/components/launch/ios/IOSDevicePanel.tsx`, `src/components/launch/ios/IOSCaptureStatus.tsx`, and `src/lib/iosCapturePresentation.ts` with its `.test.ts`.

**Modify** existing `src/hooks/useScreenRecorder.ts` and `useScreenRecorder.test.ts`; `src/components/launch/SourceSelector.tsx`, `LaunchWindow.tsx`, `HudWindow.tsx`, `popovers/SourcePopover.tsx`, `popovers/launchPopoverTypes.ts`; `src/components/video-editor/projectPersistence.ts` and its tests; `project/useInitialEditorSource.ts`, `project/useProjectSaveActions.ts`, `state/useEditorUiState.ts`; and relevant `src/i18n/locales/*/launch.json` entries following the existing locale policy.

### Build, verification and documentation

**Create** `scripts/build-ios-device-helper.mjs`, `scripts/test-ios-device-helper.mjs`, `scripts/verify-ios-capture-fixture.mjs`, `docs/ios-usb-capture.md`, `docs/testing/ios-usb-capture-matrix.md`, `docs/testing/ios-usb-capture-feasibility.md` and `.github/workflows/ios-capture.yml`.

**Modify** existing `scripts/build-native-helpers.mjs`, `scripts/smoke-packaged-binaries.mjs`, `scripts/verify-macos-distribution.mjs`, `electron-builder.json5`, `build/entitlements.mac.plist`, `build/entitlements.mac.inherit.plist` and `package.json`. Do not broaden hardened-runtime entitlements beyond what testing establishes is necessary.

## 2. Fixed interfaces

Implement these names once in Task 03 and use them consistently. Add fields only through an explicit contract change and test, not local aliases that silently diverge.

```ts
export type IOSSessionId = string;
export type IOSDeviceToken = string;
export type IOSCaptureMode = 'passthrough' | 'h264-encode';
export type AudioAvailability = 'unknown' | 'available' | 'unavailable';
export interface NativeTime { value: string; timescale: number }
export interface IOSRecordingOptions {
  deviceAudio: boolean;
  microphoneToken: IOSDeviceToken | null;
}
export interface IOSVideoFormat {
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  codec: string;
  colorPrimaries: string | null;
  transferFunction: string | null;
  ycbcrMatrix: string | null;
  fullRange: boolean | null;
  transform: readonly [number, number, number, number, number, number];
  observedFrameRate: number | null;
  fingerprint: string;
}
export interface IOSDeviceSource {
  sourceType: 'ios-device';
  id: string; // validated ios-device:<opaque-token>
  deviceToken: IOSDeviceToken;
  displayName: string;
  generation: number;
  deviceAudio: AudioAvailability;
}
export interface IOSMicrophoneOption {
  token: IOSDeviceToken;
  label: string;
}
export type CaptureSource<TDesktop> = TDesktop | IOSDeviceSource;
export type IOSCapturePhase =
  | 'unavailable' | 'idle' | 'discovering' | 'preparing' | 'ready'
  | 'starting' | 'recording' | 'stopping' | 'finalising'
  | 'completed' | 'cancelled' | 'failed' | 'interrupted' | 'recoveryAvailable';
export interface IOSCaptureFailure {
  code: string; // runtime validation restricts to the spec's error-code union
  recoverable: boolean;
}
export interface IOSCaptureSnapshot {
  sequence: number;
  generation: number;
  sessionId: IOSSessionId | null;
  phase: IOSCapturePhase;
  devices: readonly IOSDeviceSource[];
  microphones: readonly IOSMicrophoneOption[];
  source: IOSDeviceSource | null;
  options: IOSRecordingOptions | null;
  format: IOSVideoFormat | null;
  mode: IOSCaptureMode | null;
  elapsedMs: number;
  acceptedVideoSamples: number;
  warningCodes: readonly string[];
  error: IOSCaptureFailure | null;
}
export interface CaptureMetadata {
  version: 1;
  sourceKind: 'ios-device';
  mode: IOSCaptureMode;
  format: IOSVideoFormat;
  deviceAudioRecorded: boolean;
  narrationRecorded: boolean;
  stopReason: string;
  interrupted: boolean;
}
export interface CommittedIOSRecording {
  sessionId: IOSSessionId;
  videoPath: string;
  hideOverlayCursorByDefault: true;
  captureMetadata: CaptureMetadata;
}
```

Device-source `generation` is the inventory revision used to validate selection. Snapshot/preview `generation` is the active preparation generation, incremented on every new preparation and helper restart; these are distinct counters despite sharing the property name in separate payload types. A changed inventory revision never invalidates accepted recording media from an already prepared source. Route preview frames only for the active preparation generation. Opaque tokens are nonempty, bounded to 128 characters, and restricted to an agreed ASCII token alphabet. Session IDs are UUIDs allocated by main. Time scales must be positive integers in a bounded supported range, and tick strings must parse as signed 64-bit integers. A valid scalar field is not enough to establish that a renderer may use the referenced device/session.

The helper's `NativeCaptureResult` consists of `sessionId`, `stopReason`, `format`, `mode`, `video: NativeMediaArtifact`, optional `deviceAudio`/`microphone` artifacts, and `timingFile: "native-timing.json"`. `NativeMediaArtifact` has `relativeName`, `mediaKind: "video" | "device-audio" | "microphone"`, `firstHostTime: NativeTime`, `duration: NativeTime`, `sampleCount` and its actual media-format metadata. No arbitrary absolute file paths originate in the renderer.

Expose an `IOSCaptureController` with:

```ts
getSnapshot(): IOSCaptureSnapshot;
discover(): Promise<IOSCaptureSnapshot>;
prepare(input: {
  deviceToken: IOSDeviceToken;
  generation: number;
  options: IOSRecordingOptions;
}): Promise<IOSCaptureSnapshot>;
start(sessionId: IOSSessionId): Promise<IOSCaptureSnapshot>;
stop(sessionId: IOSSessionId): Promise<CommittedIOSRecording>;
cancel(sessionId: IOSSessionId, discardAcceptedMedia: boolean): Promise<void>;
release(sessionId: IOSSessionId): Promise<void>;
subscribe(listener: (state: IOSCaptureSnapshot) => void): () => void;
shutdown(): Promise<void>;
```

Countdown is a UI substate of Ready, not an additional native/controller phase. Use the existing launcher countdown mechanism; it must not create media or duplicate main's recorder state. `start` resolves at `recordingStarted`, not the command's accepted response. `stop` resolves after commit. Automatic interruption uses the same memoised stop/finalisation path and publishes a retained `CommittedIOSRecording` through a typed controller completion callback; this prevents the result from depending on a surviving renderer promise. `cancel(..., true)` is used only after explicit discard confirmation. Completion delivery is consumed exactly once by the main-process editor-handoff callback.

## 3. Task sequence

### Task 01 — Establish the baseline and test evidence format

**Files:** Create `docs/testing/ios-usb-capture-matrix.md` and `docs/testing/ios-usb-capture-feasibility.md`; use the existing package scripts unchanged.

**Consumes:** pinned baseline and specification. **Produces:** baseline test/build results, reproducible device-matrix template and an isolated execution branch.

- [ ] Check the current worktree before modifying it. Use a dedicated branch/worktree through the installed worktree workflow; do not reset a dirty checkout. Fetch and compare the inspected commit to the intended implementation base.

```bash
git status --short
git rev-parse HEAD
git show --no-patch --format='%H %s' 4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1
npm ci
npm test
npx tsc --noEmit
npm run lint
npm run i18n:check
```

- [ ] Record existing failures separately from regressions. Do not “fix” unrelated export, captions or dependency issues to make this feature's PR look clean.
- [ ] On macOS record `sw_vers`, `uname -m`, `xcodebuild -version`, `swift --version`, app signing identity category, device family, iOS/iPadOS version and cable/hub. Do not record serials or personal device names.
- [ ] Create evidence rows with test ID, exact command/actions, expected result, observed result, artifact location and pass/fail. Initialise them as **Not run**, not Pass.
- [ ] Commit only the templates and baseline findings: `docs: establish ios capture baseline and hardware test matrix`.

**Review gate:** An executor can distinguish baseline failure, new test failure and hardware not tested. No feature code yet.

### Task 02 — Prove the native path and signed-app permissions before UI work

**Files:** Create an explicitly disposable local probe under `scripts/spikes/ios-usb-capture/` for the feasibility experiment; record results in `docs/testing/ios-usb-capture-feasibility.md`. The probe is not a shipped helper or a replacement for the tested implementation in later tasks.

**Consumes:** Apple APIs and target hardware. **Produces:** gates G1/G2 findings and fixtures defining actual screen-device identity, format, colour, clock and sample-delivery behaviour.

- [ ] Build a minimal Swift probe that enables the CoreMediaIO property, prints sanitised discovery attributes, selects only an eligible screen candidate, and receives video plus optional device audio. The opt-in must check its return status:

```swift
var address = CMIOObjectPropertyAddress(
    mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
    mScope: kCMIOObjectPropertyScopeGlobal,
    mElement: kCMIOObjectPropertyElementMain
)
var enabled: UInt32 = 1
let status = CMIOObjectSetPropertyData(
    CMIOObjectID(kCMIOObjectSystemObject), &address,
    0, nil, UInt32(MemoryLayout<UInt32>.size), &enabled
)
guard status == noErr else { throw ProbeError.cmio(status) }
```

Declare `ProbeError.cmio(OSStatus)` in the disposable probe; do not hide a failed property set. Check the SDK's public element constant spelling and use its supported equivalent when targeting an older SDK.

- [ ] Capture a short moving-UI take using `videoSettings = [:]`; record whether samples contain compressed H.264 or pixel buffers. Capture the same fixture with an explicitly uncompressed request and compare. Inspect media descriptions, sync-sample flags, clock availability and audio-delivery timing.
- [ ] Exercise a five-minute static/dark screen, rotation in both directions, unplug, and a quiet phone that later starts playing audio. Record what is directly observable and what cannot be diagnosed.
- [ ] Package the probe inside a signed Recordly development distribution with the intended helper privacy metadata and entitlements. Test on a clean privacy state: Camera deny/allow, audio deny/allow and relaunch. Test from the installed app, not only Terminal. Do not instruct users to open QuickTime to initialise capture.
- [ ] Measure QuickTime/native source/editor-export colour and geometry on a deliberately non-personal test screen. Include compressed passthrough beginning at a keyframe and a sparse-stream duration test.
- [ ] Write exact findings and a candidate classifier fixture. The expected result is an eligible iOS screen source that works through public APIs and ordinary permissions, with a known supported recording path. If it fails, mark that combination unsupported and do not proceed with a false universal support claim.
- [ ] Remove the disposable probe from production packaging; commit sanitised evidence/fixtures: `test: document ios usb capture feasibility gates`.

**Review gate:** G1 passes on at least the primary development combination, and G2 has a demonstrated supported path. This task is not satisfied by a README claiming the APIs work.

### Task 03 — Lock source, capability, protocol and metadata contracts

**Files:** Create `src/shared/iosCapture.ts` and `.test.ts`; modify `electron/ipc/types.ts` and `electron/electron-env.d.ts` to introduce `CaptureSource<ExistingDesktopType>` at selection boundaries without making all desktop APIs accept phones.

**Consumes:** Task 02 findings. **Produces:** the fixed interfaces in section 2 plus `isIOSDeviceSource`, `parseIOSCaptureCommand`, `parseIOSCaptureEvent`, `validateNativeTime` and `IOS_CAPTURE_CAPABILITIES`.

- [ ] Write a failing discrimination test. It must distinguish a mobile source from both a legacy desktop source without `sourceType` and a malformed mobile object.

```ts
it('does not mistake an ios source for a desktop source', () => {
  expect(isIOSDeviceSource({
    sourceType: 'ios-device', id: 'ios-device:device_a',
    deviceToken: 'device_a', displayName: 'Phone', generation: 1,
    deviceAudio: 'unknown',
  })).toBe(true);
  expect(isIOSDeviceSource({ id: 'screen:1', name: 'Screen' })).toBe(false);
  expect(isIOSDeviceSource({ sourceType: 'ios-device', id: 'screen:1' })).toBe(false);
});
```

- [ ] Add failing tests for unknown protocol versions/commands, negative or noninteger generations, oversized strings, invalid rational time, stale session structure and unknown metadata fields. Unknown optional metadata may be dropped; executable-like fields must never gain meaning.
- [ ] Run `npx vitest run src/shared/iosCapture.test.ts`; confirm failures are due to missing validation.
- [ ] Implement portable types and explicit runtime validators using existing dependencies. Do not introduce a schema library solely for this feature. Define the complete error-code literal union from spec section 9, rather than leaving arbitrary strings at runtime.
- [ ] Run the targeted tests and `npx tsc --noEmit`. Expected: legacy desktop shapes still compile; mobile sources cannot enter desktop-only functions without deliberate narrowing.
- [ ] Commit: `feat: define ios capture contracts and source capabilities`.

### Task 04 — Build the native package and deterministic control loop

**Files:** Create the package, `Protocol.swift`, `main.swift`, `Resources/Info.plist`, `ProtocolTests.swift`, `scripts/build-ios-device-helper.mjs`, `scripts/test-ios-device-helper.mjs`; modify `scripts/build-native-helpers.mjs`, `electron/ipc/paths/binaries.ts` and package scripts.

**Consumes:** shared wire schema. **Produces:** `recordly-ios-device-helper`, `--self-test`, and development/packaged path resolution through `getIOSDeviceCaptureHelperBinaryPath` and `ensureIOSDeviceCaptureHelperBinary`.

- [ ] Write failing native parser tests for a valid `hello`, split lines, invalid UTF-8, a 65-KiB line, unknown version, duplicate request ID and stdin EOF. `hello` and `--self-test` must never touch camera discovery.
- [ ] Run `swift test --package-path electron/native/ios-device-capture --filter ProtocolTests`; verify the intended failures.
- [ ] Implement the CLI protocol loop with bounded input, explicit flush after output, stdout reserved for JSON, redacted stderr, and typed acceptance/error/completion events. Define `ProtocolCommand` and `ProtocolEvent` as Codable equivalents of Task 03. Keep unknown-command rejection independent of capture state.
- [ ] Add the build script: compile the Swift package in release mode separately for arm64 and x86_64 using the macOS-14 deployment target and selected Xcode SDK; pass linker options to embed the helper Info.plist; stage each product into the matching `electron/native/bin/<arch>/` directory. Verify each output's architecture and deployment target rather than trusting a directory name.
- [ ] Add `test:ios-native` to invoke the new test runner. On non-macOS it prints a clear skipped-native-tests result; the macOS workflow must assert its platform so an accidental skip cannot pass that job.
- [ ] Resolve packaged binaries before source compilation. Packaged missing-helper tests must fail with `HELPER_UNAVAILABLE`, not invoke `swiftc` or SwiftPM. Development builds may compile on demand through the explicit build script.

```bash
npm run build:native-helpers
npm run test:ios-native
./electron/native/bin/darwin-arm64/recordly-ios-device-helper --self-test
```

Run the final command only on its matching architecture (or use the x64 path on an Intel test machine). Expected: self-test exits zero without permissions; both architecture products are present after a cross-target build.

- [ ] Commit: `feat: add packaged ios capture helper and protocol loop`.

### Task 05 — Implement discovery, stable identities and native permissions

**Files:** Create `DeviceClassifier.swift`, `DeviceDiscovery.swift`, `DeviceClassifierTests.swift`, `electron/ipc/recording/ios/permissions.ts` and `.test.ts`; modify `CaptureEngine.swift` as it is introduced to own prepared device inputs.

**Consumes:** Task 02 identity fixtures and Task 04 protocol. **Produces:** `DeviceInventorySnapshot`, session-stable opaque tokens, and `prepare` completion only when a selected eligible screen produces valid media.

- [ ] Write native classifier tests for the verified muxed `iOS Device` signature, ordinary external webcam, lens-only Continuity Camera, duplicate names, changed native identifier and unrelated sole-camera fallback. Use a `DeviceFacts` struct with model ID, category and advertised media types, not hardware objects, so the rules are independently testable.
- [ ] Write permission-policy tests: desktop source does not invoke this path; denied camera maps to `PERMISSION_DENIED`; audio-off does not request unnecessary audio access; denial is not automatically re-prompted.
- [ ] Implement positive classifier matching, token-to-native-ID mapping, connect/disconnect invalidation and bounded inventory reconciliation. Do not log raw native identifiers or match selected devices by label.
- [ ] Implement `DeviceDiscovery.start()`, `snapshot()` and `stop()` with the CoreMediaIO opt-in, notification handling, 250-ms coalescing, optional 2-second reconciliation and observer cleanup.
- [ ] Implement native microphone enumeration separately. Exclude the selected device audio source; return opaque tokens rather than browser IDs. Prove two same-label microphones can be selected unambiguously.
- [ ] Exercise a signed installed build: selecting a device prompts correctly, selecting/deselecting 20 times does not leak sessions, and changing the picker does not affect an active take.

```bash
swift test --package-path electron/native/ios-device-capture --filter DeviceClassifierTests
npx vitest run electron/ipc/recording/ios/permissions.test.ts
```

- [ ] Commit: `feat: discover trusted ios screen sources and native microphones`.

### Task 06 — Implement the native video writer and preparation policy

**Files:** Create/complete `CaptureEngine.swift`, `VideoWriter.swift`, `MediaInspector.swift`, `VideoWriterTests.swift`, `MediaInspectorTests.swift`, `CaptureEngineTests.swift`; create deterministic fixture-generation recipes under `scripts/fixtures/ios-capture/`.

**Consumes:** selected native device, observed sample format and recording boundary. **Produces:** `source-video.mov`, `IOSVideoFormat`, `IOSCaptureMode`, validated native media inspection and writer completion records.

- [ ] Write writer tests that reject recording before preparation, wait for a post-boundary sync sample, preserve B-frame decode/presentation relationships, reject an incompatible format before appending it, and never label a zero-frame result complete.
- [ ] Write tests for source geometry/clean aperture, odd dimensions, native/uncompressed mode selection, bounded buffers, append failure, sparse/static duration, terminal tail timing and stop during start.
- [ ] Implement format selection explicitly:

```swift
// Policy, not a hardware-model inference:
// compatible compressed H.264 + tested SDR metadata -> passthrough
// supported uncompressed SDR input -> native H.264 encode
// everything else -> unsupported format before the take begins
```

The implementation must inspect `CMFormatDescription` and sample payload kind. `videoSettings = [:]` is the native-sample request; a nil writer output-settings dictionary is used only after a compatible passthrough format is established.

- [ ] Implement serial session configuration, writer/sample queues, source-format fingerprints and recording boundary handling. If passthrough fails the pre-recording gates, explicitly negotiate supported uncompressed output and revalidate it before choosing H.264 encode; otherwise reject that format. Never silently change modes during a take. Preserve timestamp relationships and valid sample durations; do not demand increasing PTS for B-frame decode order. Stop safely if compressed continuity is lost.
- [ ] Configure `.mov` fragments with initial 1 second / subsequent 10 seconds; test truncated files after different boundaries. Implement encode mode with validated H.264 settings and the spec's initial bitrate formula; pad rather than crop an odd coded size.
- [ ] Implement `MediaInspector.inspect(url:)` using AVURLAsset/track loading and a first decodable-frame check. Expose `inspectMedia` without starting capture or requesting TCC. Inspect geometry, transform, duration, codecs and audio tracks. Do not make packaged operation depend on a Darwin `ffprobe-static` binary.
- [ ] Run all native writer/inspection tests and the physical moving/static fixture. Compare compressed payloads and decoded frames for passthrough fixtures; expected: no additional encode through normal finalisation, no damaged first frames, correct duration. Record colour comparisons rather than declaring H.264 inherently colour-correct.
- [ ] Commit: `feat: record ios video with passthrough and validated h264 encoding`.

### Task 07 — Implement common-clock audio and durable timing metadata

**Files:** Create/complete `CaptureClock.swift`, `AudioWriter.swift`, `NativeTimingStore.swift`, `CaptureClockTests.swift`, `AudioWriterTests.swift`; extend `CaptureEngine.swift` and native protocol result encoding.

**Consumes:** video T0, capture-session clocks and selected native audio sources. **Produces:** `device-audio.mov`, `microphone.mov`, `native-timing.json`, per-stream offsets and internal timing/gap metadata.

- [ ] Write clock tests for a phone stream beginning at host time 100 s and a microphone beginning at 100.25 s: expected narration offset is +250 ms, not zero. Test a -120 ms pre-video start, different time scales, invalid clocks, drift, and a sample-time discontinuity.

```swift
func testDelayedMicrophoneRetainsItsOffset() throws {
    let videoStart = CMTime(value: 100_000, timescale: 1_000)
    let microphoneStart = CMTime(value: 100_250, timescale: 1_000)
    let result = CaptureClock.offset(firstHostTime: microphoneStart,
                                     videoStartHostTime: videoStart)
    XCTAssertEqual(CMTimeGetSeconds(result), 0.25, accuracy: 0.000_001)
}
```

Define `CaptureClock.offset(firstHostTime:videoStartHostTime:) -> CMTime`; clock-domain conversion is performed before calling it. Tests with equal fake clocks do not prove real mapping.

- [ ] Implement a deployment-compatible synchronisation-clock adapter and rational native time serialization. Convert to a common host clock, preserve rates/anchors and reject unavailable mappings. Never substitute IPC arrival timestamps.
- [ ] Implement independent audio-only PCM MOV writers. Start each when actual samples arrive, retain its video-relative offset, and represent internal gaps explicitly rather than flattening them. Preserve negative offsets for trim at finalisation. Capture the selected Mac microphone natively.
- [ ] Write `native-timing.json` atomically at first stream samples, timebase/format/gap changes, periodic checkpoints and finalisation. Keep this helper-owned file separate from main's journal. Make stdin EOF finish media and this file even if stdout has already broken.
- [ ] Add tests for no audio samples, valid silence, later-starting device audio, microphone removal, duplicate audio endpoints and partial sidecar recovery. A missing optional audio file must not invalidate a valid video.
- [ ] Run native tests plus the 30-minute physical flash/click test with phone audio, narration and both. Measure alignment at both ends; expected absolute error ≤80 ms. A failed clock/audio combination remains unshipped until corrected.
- [ ] Commit: `feat: align native ios audio and persist recovery timing`.

### Task 08 — Implement disposable low-bandwidth previews

**Files:** Create `PreviewEncoder.swift`, `PreviewEncoderTests.swift`, `electron/ipc/recording/ios/preview.ts`, `.test.ts`; extend native command handling for `setPreviewEnabled`.

**Consumes:** native video samples and current prepared generation. **Produces:** bounded RLIP JPEG frames independent of recording writes.

- [ ] Write tests for the 24-byte big-endian header, split headers/payloads, invalid magic/version, oversized JPEG, stale generation, and two frames arriving while the consumer remains blocked. Expected retained queue length: one latest preview.
- [ ] Implement `PreviewFrameDecoder.push(chunk: Uint8Array)` returning zero or more validated `{generation, sequence, jpeg}` records, with an internal bounded partial-record buffer. Export the type and parser from `preview.ts`.
- [ ] Implement native preview decode/resize/JPEG conversion on its own queue. Use source format and orientation; cap longest edge 480, frequency 5 Hz and JPEG payload 128 KiB. Failed/slow preview conversion must drop work rather than back up the writer.
- [ ] Implement fd-3 asynchronous/non-blocking delivery. Closing the pipe or withholding reads cannot block capture. Stop conversion while preview is hidden.
- [ ] Run parser/native tests and record with the preview consumer deliberately stalled. Expected: media counters continue, writer queues remain bounded, no extra capture session is opened.

```bash
npx vitest run electron/ipc/recording/ios/preview.test.ts
swift test --package-path electron/native/ios-device-capture --filter PreviewEncoderTests
```

- [ ] Commit: `feat: stream bounded ios source previews outside capture control`.

### Task 09 — Implement the main-process helper client and controller

**Files:** Create `electron/ipc/recording/ios/protocol.ts`, `helperProcess.ts`, `controller.ts`, adjacent tests and `__fixtures__/fake-ios-helper.mjs`.

**Consumes:** Tasks 03–08 wire contracts and bundled binary resolver. **Produces:** the `IOSCaptureController` interface from section 2, process lifecycle guarantees and authoritative snapshots.

- [ ] Write failing fake-helper tests: delayed hello; command accepted but no recordingStarted event; malformed output; partial UTF-8/JSON chunks; stderr flood; helper crash; duplicate Stop; stale session event; unexpected EOF; and native-finalised event after renderer cancellation.

```ts
it('does not mark recording on command acceptance alone', async () => {
  const harness = await createIOSControllerHarness({ start: 'accept-only' });
  await harness.prepareReadySource();
  const pending = harness.controller.start(harness.sessionId);
  await harness.flushProtocol();
  expect(harness.controller.getSnapshot().phase).toBe('starting');
  harness.emitRecordingStarted();
  await pending;
  expect(harness.controller.getSnapshot().phase).toBe('recording');
});
```

`createIOSControllerHarness` is a test utility created in this task, exposing a deterministic fake clock, fake helper transport, injected storage/finaliser and the methods shown. Never export it in production bundles.

- [ ] Implement `spawn` with exact executable path, argument arrays, `shell: false`, continuous stdout/stderr drains and fd-3 preview drain. Put process parsing in the client, not in React or a giant IPC handler.
- [ ] Implement bounded pending requests, version handshake, idempotent command cache and ordered session-scoped events. Start resolves on accepted media, Stop resolves on committed media via injected finalisation.
- [ ] Implement a single controller transition function. Reject invalid phase operations, cancel pending timeouts and use a memoised finalisation promise per session so Stop/disconnect/quit cannot race into multiple writers or editor opens.
- [ ] Inject storage, permission, helper and finaliser interfaces for tests. Production binds them explicitly; do not hide dependencies behind mutable module globals.
- [ ] Run `npx vitest run electron/ipc/recording/ios/controller.test.ts electron/ipc/recording/ios/helperProcess.test.ts electron/ipc/recording/ios/protocol.test.ts`. Expected: no unresolved promises, open handles or duplicate terminal notifications after each fault.
- [ ] Commit: `feat: orchestrate ios capture from the electron main process`.

### Task 10 — Implement storage, audio assembly and the commit boundary

**Files:** Create `electron/ipc/recording/ios/storage.ts`, `finalize.ts` and their tests. Extend `controller.ts` to bind the production implementations. Use the existing `electron/ipc/ffmpeg/binary.ts` resolver rather than adding a second FFmpeg lookup policy.

**Consumes:** `NativeCaptureResult`, the helper-owned timing file, source media and an approved recordings root. **Produces:** a validated `CommittedIOSRecording`, or an incomplete journal retaining recoverable media.

Define these module contracts:

```ts
export interface IOSSessionStorage {
  sessionId: IOSSessionId;
  directory: string;
  journalPath: string;
}
export async function allocateIOSSessionStorage(
  recordingsRoot: string, sessionId: IOSSessionId
): Promise<IOSSessionStorage>;
export async function finalizeIOSRecording(input: {
  storage: IOSSessionStorage;
  nativeResult: NativeCaptureResult;
}): Promise<CommittedIOSRecording>;
export function buildAudioAlignment(offsetMs: number): {
  trimStartMs: number;
  delayMs: number;
};
```

`offsetMs` here is a bounded duration computed by subtracting rational common-clock values, not a raw 64-bit host-clock value converted to an imprecise JavaScript number. Keep all native clock arithmetic rational until that subtraction is complete.

- [ ] Write failing tests for writable-root validation, UUID directory creation, pre-existing directory collision, path traversal, symlink escape, low disk space, journal atomic replacement and no overwrite of a committed source. Test capacity for a second video-sized output when mixing audio; video-only commit must not unnecessarily require that duplicate.
- [ ] Write alignment tests before constructing FFmpeg arguments:

```ts
it('preserves delayed narration and trims pre-video audio', () => {
  expect(buildAudioAlignment(250)).toEqual({ trimStartMs: 0, delayMs: 250 });
  expect(buildAudioAlignment(-120)).toEqual({ trimStartMs: 120, delayMs: 0 });
});
```

- [ ] Implement fixed session-relative filenames and atomic journal updates. Periodically check available bytes with the supported Node filesystem API or a narrowly scoped native query; do not parse a shell-formatted `df` command. Estimate rates from observed bytes and elapsed media time. Start at ≥1 GiB free; reserve final-copy capacity plus 60 seconds of incoming data and at least 256 MiB safety space during capture.
- [ ] Implement native inspection of every candidate through `inspectMedia`. Check decodability, duration, geometry and expected tracks. Do not equate nonzero file size with validity. Inspection must not trigger camera discovery or permissions.
- [ ] Build FFmpeg arguments from validated internal data. Map the native video explicitly and use `-c:v copy`; never accidentally apply a video filter while calling the result passthrough. Audio processing trims pre-video samples, inserts positive offsets and internal gaps, maps rate corrections from recorded timing, resamples to 48 kHz and encodes the final soundtrack once. Use unity gain for one stream, 0.5 per stream with normalisation disabled for two streams. Encode AAC at the spec's mono/stereo rate.
- [ ] Set the output timeline from the validated video interval, not the shortest audio stream. Pad missing audio to that interval and trim excess audio. Do not use `-shortest` as a shortcut that truncates a valid video. Verify channel layouts and filter support against the bundled FFmpeg in the fixture tests.
- [ ] With no audio, commit the validated native video directly. With audio, write `recording.pending.mov`; inspect it; atomically rename to `recording.mov`; persist the session manifest; mark the journal committed; then emit the completion callback. If any later step fails, retain enough journal state to retry without another video encode or a duplicate editor open.
- [ ] Inject failures after native validation, during FFmpeg, after rename and before manifest commit. Expected: no corrupt file opened as complete, no source deletion, retry either resumes or detects the existing committed result. Drain FFmpeg progress/stderr continuously and use a stall watchdog; do not impose a tiny fixed processing limit on long takes.

```bash
npx vitest run electron/ipc/recording/ios/storage.test.ts electron/ipc/recording/ios/finalize.test.ts
```

- [ ] Commit: `feat: commit ios recordings with aligned audio and recoverable storage`.

### Task 11 — Bind validated IPC, source identity and recording exclusivity

**Files:** Create `electron/ipc/register/iosCapture.ts`, `electron/ipc/recording/recordingLease.ts`, `electron/ipc/recording/ios/featurePolicy.ts` and adjacent tests. Modify `electron/ipc/handlers.ts`, `electron/ipc/types.ts`, `electron/ipc/state.ts`, `electron/ipc/register/sources.ts`, `electron/ipc/register/recording.ts`, `electron/preload.ts`, `electron/electron-env.d.ts` and the desktop-browser start/stop boundary in `electron/main.ts` where applicable.

**Consumes:** the controller interface, shared source contracts, existing desktop recording entry points. **Produces:** `window.electronAPI.iosCapture`, explicit device-source dispatch and one recording owner across all backends.

The build policy is `IOS_CAPTURE_ENABLED_BY_DEFAULT = false` until Task 18's release gate. A development-only `RECORDLY_ENABLE_IOS_CAPTURE=1` override is evaluated by main, never trusted from renderer local storage. Expose the resulting boolean in a main-owned capability response. Keep recovery/import code available independently of whether new capture is enabled.

Define a small exclusive lease:

```ts
export interface RecordingLease {
  owner: 'desktop' | 'ios-device';
  token: string;
}
export function acquireRecordingLease(owner: RecordingLease['owner']): RecordingLease;
export function releaseRecordingLease(lease: RecordingLease): void;
export function getRecordingLease(): RecordingLease | null;
```

An unsuccessful acquisition throws the typed `RECORDING_BUSY` error. Releasing an already released token is idempotent; a stale token cannot release another owner's lease. Desktop retains the lease from recording start through finalisation; iOS reserves it when preparation opens its capture inputs and releases it on deselection, cancellation, failure or committed completion.

- [ ] Write failing lease tests for competing desktop/mobile starts, duplicate release and stale release after a new owner acquires. Test existing browser, ScreenCaptureKit and Windows start entry points, not just the new helper.
- [ ] Write IPC tests for a renderer-supplied path, unknown device token, stale generation, unknown session, oversized payload, untrusted sender and attempted FFmpeg filter injection. Expected: rejection before spawning a process or opening a file.

```ts
it('rejects renderer output paths', () => {
  expect(() => parseIOSCaptureCommand({
    protocolVersion: 1,
    requestId: 'r1',
    command: 'prepare',
    payload: {
      deviceToken: 'current-token', generation: 1,
      options: { deviceAudio: false, microphoneToken: null },
      outputPath: '/tmp/untrusted.mov',
    },
  })).toThrow();
});
```

This example is the renderer request shape: unknown properties must be rejected, rather than copied into a native helper request. Main adds its own approved storage capability when constructing the internal native command.

- [ ] Bind narrow preload methods for `getSnapshot`, `discover`, `prepare`, `start`, `stop`, `cancel`, `release`, state/preview subscriptions and unsubscribe. Bind the discard confirmation result to the current session. Never expose a general helper-command or filesystem-execution method to renderer code.
- [ ] Register handlers once, guard allowed application WebContents and validate session ownership in main. Native inspection and shutdown remain internal. Do not let an unrelated editor webview issue capture-control requests.
- [ ] Add the `ios-device` branch to selected-source storage, broadcast and validation. Preserve the device token and discriminator. Explicitly bypass desktop window raising/highlighting, display-bound lookups, cursor monitoring and `desktopCapturer` for this branch.
- [ ] Make the existing desktop-only `ProcessedDesktopSource` remain desktop-only where possible; introduce the shared union at selection/dispatch boundaries. Do not satisfy TypeScript by assigning the phone a fake `screen:` ID or forcing every desktop API to accept mobile sources.
- [ ] Run the IPC/lease suites plus `npx tsc --noEmit`. Expected: all desktop source branches remain exhaustive, and the disabled feature creates no helper/discovery process on launch.
- [ ] Commit: `feat: expose guarded ios capture IPC and exclusive recording ownership`.

### Task 12 — Connect recorder controls, countdown and HUD

**Files:** Create `src/hooks/useIOSDeviceRecorder.ts` and its tests. Modify `src/hooks/useScreenRecorder.ts`, `src/hooks/useScreenRecorder.test.ts`, `src/components/launch/LaunchWindow.tsx`, `HudWindow.tsx` and recorder capability wiring.

**Consumes:** namespaced preload API, controller snapshots and selected capture source. **Produces:** existing Record/Stop/Discard controls backed by the correct recorder without desktop fallthrough.

Define `useIOSDeviceRecorder()` to expose `snapshot`, `prepare(source, options)`, `startPrepared()`, `stop()`, `cancel(discardAcceptedMedia)`, `release()` and source capabilities. `prepare` takes the shared `IOSDeviceSource` and `IOSRecordingOptions`; it uses main's prepared session ID for every later operation. UI busy flags are derived from snapshots, not independent copies of native state.

- [ ] Add tests for a device source being routed before desktop permission preparation or capture acquisition. Spies for `getDisplayMedia`, `desktopCapturer`, desktop microphone fallback and cursor hooks must remain unused throughout an iOS take.
- [ ] Test the launcher's configured countdown choices, including no countdown, against a prepared session. Cancelling only the countdown returns to Ready and keeps the preview; changing source releases the prepared session, and unplugging prevents the eventual start. Countdown is renderer presentation over a prepared source; main remains Ready until start is requested. Recording state begins only after main acknowledges accepted video.
- [ ] Test stop during `starting`, double Record, double Stop, unmount/re-mount of the HUD, delayed finalisation and renderer reload. The main snapshot restores status without starting another session or opening the editor twice.

```ts
it('has no desktop fallback for a failed device source', async () => {
  const harness = createRecorderRoutingHarness({ sourceKind: 'ios-device' });
  harness.ios.prepare.mockRejectedValue(new Error('DEVICE_NOT_FOUND'));
  await harness.pressRecord();
  expect(harness.desktop.start).not.toHaveBeenCalled();
  expect(harness.desktop.preparePermissions).not.toHaveBeenCalled();
});
```

Create `createRecorderRoutingHarness` in the existing hook test suite using its mocking pattern. Its `ios` and `desktop` interfaces wrap the injected recorder actions; it must not replace real production routing with a test-only implementation.

- [ ] Implement source-aware permission preparation. Generic startup checks must not block access to the iPhone picker behind a screen-recording permission dialog. When the user returns to a desktop source, preserve that source's existing permission flow.
- [ ] Disable pause/resume and webcam for device capture at both the UI capability layer and command dispatch layer, including keyboard shortcuts and any menu/tray actions. Unsupported actions return `UNSUPPORTED_OPERATION`, not a fake paused state.
- [ ] Keep device-audio/narration preferences separate from desktop system-audio/webcam preferences. Switching sources restores prior desktop preferences without accidentally opening a phone Continuity Camera lens feed.
- [ ] Do not start browser audio-level monitoring against a microphone currently owned by the native session. Use native level/status events for mobile narration or show selection/status without a competing meter session.
- [ ] Run both recorder hook suites and TypeScript. Expected: the existing desktop flows pass unchanged and UI never shows “Recording” merely because a command was sent.
- [ ] Commit: `feat: integrate ios recording into launcher and hud controls`.

### Task 13 — Build the device picker and accessible preparation experience

**Files:** Create `src/components/launch/ios/IOSDevicePanel.tsx`, `IOSCaptureStatus.tsx`, `src/lib/iosCapturePresentation.ts` and its tests. Modify `SourceSelector.tsx`, `popovers/SourcePopover.tsx`, `popovers/launchPopoverTypes.ts`, `LaunchWindow.tsx` and locale strings.

**Consumes:** supported-platform capability, device snapshots, bounded previews and native microphone options. **Produces:** the spec's device selection, help, preview and recording-status UI within Recordly's existing design system.

`IOSDevicePanel` accepts `{snapshot, previewUrl, onSelectDevice, onOptionsChange, onRetry, onRelease}`. Device selection passes the source token and generation, not a name match. `IOSCaptureStatus` accepts `{snapshot, onStop, onCancel}`. The pure `getIOSCapturePresentation(snapshot)` function returns translation keys, status tone and enabled actions so state mapping can be tested without introducing a new React testing framework.

- [ ] Write presentation tests for unsupported, empty, permission denied, discovered, preparing, ready, starting, recording, interrupted and finalising. “Ready” requires accepted preview samples; “Connected” must not imply ready. A black preview never maps to “Phone locked.”
- [ ] Write source-mapping tests that preserve `ios-device` and its token and never reinterpret it as a screen. Change `mapRawSource` callers to dispatch mobile sources through an explicit branch; do not let its current default-to-screen behaviour consume a new source type.
- [ ] Add the macOS-only **iPhone / iPad** category without eagerly calling desktop `getSources` to reach it. Keep Screens/Windows behaviour intact. Cover both the embedded source popover and standalone source-selector window where those modes are used.
- [ ] Implement empty/help copy exactly around observable facts: connect a data-capable cable; unlock the device; approve Trust if prompted; retry discovery. Never claim the app knows the trust/lock state when it merely has no samples. Provide permission-specific Settings guidance only for an actual denied permission.
- [ ] Render native aspect without cropping; show delivered width × height and observed rate only when measured. Show recording-mode details without a complicated quality selector. Include fixed-orientation guidance before Record.
- [ ] Render device audio as supported/unknown/unavailable. Optional narration selects from helper-provided native microphones. Do not resolve microphones by a Chromium device ID or take the first matching display name.
- [ ] Convert each preview into a bounded object URL, revoke the previous URL on replacement/unmount, and unsubscribe on hiding/deselection. Send `setPreviewEnabled(false)` when hidden; do not stop the prepared capture session just because the popover closes.
- [ ] Use existing motion, typography, spacing, Radix interactions and icons. Keep status announcements in an appropriate live region; keyboard focus moves predictably after denial, disconnect or recovery. Reduce nonessential motion when requested. No always-running shimmer or large fake phone bezel.
- [ ] Add English strings and update other locales according to the repository's translation/fallback policy. Run `npm run i18n:check`; manually verify keyboard-only use, a screen reader and reduced motion. Run `npx vitest run src/lib/iosCapturePresentation.test.ts`.
- [ ] Commit: `feat: add accessible ios device source selection and preview`.

### Task 14 — Persist mobile sessions and initialise the editor correctly

**Files:** Modify `electron/ipc/types.ts`, `electron/ipc/project/session.ts`, `electron/ipc/register/project.ts`, `src/components/video-editor/projectPersistence.ts`, `project/useInitialEditorSource.ts`, `project/useProjectSaveActions.ts`, `state/useEditorUiState.ts`, and their tests. Include project snapshot/dirty-state helpers when they reconstruct `EditorProjectData`.

**Consumes:** validated `CaptureMetadata` and a committed media path. **Produces:** session-manifest v3, backwards-compatible project provenance and fresh-import mobile defaults that survive save/reopen.

- [ ] Write a failing regression test for a mobile recording with no webcam. Use the existing `persistRecordingSessionManifest` and `resolveRecordingSessionManifest` entry points:

```ts
it('keeps device metadata without a webcam', async () => {
  const session = createCommittedMobileSessionFixture();
  await persistRecordingSessionManifest(session);
  const reopened = await resolveRecordingSessionManifest(session.videoPath);
  expect(reopened?.captureMetadata?.sourceKind).toBe('ios-device');
  expect(reopened?.hideOverlayCursorByDefault).toBe(true);
  expect(reopened?.webcamPath).toBeNull();
});
```

Create `createCommittedMobileSessionFixture` inside the test using a temporary session directory and minimal valid `CaptureMetadata`. Clean the directory in the test teardown.

- [ ] Add manifest v3 readers/writers. Persist meaningful mobile metadata even without webcam media; preserve reading versions 1 and 2. Validate all linked filenames against the session directory, including symlink escape. Missing optional provenance/audio sidecars must not prevent a valid committed movie opening.
- [ ] Extend `EditorProjectData` with optional validated `captureMetadata`. Keep the existing project version 2 unless a genuinely incompatible schema change is introduced. Preserve the field in save, load, snapshots, dirty checks and Save As; do not serialize recovery paths or raw device identifiers into it.
- [ ] Apply fresh-import defaults once: `showCursor = false`, no cursor telemetry or generated mouse zooms, zero crop and border radius, source-native aspect and existing non-cropping wallpaper/padding/shadow. Use actual transformed display dimensions, not coded dimensions alone or an assumed 9:16 screen.
- [ ] Persist normal editor choices immediately through the existing project model. On reopen, explicit saved crop, aspect, annotations, manual zooms and user cursor settings win over mobile defaults. Source provenance must not silently reset them.
- [ ] Test old desktop project, old webcam manifest, new mobile raw-session reopen, saved mobile project, Save As, malformed optional metadata and missing sidecars. Verify a stale desktop cursor sidecar is not loaded into an iOS take.
- [ ] Render/export portrait and landscape fixtures through the existing editor with native aspect, 9:16 and 16:9 compositions. Compare source edges, orientation, timing and audio. Fix only source-contract/geometry integration issues needed here; do not rewrite the exporter.
- [ ] Run persistence and initial-source suites plus all project tests. Expected: no version-1/2 regression, metadata retained, and fresh defaults do not override reopened user edits.
- [ ] Commit: `feat: persist ios capture provenance and mobile-safe editor defaults`.

### Task 15 — Implement interruption recovery and complete lifecycle cleanup

**Files:** Create `electron/ipc/recording/ios/recovery.ts` and tests. Extend `controller.ts`, `storage.ts`, `finalize.ts`, `electron/main.ts`, the recovery IPC/UI boundary in `electron/ipc/register/iosCapture.ts`, and the native `CaptureEngine.swift`/`NativeTimingStore.swift` tests.

**Consumes:** incomplete journals, native timing checkpoints, media inspection, controller terminal states and application lifecycle events. **Produces:** honest interrupted results, recoverable candidates and no orphaned capture resources.

Define internal recovery contracts:

```ts
export interface IOSRecoveryCandidate {
  sessionId: IOSSessionId;
  status: 'recoverable-av' | 'recoverable-video' | 'unrecoverable';
  durationMs: number | null;
  reasonCode: string;
}
export async function scanIOSRecoveryCandidates(
  recordingsRoot: string
): Promise<readonly IOSRecoveryCandidate[]>;
export async function recoverIOSRecording(input: {
  sessionId: IOSSessionId;
  mode: 'with-audio' | 'video-only';
}): Promise<CommittedIOSRecording>;
```

The implementation resolves session IDs against its own scanned, validated directory registry. No recovery request accepts an absolute directory or arbitrary file from a renderer. Candidates expose only the metadata needed for the user to choose an action.

- [ ] Write failing process-level tests for unplug before/after first frame, format change, native append failure, microphone removal, low disk reserve, helper crash, renderer crash, parent stdin EOF, system sleep and quit. Include simultaneous Stop/disconnect and Stop/quit. Expected: one terminal workflow, no stale recording state, no silently substituted audio source.
- [ ] After a detected incompatible format change, reject the new-format sample before appending it. Finish the preceding valid take and label it interrupted. A same-sized orientation/transform change must not be missed by comparing only width and height. Do not automatically restart or splice the rotated take.
- [ ] Add disk/checkpoint interruption fixtures: intact fragment, truncated final fragment, zero-frame file, missing native timing, partially written main journal, committed movie before journal update, and missing optional audio. Expected: inspect before offering recovery; unknown A/V timing offers video-only recovery, never guessed alignment.

```ts
it('offers video-only recovery when timing was lost', async () => {
  const fixture = await createRecoveryFixture({
    video: 'valid-fragmented', timing: 'missing', journal: 'recording',
  });
  const candidates = await scanIOSRecoveryCandidates(fixture.recordingsRoot);
  expect(candidates[0]?.status).toBe('recoverable-video');
});
```

`createRecoveryFixture` creates synthetic files in a temporary root and injects the inspector where unit tests do not run AVFoundation. The physical recovery suite must also exercise real fragments; mocks cannot prove damaged-media recovery.

- [ ] Route spontaneous native finalisation to the same controller completion/commit path as a user Stop. Keep the completed result in main when the renderer is gone; restore it on reload without another recording or duplicate editor handoff.
- [ ] Attach the appropriate existing Electron lifecycle hooks for renderer loss, power suspend and application quit. Acquire a sleep-prevention assertion only while actively capturing and release it on all terminal paths. Safe quit waits for bounded native finalisation; after the 10-second grace period, escalate termination while preserving files. Do not block application exit forever or promise recording across forced sleep.
- [ ] Native stdin EOF must finish writers and save native timing without depending on an alive stdout consumer. Catch broken-pipe output errors separately from file finalisation. Test parent termination while each audio stream has a nonzero offset.
- [ ] Offer Recover recording, Open folder and Discard from validated candidates. Confirm destructive discard; do not auto-delete incomplete sessions by age. Recovery must work with the capture feature disabled and without camera permission.
- [ ] Add opt-in diagnostic export containing versions, generic capabilities, redacted state transitions, timing summaries and error codes. Strip names, raw device IDs, home-directory paths and media contents. Default journal retention serves local recovery, not remote telemetry.
- [ ] Run controller/recovery/native engine tests and a physical unplug/crash cycle. Expected: each terminal path releases capture inputs, preview queues, lease, power assertion, listeners, timers and child-process handles.
- [ ] Commit: `feat: recover interrupted ios recordings and close native lifecycle gaps`.

### Task 16 — Build deterministic end-to-end fixtures and regression evidence

**Files:** Create `scripts/fixtures/ios-capture/generate.mjs`, `scripts/verify-ios-capture-fixture.mjs`, fixture metadata JSON and `docs/testing/ios-usb-capture-matrix.md`. Add the integration suites under `electron/ipc/recording/ios/` and native tests. Add `verify:ios-capture-fixture` to `package.json`.

**Consumes:** implemented capture/finalisation/editor contracts. **Produces:** reproducible software tests and a physical-device acceptance report for A01–A16.

The new verification command has this explicit interface:

```bash
npm run verify:ios-capture-fixture -- \
  --session-dir /absolute/path/to/synthetic-or-test-session \
  --expected /absolute/path/to/expected.json \
  --report /absolute/path/to/report.json
```

The verifier parses named arguments without a shell, rejects unknown/missing arguments and exits nonzero for failed assertions. It uses the native media inspector and the resolved FFmpeg binary. It is an engineering utility operating on explicitly supplied test files, not a renderer-accessible path API.

- [ ] Define `expected.json` fields: fixture version/name, expected display geometry/transform, video mode, duration/tolerance, known audio event times per stream, permitted sample loss, expected source colour metadata, and expected terminal status. Keep created test media synthetic and reproducible. Include a declared licence/provenance for any externally sourced fixture.
- [ ] Generate a short UI-like test clip with moving fine text, single-pixel edge markers, labelled colour patches, timed flashes and corresponding audio clicks. Generate portrait, landscape, odd-dimension, delayed-microphone, negative-offset, internal-gap and silent/static variants. Use a 30-minute timing variant for the hardware gate and a shorter version in routine CI.
- [ ] Unit-test the verifier against a deliberately truncated movie, wrong rotation, 250 ms audio displacement, missing soundtrack and incorrect duration. Expected: it fails the corresponding checks instead of producing an unconditional “verified” report.
- [ ] Run deterministic software integration through native writers → journal → finalisation → session reload. Compare decoded geometry/timing and eligible compressed video payloads; compare payloads after demuxing, not entire MOV file hashes, because container metadata changes during remux.
- [ ] Validate source and final-export colour with measured metadata and same-source frame comparisons. The physical on-device/QuickTime comparison is a separate visual record; do not claim pixel identity between independent recordings of a moving screen.
- [ ] Execute A01–A16 on the advertised physical matrix: at least a USB-C iPhone and a Lightning iPhone where support is claimed, an iPad before advertising iPad support, and Apple Silicon/Intel Macs before claiming both. Record exact OS versions, device family, cable/connection type, tested build SHA, result and evidence location. An untested row says **Not tested**, not Pass.
- [ ] Measure the 30-minute sync at both ends against the ≤80 ms target; five-minute static/dark duration; preview-stall isolation; 20 recording cycles; interrupted recovery; and real installed-app permissions. Record memory/counter trends rather than an unqualified “fast” label.
- [ ] Re-run existing macOS desktop, Windows WGC/browser and Linux portal regression suites. Existing hardware-dependent platform smoke checks remain required in their respective environments; an iOS-only Mac test cannot certify them.
- [ ] Commit: `test: verify ios capture fidelity recovery and desktop regressions`.

### Task 17 — Ship signed helpers and automate noninteractive checks

**Files:** Modify `scripts/build-ios-device-helper.mjs`, `scripts/build-native-helpers.mjs`, `scripts/smoke-packaged-binaries.mjs`, `scripts/verify-macos-distribution.mjs`, `electron-builder.json5`, signing entitlement files and `package.json`. Create `.github/workflows/ios-capture.yml`.

**Consumes:** working helper, self-test/inspection modes and the repo's existing build/signing pipeline. **Produces:** correctly staged, signed and linked helpers plus reproducible CI checks. Installation testing is part of this task, not a documentation-only follow-up.

- [ ] Write failing packaging tests for missing executable, incorrect executable bit, wrong architecture, absent embedded usage strings, missing required signing entitlement and mismatched protocol version. Reject a build that would compile the helper on the user's computer.
- [ ] Build/stage both target architectures under `electron/native/bin/darwin-arm64/recordly-ios-device-helper` and `darwin-x64/recordly-ios-device-helper`. Keep macOS 14 as the deployment target. Ensure the package's Info.plist is actually embedded in the executable, rather than merely present in the source directory.
- [ ] Preserve existing native helpers and build scripts. On non-macOS hosts, skip the new native compile intentionally without falsely marking Mac native tests as passed. Declare `test:ios-native` and `verify:ios-capture-fixture` scripts explicitly; do not assume they existed on the baseline.
- [ ] Update the app's camera usage text to cover connected-device screen capture. Sign the helper with the narrow entitlements established by G1; verify the parent and helper separately. Leave unchanged unrelated permissions, architectures and signing policy. No speculative blanket entitlements.
- [ ] Extend packaged smoke discovery to require the new helper only in a build that includes the feature. Run its `--self-test` without an iPhone or TCC prompt. Inspect Mach-O architecture/deployment, dynamic linkage, embedded privacy metadata and signatures for each staged architecture. Cross-compiling is not physical compatibility testing.
- [ ] Add a macOS workflow for dependency installation, native tests, TypeScript/Vitest, helper build and noninteractive self-test. Reuse existing release signing/notarisation integration rather than adding a duplicate secret-dependent release system. Use the repository's supported runner/Xcode versions; document any SDK requirement separately from the macOS deployment floor.
- [ ] Build the normal application and execute its existing smoke/distribution checks with their inspected argument contract. In an environment configured for the repository's normal Mac builds, the standard build entry point is:

```bash
npm run build:mac
npm run smoke:packaged-binaries
```

The inspected distribution verifier requires `--arch` (`arm64` or `x64`) and `--team-id`; its release directory defaults to `release`. Run it against the actual signed artifacts for both architectures, with the configured Apple Team ID:

```bash
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to the team that signed these artifacts}"
for arch in arm64 x64; do
  npm run verify:macos-distribution -- \
    --arch "$arch" \
    --team-id "$APPLE_TEAM_ID" \
    --release-dir release \
    --report "release/macos-distribution-report-$arch.json"
done
```

The variable is a required release-environment input, not a Team ID supplied by this document. Preserve the existing signature/notarisation checks; an unsigned local build cannot satisfy them.

- [ ] Install a signed/notarised artifact on a clean test account without the repository, Xcode or command-line tools. Test first permission prompt, denial, later grant/relaunch, discovery, recording, audio, export and recovery. Inspect that the prompt identifies the intended application, not Terminal or a temporary helper.
- [ ] Mark A15 passed only for the installed architectures tested. A Mac CI compile and a mock capture run are not sufficient. Commit: `build: package sign and verify ios device capture helpers`.

### Task 18 — Complete documentation, release gates and controlled enablement

**Files:** Create/update `docs/ios-usb-capture.md`, `docs/testing/ios-usb-capture-feasibility.md`, `docs/testing/ios-usb-capture-matrix.md`, feature policy tests and user-facing locale/release copy. Update the repository README only with the tested supported feature set.

**Consumes:** all implementation/test results, G1–G4 evidence and the actual support matrix. **Produces:** a releasable feature whose user-facing promises match verified behaviour.

- [ ] Document the supported cable/trust flow, source selection, device audio versus Mac narration, fixed orientation, no pause/webcam in v1, interruption recovery and permission-denied recovery. Explain that notifications and protected content are not automatically fixed or redacted.
- [ ] Document modes as received-stream preservation versus a validated high-quality encode. Do not use “lossless iPhone recording,” guaranteed native frame rate, guaranteed HDR/P3, or guaranteed zero-loss crash recovery. Preserve the distinction between source recording quality and a later edited export.
- [ ] Populate the acceptance matrix with evidence or an explicit failure/not-tested status. Cross-check every F and A requirement against the traceability table below. Remove unsupported device/OS claims from copy; do not silently weaken an acceptance criterion after a failing test.
- [ ] Keep the internal default off until G1–G3 pass. Enable a labelled beta through the normal build policy, not a remote configuration service. General enablement requires G4 and the complete applicable acceptance matrix. Narration cannot remain broken while calling this full v1 complete.
- [ ] Test rollback/disablement: the source category disappears, no new device capture starts, and previously committed videos/projects plus recovery candidates remain accessible. Enabling/disabling new capture must not corrupt existing data.
- [ ] Run the final quality commands in section 5 and record their actual results. List baseline failures separately, without claiming they are passing. Get a review of native timing/format logic and a separate review of IPC/storage/security boundaries.
- [ ] Commit: `docs: publish tested ios capture workflow and release evidence`. Change the compiled default only in the release commit that includes the successful gate evidence.

## 4. Dependencies and reviewable delivery slices

Use this order when implementing sequentially: **01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18**.

The feasibility probe comes before polishing the source picker. Tasks 05–08 can be developed in partially parallel branches after the shared contracts/package are stable, but they share `CaptureEngine.swift`; assign one integration owner rather than allowing overlapping rewrites. Controller tests can use the fake helper while native work proceeds. Real integration still waits for the actual native contracts and media evidence.

A practical review sequence is:

| Review slice | Tasks | Independently reviewable result |
|---|---|---|
| Feasibility and contracts | 01–04 | Documented platform evidence, protocol, testable helper skeleton and staging. |
| Native media | 05–08 | Correct source selection, native capture/audio/timing and independent preview. |
| Main lifecycle and storage | 09–11 | Process control, safe IPC, exclusive ownership and atomic media commit. |
| Product integration | 12–14 | Launcher/HUD experience and durable editor/session behaviour. |
| Reliability | 15–16 | Recovery, fault injection and media/regression evidence. |
| Distribution and release | 17–18 | Installed-app verification, documented support and controlled enablement. |

Each slice stays behind the disabled feature flag until its dependencies are ready. Do not merge a half-wired source category that accidentally records the desktop. Native APIs and file formats are reviewed before downstream UI assumptions are locked in.

## 5. Verification commands and evidence rules

These baseline scripts were observed in the inspected package. Run them from the implementation checkout; this plan has not executed them:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run format:check
npm run i18n:check
```

The implementation adds these commands; they are not present in the untouched baseline:

```bash
# Requires macOS and the development Swift toolchain.
npm run test:ios-native

# Creates/stages the new helper without building the entire app.
node scripts/build-ios-device-helper.mjs

# Verifies a generated/test recording against explicit expectations.
npm run verify:ios-capture-fixture -- \
  --session-dir /absolute/path/to/session \
  --expected /absolute/path/to/expected.json \
  --report /absolute/path/to/report.json
```

The three paths in the fixture command are test-run inputs to substitute with actual generated file locations. They are not assumed files shipped with this documentation. The generator/verifier task defines the necessary file format and rejects missing inputs.

Use the repository's normal packaging workflow for release artifacts, followed by the extended packaged smoke and distribution verification. Run native self-tests in CI without devices or permission prompts. Run physical capture tests separately on the installed app.

A release evidence record contains test ID, build SHA, OS/architecture, device family, test setup, expected result, observed result and evidence location. Record no raw phone serial/UDID or personal device name. A test result is **Pass**, **Fail**, **Not tested** or **Not applicable with reason**; “probably works” is not a status.

A nonzero test command is not hidden by `|| true`, excluding relevant tests, deleting a gate, or changing a target until it matches the observed output. Distinguish pre-existing repository failures from newly introduced failures, and disclose both at handoff.

## 6. Requirements-to-task traceability

| Spec requirement | Implemented/tested by |
|---|---|
| F01 macOS source/discovery/help | 02, 05, 11, 13, 17 |
| F02 positive screen-source classification | 02, 05, 16 |
| F03 one device, preview and actual format | 05, 06, 08, 11, 13 |
| F04 native video dimensions/timing | 02, 06, 07, 10, 16 |
| F05 device audio and native narration | 05, 07, 10, 12, 13, 16 |
| F06 countdown/Record/Stop/Discard | 09, 11, 12, 13, 15 |
| F07 editor handoff/defaults | 09, 10, 14, 16 |
| F08 interruptions and storage/process failures | 06, 07, 09, 10, 15, 16 |
| F09 raw session/project provenance | 10, 14, 16 |
| F10 prebuilt signed helpers | 04, 17 |
| F11 redacted diagnostics/recovery | 07, 10, 15, 18 |
| F12 desktop/platform regressions | 11, 12, 14, 16, 17 |

| Acceptance criterion | Evidence tasks |
|---|---|
| A01 discovery/identity | 02, 05, 13, 16 |
| A02 permissions | 02, 05, 11, 12, 17 |
| A03 readiness/start cancellation | 06, 09, 12, 16 |
| A04 geometry | 06, 08, 14, 16 |
| A05 compressed passthrough | 06, 10, 16 |
| A06 validated H.264 encoding | 06, 16 |
| A07 colour | 02, 06, 14, 16 |
| A08 audio timing | 07, 10, 16 |
| A09 static/dark duration | 06, 07, 10, 16 |
| A10 interruptions | 09, 10, 15, 16 |
| A11 session/project persistence | 10, 14, 16 |
| A12 editor/export agreement | 14, 16 |
| A13 performance/backpressure | 06, 08, 09, 16 |
| A14 repetition/cleanup/idempotency | 05, 09, 12, 15, 16 |
| A15 installed distribution | 04, 17 |
| A16 desktop regressions | 11, 12, 14, 16, 17 |

**G1:** Tasks 02, 05 and 17 establish source classification and signed permission behaviour. **G2:** Tasks 02, 06, 10, 14 and 16 establish media fidelity and decoder compatibility. **G3:** Tasks 07, 10 and 16 establish actual clock/audio synchronisation. **G4:** Tasks 14–18 establish recovery, persistence, distribution and release readiness.

## 7. Final implementation handoff checklist

- [ ] Specification and plan are checked into their documented repository locations; no requirement was silently dropped.
- [ ] Shared contract names and version fields match in Swift, main, preload, renderer and tests.
- [ ] There is no device-to-desktop fallback, unrelated camera selection or hidden desktop permission prerequisite.
- [ ] No source or accepted audio is silently discarded; known unsupported paths are reported before recording.
- [ ] Session metadata survives without a webcam; existing projects preserve their behaviour and new projects preserve user edits.
- [ ] Recovery preserves native timing and media after parent failure and is available with capture disabled.
- [ ] Desktop, native and packaged checks have actual recorded results; hardware gates have physical evidence.
- [ ] Installed architecture/OS claims match the support matrix; source/export quality wording matches measurements.
- [ ] The release commit explicitly records feature-flag status, remaining known limitations and the tested artifact.

**Implementation status of this document:** planned, not implemented. Source inspection establishes integration points; it does not establish working device capture, a successful macOS build or passing application tests. The first execution task creates that baseline evidence, and the later gates establish runtime correctness.
