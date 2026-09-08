# iOS USB capture feasibility evidence

Implementation baseline: `4b20a1a76ed3564bd70aee7a0cc7167ea2e5e9c1`.
Development host: macOS 26.2 (25C5048a), arm64, Xcode 26.6 (17F113),
Apple Swift 6.3.3. This beta host does not certify stable macOS compatibility.

## Baseline — 8 September 2026

| Check | Observed result |
| --- | --- |
| `npm ci --cache /private/tmp/recordly-npm-cache` | Dependencies installed; postinstall failed rebuilding uiohook because Homebrew Python 3.14 could not load an expat symbol. |
| `npm_config_python=/usr/bin/python3 npm run rebuild:native` | Pass. No source/dependency changes needed. |
| `npm test` using initially selected Node | Could not start: app-bundled Node refused Rollup's native library because of signing Team ID mismatch. |
| `PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin npm test` | Pass: 120 files, 1,083 tests. Homebrew Node 26.5.0. |
| `npx tsc --noEmit` | Pass. |
| `npm run lint` | Pass: 574 files. |
| `npm run format:check` | Pass: 573 files. |
| `npm run i18n:check` | Pass: locale structures consistent. |

Local baseline logs are `/private/tmp/recordly-baseline-*.log`; these are development
artifacts, not hardware recordings or release evidence. No baseline application
test failures remain after selecting working runtimes. Native platform-helper and
packaged application builds are separate checks.

## Release gates

| Gate | Status | Required evidence |
| --- | --- | --- |
| G1 API and permissions | Partial | One USB iPhone's discovery signature, actual samples and Ready/live preview observed; one recording/editor handoff user-confirmed. Permission allow/deny/relaunch and signed installed-app identity remain untested. |
| G2 media fidelity | Partial | Physical 1206 × 2622 H.264 High → `420v`, Rec.709/sRGB/Rec.709 metadata observed; physical color, sparse timing and editor/export comparison remain untested. |
| G3 audio | Not tested | Real clock mapping and 30-minute device/narration sync within 80 ms. |
| G4 reliability and distribution | Not tested | Physical interruption tests and clean signed installed-app matrix. |

Software fixtures do not certify these gates. The feature must remain default-off.
No device family, signing team or installed release has been certified by this
record. The probes recorded in [implementation evidence](ios-usb-capture-implementation.md)
observed the `iOS Device` signature without a standalone video media type, followed
by actual frame metadata. One successful development session does not certify the
remaining devices, permissions, media-fidelity or release matrix.

## Implemented software evidence — 8 September 2026

The native helper and disabled-by-default application integration are now present.
The latest capture-fix native run passed 46 XCTest tests and built both arm64 and x86_64 helper
artifacts with a macOS 14 deployment target and embedded privacy metadata. Cross-build
results do not establish Intel runtime or installed permission behavior.

The final full JavaScript/TypeScript integration run passed 147 files
and 1,235 tests, with one explicitly opt-in native-media suite skipped in that run.
That suite was run separately and passed using synthetic media through the staged
native inspector, production finalizer, bundled FFmpeg, manifest reopen and verifier.
TypeScript, full lint, formatting and localization checks also passed.

A development `build:mac` produced arm64/x64 DMG and ZIP artifacts signed with an
Apple Development identity. Notarization was skipped because release credentials
were unavailable. That build preceded final review edits. Packaged smoke then found
an x64 `otool` output-unit parsing defect; the parser and regression test were fixed.
A final-source arm64 preview bundle was rebuilt with an ad-hoc signature, and packaged
smoke passed for that bundle and both helper slices. Packaging does not satisfy any
release gate; G1 and G2 have partial physical evidence and G3–G4 remain **Not tested**.

Synthetic media evidence includes seven passing positive variants and five expected
negative cases. Packet preservation is checked after demuxing rather than by hashing
whole MOV containers. A synthetic 300-second static timeline and rational clock/audio
tests pass. The latest native suite also round-trips 1206 × 2622 `420v` media with
exact geometry and Rec.709 / `IEC_sRGB` / Rec.709 tags, then checks decoded flat-patch
values. The policy preserves sRGB transfer on macOS 15+; it does not relabel the
source or enable unverified macOS 14 sRGB encoding. These synthetic results do not
establish physical color/export fidelity, frame rate, 30-minute sync or interruption recovery.

## Physical capture follow-up — 8 September 2026

A metadata-only probe observed a 1206 × 2622 H.264 High-profile stream, full range,
with Rec.709 primaries/matrix and `IEC_sRGB` transfer. Negotiating `420v` yielded
video-range raw samples with the same geometry and color triplet. The original
transfer restriction caused the observed rejection. The probe saved no screen or
audio media. Earlier no-frame timeouts did not show that the phone was disconnected:
this macOS 26 host uses `SPUSBHostDataType`, and the USB registry confirmed the phone.

After the transfer-policy fix, Ready and a live preview were directly observed in
the isolated development test app. The user subsequently confirmed that recording
completed and the editor opened, and that 9:41 with full status icons appeared on
the phone. A later direct accessibility inspection of the editor showed **Device
recording saved**, **Device audio track recorded**, and approximately **20.2 seconds**
of clip duration. This verifies the displayed outcome and metadata; audible playback,
audio sync, decoded-media quality and export were not checked. No long-run result
was recorded. The phone OS, cable/hub topology and exact running artifact checksum
remain unspecified. These results advance G1/G2 to partial evidence without passing
either gate; G3/G4 remain untested.

See [implementation evidence](ios-usb-capture-implementation.md) for task status and
commands, and [the acceptance matrix](ios-usb-capture-matrix.md) for the still-open
physical evidence.
