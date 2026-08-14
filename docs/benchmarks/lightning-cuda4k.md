# Lightning CUDA 4K production-path benchmark

Deterministic benchmark for Recordly's Lightning (modern) HEVC export over the
NVIDIA CUDA compositor. It launches the real Electron app in smoke auto-export
mode and exercises the exact production path — it is NOT a direct
`run-mp4-pipeline.mjs` oracle:

```
smoke auto-export -> VideoEditor -> ModernVideoExporter ->
nativeStaticLayoutExport IPC -> native-video.ts -> CUDA compositor
```

## Run

```text
npm run benchmark:lightning-cuda4k
node scripts/benchmark-lightning-cuda4k.mjs --help
```

The script is Windows-only (the CUDA compositor route is Windows-only) and must
run on a machine with an NVIDIA GPU and current drivers. It never commits media:
scratch work lives under `.tmp/cuda4k/` (gitignored) and is deleted unless
`--keep-workdir` is passed.

## Prerequisites

1. Built bundles: `dist-electron/main.cjs` and `dist/index.html` (run
   `npm run build`, or at least `npm run tsc && npx vite build --config
   vite.config.ts && npm run normalize:electron-main-cjs`).
2. NVIDIA CUDA compositor helper built:
   `npm run build:nvidia-cuda-compositor`. The script checks for
   `electron/native/bin/win32-x64/recordly-nvidia-cuda-compositor.exe` (or the
   `build/Release` variant) and fails with an actionable message otherwise.
3. `ffmpeg-static` and `ffprobe-static` installed (`npm ci`).
4. `RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT` if the Video Codec SDK is not at
   `.tmp/video-sdk-samples` (only needed when rebuilding the helper).

A `--dry-run` flag checks all prerequisites and validates the source without
launching Electron.

## Source contract

The benchmark is deterministic: a 3840x2160, 30 FPS, H.264, `yuv420p` source.
Source selection order:

1. `--input PATH` (validated, absolute path).
2. `.tmp/cuda4k/source-4k.mp4` when present — it is validated against the
   contract and the run fails with an actionable error if it is not compliant
   (never silently substitutes media).
3. Otherwise a deterministic fixture is generated with ffmpeg `testsrc2`
   (3840x2160@30, H.264 `yuv420p`, `libx264 veryfast`, video-only, 5 s) into a
   temp directory.

The generated fixture is intentionally video-only so the CUDA route runs with
`audioMode: none`. Provided sources that carry audio still route through CUDA
because the harness sets `RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT=1`.

## Exact resolved settings

The harness sets these smoke/query overrides on every Electron launch:

| Setting | Value |
| --- | --- |
| `RECORDLY_SMOKE_EXPORT` | `1` |
| `RECORDLY_SMOKE_EXPORT_INPUT` | validated 4K source |
| `RECORDLY_SMOKE_EXPORT_OUTPUT` | fresh per-run path |
| `RECORDLY_SMOKE_EXPORT_USE_NATIVE` | `1` |
| `RECORDLY_SMOKE_EXPORT_PIPELINE` | `modern` (Lightning) |
| `RECORDLY_SMOKE_EXPORT_BACKEND` | `auto` |
| `RECORDLY_SMOKE_EXPORT_VIDEO_CODEC` | `hevc` |
| `RECORDLY_SMOKE_EXPORT_ENCODER_PREFERENCE` | `auto` |
| `RECORDLY_SMOKE_EXPORT_BITRATE_MODE` | `auto` (never custom) |
| `RECORDLY_SMOKE_EXPORT_QUALITY` | `source` |
| `RECORDLY_SMOKE_EXPORT_ENCODING_MODE` | `balanced` |
| `RECORDLY_SMOKE_EXPORT_FPS` | `30` |
| `RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT` | `1` (CUDA opt-in for the main-process route) |
| `RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT` | `1` (audio-bearing inputs keep the CUDA route) |
| `RECORDLY_NVIDIA_CUDA_EXPORT_EXE` | resolved helper path |
| `RECORDLY_NVIDIA_CUDA_EXPORT_SCRIPT` | repo `run-mp4-pipeline.mjs` wrapper |
| `RECORDLY_FFMPEG_EXE` / `RECORDLY_FFPROBE_EXE` | ffmpeg-static / ffprobe-static |

No user-specific project settings are loaded: each run launches Electron with an
isolated `--user-data-dir` under the scratch directory, and the harness seeds
that isolated userData's `app-settings.json` with
`recordly.export.experimentalNvidiaCuda: true` so the renderer opts into the CUDA
compositor (the stored setting drives renderer routing; the env var flips the
main-process side). The released app's `Recordly` / dev `Recordly-dev` data
directories are never touched.

## Assertions (fail-fast, nonzero exit)

- Prerequisites exist (bundles, ffmpeg/ffprobe, CUDA wrapper + helper exe).
- Source is compliant (H.264, `yuv420p`, 3840x2160, 30 FPS).
- Smoke report exists at `<output>.report.json`, `success: true`,
  `phase: "saved"`.
- `report.resolvedSettings` proves the contract:
  `codec: "hevc"`, `encoderPreference: "auto"`, `bitrateMode: "auto"`,
  `pipelineModel: "modern"`, `frameRate: 30`, and a positive resolved automatic
  `bitrateBps`. (Width/height are not carried by `resolvedSettings`; the harness
  probes the produced file and asserts 3840x2160 output.)
- CUDA native route actually ran: `report.metrics.encoderName` is
  `nvidia-cuda-compositor` and/or the finalization chunk backend is
  `nvidia-cuda-compositor`. Any `nativeStaticLayoutSkipReason`, renderer raw
  frame / WebCodecs fallback, or `noCpuFallback` failure fails the run with the
  captured log tail.
- Output file is non-empty and probes at 3840x2160, 30 FPS.
- Every run gets a fresh output path and the scratch/userData directory is
  isolated per benchmark invocation.

## Metrics

Per run the harness parses the `[native-static-layout-export] NVIDIA CUDA
compositor completed` completion log (the helper summary) plus the smoke report
and prints a table, then mean/median/min/max summaries.

| Field | Meaning |
| --- | --- |
| Wall time | Launch-to-exit of the Electron child, ms |
| Export time (`report.elapsedMs`) | Renderer-measured export duration, ms |
| `nativeFps` | Measured encode throughput from the CUDA helper summary (frames per second the compositor actually encoded), when the helper reports it |
| End-to-end FPS | Source frames ÷ wall time; includes app startup, decode, export, save, and shutdown. Always lower than `nativeFps` |
| `outputFps` | Configured output frame rate (stream FPS, 30). This is NOT a measured encode speed — it is the target |
| `nativeEncodeWallMs` | Full native helper wall time (spawn to exit: decode, compose, NVENC, flush) |
| `endToEndMs` | Helper-reported end-to-end pipeline time |
| `totalMs`, `overlayHostReadMs`, `overlayH2DEnqueueMs`, `changedTileCount`, `uploadedTileBytes`, `cachedTileCount` | CUDA helper stage/counter metrics surfaced when present (absent for plain video-only runs without overlay layers) |
| Output size | Bytes of the produced MP4 (`fs.stat`) |

`nativeFps` is only labeled native when the helper measured it; the configured
`outputFps` is never presented as measured throughput. See the same
`outputFps` vs `nativeFps` distinction in the completion log.

The full JSON result is always saved at `<scratch>/result.json` and can be
printed to stdout with `--json`. Nothing is written into tracked paths.

## Options

```text
--runs N            Repeats (default 3), fresh output path each run
--input PATH        4K source override
--timeout-ms N      Per-run Electron timeout (default 240000)
--keep-workdir      Keep scratch (source, outputs, userData, result.json)
--json              Print the JSON result to stdout
--dry-run           Check prerequisites and validate source only
-h, --help          Usage
```

`RECORDLY_LIGHTNING_BENCH_KEEP_WORKDIR=1` is equivalent to `--keep-workdir`.

## Notes

- This is a production-path benchmark: it measures the whole editor→exporter→IPC→
  compositor flow, not the compositor in isolation. For compositor micro-staging
  or helper-level numbers use the helper's own summary/probe tooling instead.
- Run-to-run variance includes Electron startup and driver warm-up. Keep the
  same source, machine state, and driver when comparing regressions; prefer
  median over mean for noisy fields.
- On failure the benchmark exits nonzero and prints the captured log tail plus
  report/error details so the kind of CUDA route failure that previously needed
  a manual smoke run is caught automatically.
