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
| G1 API and permissions | Not tested | Physical screen-source identity, first samples, and signed installed-app permission identity. |
| G2 media fidelity | Not tested | Physical formats, colour, sparse timing and editor/export comparison. |
| G3 audio | Not tested | Real clock mapping and 30-minute device/narration sync within 80 ms. |
| G4 reliability and distribution | Not tested | Physical interruption tests and clean signed installed-app matrix. |

Software fixtures do not certify these gates. The feature must remain default-off.
No physical device, signing team or installed release has been certified by this
record. The initial `iOS Device` signature is the supplied compatibility policy,
not a new observed hardware result.
