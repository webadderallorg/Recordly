# iOS USB capture acceptance matrix

Every physical row starts **Not tested**. Record the exact build, OS, architecture,
generic device family, cable/hub, actions, expected/observed results and evidence
location when running it. Exclude serials, raw device IDs and personal device names.

| ID | Acceptance case | Status | Evidence |
| --- | --- | --- | --- |
| A01 | Positive discovery, duplicate labels, removal | Partial | One trusted USB iPhone's muxed-only screen signature observed on the development host; duplicates and removal untested. See implementation evidence. |
| A02 | Installed permission allow/deny/relaunch, no desktop permission prerequisite | Not tested | Signed installation required |
| A03 | Readiness and start cancellation | Partial | Ready/live preview directly observed; recording completion user-confirmed. Start cancellation and physical no-sample behavior remain untested. |
| A04 | Delivered geometry/aperture/orientation | Partial | Physical coded, clean-aperture and presentation dimensions all 1206 × 2622 with zero aperture origin. Other orientations/transitions remain untested. |
| A05 | Passthrough packets and clean first decode | Not tested | Observed phone uses High-profile H.264 → raw encode, not baseline passthrough. Synthetic baseline packet/decode checks are separate. |
| A06 | Encode quality and overload | Partial | Physical raw-encode preparation/live preview observed and a completed take user-confirmed; independent quality and overload measurements remain untested. |
| A07 | Colour comparison | Partial | Physical Rec.709 / `IEC_sRGB` / Rec.709 tags observed. Synthetic encode/decode preserves tags and flat patches; physical device/QuickTime/source/export comparison remains untested. |
| A08 | Audio sync | Not tested | 30-minute flash/click, each audio combination |
| A09 | Static/dark duration | Not tested | Five-minute sparse source |
| A10 | Interruptions | Not tested | Unplug, rotation, microphone loss, disk/crashes/quit |
| A11 | Persistence | Not tested | Raw session, saved project, Save As |
| A12 | Editor and export | Partial | User confirmed one physical recording opened in the editor; direct editor inspection showed saved recording, recorded device-audio metadata and approximately 20.2 seconds. Export and portrait/landscape/native/9:16/16:9 comparisons remain untested. |
| A13 | Performance and preview isolation | Partial | Live preview directly observed. Sustained preview isolation, 30-minute memory and counter measurements remain untested. |
| A14 | Repeated sessions | Not tested | 20 cycles, duplicate stop/stale event checks |
| A15 | Installed distribution | Not tested | Signed notarised app, clean account, each advertised architecture |
| A16 | Desktop regression | Partial | Baseline 1,083 tests and capture-fix integrated suite of 1,221 tests pass; platform hardware tests not run |

### Observed development session — 8 September 2026

Host: macOS 26.2 (25C5048a), Apple Silicon, isolated `Recordly iOS Test` build with
the sRGB transfer fix. Generic device: one USB iPhone. The phone OS, cable/hub topology
and exact running artifact checksum were not recorded; this is not a clean-account
installed-release test.

The metadata-only probe recorded H.264 High-profile, 1206 × 2622, full range, followed
by negotiated `420v` video-range samples with the same geometry and Rec.709 primaries,
`IEC_sRGB` transfer and Rec.709 matrix. Evidence:
`/private/tmp/recordly-format-probe-srgb-rejection.jsonl`. Ready and a live preview
were directly observed after the policy fix. Recording completion/editor handoff and
9:41/full status icons were subsequently confirmed by the user in the development
session. A later direct accessibility inspection of the editor showed **Device recording
saved**, **Device audio track recorded**, and approximately **20.2 seconds** of clip
duration. Audible playback, audio sync, decoded-media quality, export and long-duration
behavior were not checked. These observations only partially satisfy the
rows above.

## Physical combinations

| Combination | Status |
| --- | --- |
| Apple Silicon + USB iPhone, cable/hub topology not recorded | Partial: metadata and Ready/live preview observed; recording/editor handoff user-confirmed |
| Apple Silicon + USB-C iPhone + direct cable | Not tested |
| Apple Silicon + USB-C iPhone + hub | Not tested |
| Lightning iPhone, if advertised | Not tested |
| iPad, before advertising support | Not tested |
| Real Intel Mac, before advertising Intel capture | Not tested |
| macOS 14 minimum and current stable release | Not tested |

## Software evidence

Software-only evidence does not change any physical row above:

| Evidence set | Status | Result |
| --- | --- | --- |
| Native XCTest | Pass | 46 native tests, zero failures; includes discovery, raw negotiation and the observed geometry/color-triplet regression |
| Native helper cross-build | Pass | arm64 and x86_64 staged for macOS 14; no Intel runtime claim |
| Integrated JS/TS checks | Pass | 145 files, 1,221 tests; one opt-in native suite skipped and passed separately |
| Native finalization integration | Pass | One synthetic native-inspector → finalizer → manifest → verifier test |
| Positive synthetic media variants | Pass | 7: portrait, landscape, odd dimension, delayed microphone, negative offset, internal gap, silent/static |
| Negative synthetic media cases | Pass by rejection | 5: wrong rotation, displaced audio, missing audio, duration truncation, byte-truncated MOV |
| Synthetic sRGB round trip | Pass | 1206 × 2622 coded/display geometry and Rec.709 / `IEC_sRGB` / Rec.709 tags preserved; decoded flat-patch luma `[16, 64, 128, 192, 235]`, tolerance three code values. macOS 15+ policy, no physical color/export guarantee. |
| Development macOS packaging | Partial | Both architecture artifacts built and Apple Development signed; final-source arm64 bundle refreshed with ad-hoc signing. Release build and notarization remain pending. |
| Packaged smoke | Pass | Final-source host bundle and both helper slices checked; x64 `otool` byte parsing fixed with a regression test |

See [feasibility and baseline](ios-usb-capture-feasibility.md) and
[implementation evidence](ios-usb-capture-implementation.md). G1 and G2 have **Partial**
physical evidence; G3–G4 remain **Not tested**. No release gate has passed, and no
software fixture is a substitute for the remaining physical and installed-app tests.
