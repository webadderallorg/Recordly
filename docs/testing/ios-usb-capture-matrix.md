# iOS USB capture acceptance matrix

Every physical row starts **Not tested**. Record the exact build, OS, architecture,
generic device family, cable/hub, actions, expected/observed results and evidence
location when running it. Exclude serials, raw device IDs and personal device names.

| ID | Acceptance case | Status | Evidence |
| --- | --- | --- | --- |
| A01 | Positive discovery, duplicate labels, removal | Not tested | Physical devices required |
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
| A16 | Desktop regression | Partial | Baseline 1,083 software tests pass; platform hardware tests not run |

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

See [feasibility and baseline](ios-usb-capture-feasibility.md). Implementation and
synthetic test results are recorded separately from the physical acceptance rows.
