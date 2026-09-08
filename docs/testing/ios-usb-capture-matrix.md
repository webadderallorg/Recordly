# iOS USB capture acceptance matrix

Every physical row starts **Not tested**. Record the exact build, OS, architecture,
generic device family, cable/hub, actions, expected/observed results and evidence
location when running it. Exclude serials, raw device IDs and personal device names.

| ID | Acceptance case | Status | Evidence |
| --- | --- | --- | --- |
| A01 | Positive discovery, duplicate labels, removal | Partial | One trusted USB iPhone's muxed-only screen signature observed on the development host; duplicates and removal untested. See implementation evidence. |
| A02 | Installed permission allow/deny/relaunch, no desktop permission prerequisite | Not tested | Signed installation required |
| A03 | Readiness and start cancellation | Not tested | Physical no-sample/start test required |
| A04 | Delivered geometry/aperture/orientation | Not tested | Physical source required |
| A05 | Passthrough packets and clean first decode | Not tested | Real source plus deterministic fixture |
| A06 | Encode quality and overload | Not tested | Moving UI source required |
| A07 | Colour comparison | Not tested | Device/QuickTime/source/export comparison |
| A08 | Audio sync | Not tested | 30-minute flash/click, each audio combination |
| A09 | Static/dark duration | Not tested | Five-minute sparse source |
| A10 | Interruptions | Not tested | Unplug, rotation, microphone loss, disk/crashes/quit |
| A11 | Persistence | Not tested | Raw session, saved project, Save As |
| A12 | Editor and export | Not tested | Portrait/landscape, native/9:16/16:9 |
| A13 | Performance and preview isolation | Not tested | 30-minute memory/counter record |
| A14 | Repeated sessions | Not tested | 20 cycles, duplicate stop/stale event checks |
| A15 | Installed distribution | Not tested | Signed notarised app, clean account, each advertised architecture |
| A16 | Desktop regression | Partial | Baseline 1,083 tests and latest reported integrated software suite pass; platform hardware tests not run |

## Physical combinations

| Combination | Status |
| --- | --- |
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
| Native XCTest | Pass | 31 native tests, zero failures; includes the observed muxed-only discovery metadata regression |
| Native helper cross-build | Pass | arm64 and x86_64 staged for macOS 14; no Intel runtime claim |
| Integrated JS/TS checks | Pass | 145 files, 1,208 tests; one opt-in native suite skipped and passed separately |
| Native finalization integration | Pass | One synthetic native-inspector → finalizer → manifest → verifier test |
| Positive synthetic media variants | Pass | 7: portrait, landscape, odd dimension, delayed microphone, negative offset, internal gap, silent/static |
| Negative synthetic media cases | Pass by rejection | 5: wrong rotation, displaced audio, missing audio, duration truncation, byte-truncated MOV |
| Development macOS packaging | Partial | Both architecture artifacts built and Apple Development signed; final-source arm64 bundle refreshed with ad-hoc signing. Release build and notarization remain pending. |
| Packaged smoke | Pass | Final-source host bundle and both helper slices checked; x64 `otool` byte parsing fixed with a regression test |

See [feasibility and baseline](ios-usb-capture-feasibility.md) and
[implementation evidence](ios-usb-capture-implementation.md). G1 has **Partial**
discovery evidence; G2–G4 remain **Not tested**. No release gate has passed, and no
software fixture is a substitute for the remaining physical and installed-app tests.
