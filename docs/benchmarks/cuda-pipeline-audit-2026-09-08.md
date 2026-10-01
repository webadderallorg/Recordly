# CUDA export audit — 2026-09-08

The source-video path is GPU-resident on the generalized CUDA route, but the
complete export is not fully native and is not free of redundant work. This
audit preserves Recordly's codec policies and the existing uncommitted export
changes. No quality preset, bitrate policy, or H.264 Auto routing was changed.

## Changes made

- Tiled overlays track which tiles contain visible alpha. Only changed payloads
  are inspected after initialization; unchanged tile visibility is cached. The
  blend launches over their union, including the chroma anchor border, and skips
  wholly transparent layers. Clears, opaque padding outside partial edge tiles,
  odd layer origins, and mixed raw/tiled z-order are covered by native tests.
- Initial tiled payloads are assembled by tile index and uploaded in one CUDA
  copy per layer instead of hundreds of synchronous tile uploads. The temporary
  host canvas is bounded to one layer and released before encoding.
- Physical single-frame RGBA overlays allocate one GPU frame instead of four
  prefetch slots. Their pinned host staging buffer is freed after the initial
  upload. At 3840×2160, this removes 94.9 MiB of unused GPU allocations and
  126.6 MiB of retained pinned host allocations per static RGBA layer.
- Stationary temporal composition and the invariant-background temporal cache
  use a 256-byte lookup table. The table evaluates the existing rounded,
  saturating weighted sum once per export for each possible byte. Moving
  shutter samples retain their original accumulation. The single per-frame
  compositor-stream synchronization is unchanged.
- The helper reports `tiledOverlaySkippedPixels` to quantify avoided blend work.
- Sparse captions, annotations, and frame chrome now take a raw-free tiled
  preparation pass by default. It writes only the tile payload; it does not
  first materialize a full RGBA sidecar merely to delete it. If the measured
  overlay is dense, preparation rerenders once through the existing raw stream
  instead of retaining unbounded 4K frames in memory.
- A native cursor atlas remains visible when a caption/annotation sidecar is
  also present. The CUDA helper now suppresses a cursor only when the browser
  actually owns it; native-atlas cursor pixels are applied before the sidecar.
- On strict HEVC Hardware CUDA exports, an unshadowed webcam may coexist with
  captions, annotations, and frame chrome. NVDEC/CUDA owns webcam decode and
  composition, and the renderer sidecar contains only the remaining pixels.

## Image backgrounds

Image background blur already runs **once per export**, not once per frame:

1. `run-mp4-pipeline.mjs` converts/scales/blurs the image with FFmpeg and requests
   exactly one NV12 output frame (`-frames:v 1`). This preparation is CPU work.
2. `NvencSink::loadBackgroundFrame` uploads that frame once during construction.
3. CUDA composition reads the resident background. The transparent overlay
   renderer is configured with `backgroundBlur: 0`.
4. If temporal background precomposition is needed, its weighted NV12 cache is
   also built once. The measured zoom fixtures reported one cache build and 32
   cache uses. This is separate from image blur.

The renderer fallback also preblurs static backgrounds during setup. Live video
backgrounds use a different path and need frame-dependent processing.

## Measured results

RTX 5080, driver 616.64, Windows WDDM, HEVC, balanced/P4, 40 Mbps, 3840×2160,
30 FPS, 120 output frames. These are **helper-level** measurements, excluding
Electron, browser overlay rendering, audio, source preparation and final mux.
Other desktop GPU applications were open; small total-time differences are noise.

Sparse tiled caption over a constant-color video: one warm-up pair followed by
three interleaved before/after pairs, median reported below.

| Measurement | Before | After |
| --- | ---: | ---: |
| Overlay blend GPU time, all 120 frames | 11.77 ms | 1.83 ms |
| Helper reported total time | 946.80 ms | 944.15 ms |
| Process wall time | 1140.10 ms | 1134.16 ms |
| Measured native throughput | 126.74 FPS | 127.10 FPS |

The blend stage is about 6.4× faster; total throughput is effectively unchanged.
991,349,640 logical blend pixels were skipped, about 99.6% for this sparse fixture.
All decoded frame hashes matched across the eight runs. A representative after
run spent 663.69 ms in NVENC versus 1.66 ms in overlay blending.

Temporal fixtures use a textured NV12 background, centered 2560×1440 content,
60px rounded corners, and constant-color source video. Two interleaved pairs
per setting; means of GPU composition times across 120 frames:

| Shutter samples | Camera | Before | After |
| --- | --- | ---: | ---: |
| 3 | Stationary | 17.09 ms | 14.64 ms |
| 13 | Stationary | 21.62 ms | 14.90 ms |
| 31 | Stationary | 31.30 ms | 15.07 ms |
| 3 | Changing zoom | 22.20 ms | 21.22 ms |
| 13 | Changing zoom | 54.15 ms | 49.30 ms |
| 31 | Changing zoom | 111.09 ms | 98.84 ms |

All decoded frame hashes matched for each setting across 24 runs. Native total
time remained around 0.94–0.95 seconds, dominated by encoder work. Increasing the
SDK encoder ring from four to eight buffers did not improve throughput and was
reverted; the larger allocation is not part of the final change.

Scratch fixtures, baseline executables, benchmark scripts, and full results are
in `.tmp/cuda-overlay-audit/` (untracked). `overlay-result.json` records the first
benchmark; `temporal-result.json` records the temporal comparisons.

## Asset coverage and remaining work

| Asset/effect | Current generalized CUDA route |
| --- | --- |
| Source video | NVDEC → CUDA NV12 composition → NVENC; no browser video readback |
| Still image/gradient background | Prepared once, then resident GPU reuse |
| Crop, resize, rounded layout, zoom, temporal/spatial zoom blur | Native kernels, with route-specific eligibility |
| Plain cursor | Native atlas when eligible, including alongside caption/annotation sidecars |
| Cursor sway, motion blur, click rings | Browser-rendered cursor ROI sprites, then GPU blending |
| Captions, ordinary annotations, frame visuals | Browser rasterization/readback; sparse authored layers use raw-free tiled sidecars and CUDA blending |
| Webcam | Native decode/composition for unshadowed strict HEVC Hardware exports, including mixed caption/annotation/frame jobs; shadowed webcam remains browser-baked |
| Blur annotations, extension render hooks, video wallpapers | Still have native eligibility gaps; strict HEVC Hardware fails instead of silently switching routes |
| Timeline edits | Some native trim/speed mappings exist; eligibility and temporal alignment still require careful parity coverage |
| Audio | Separate audio processing/mux; not CUDA video work |

Live webcam pixels, extension render hooks, blur annotations, and dense sidecars
retain the established raw-stream path. Renderer overlay rasterization/readback
is still the largest remaining cost for authored layers; tile transport removes
the redundant sidecar write and most CUDA blending work, not the browser draw.

## Metal status

There is no native Metal compositor in this checkout. macOS can select
VideoToolbox encoders, but it does not have the CUDA helper's equivalent
decode → compose → encode path, so claiming CUDA-level asset residency there
would be inaccurate. The existing versioned overlay descriptors are already
platform-neutral TypeScript contracts; a Metal backend should consume those
same raw/tiled/cursor-sprite descriptors and preserve their ordering.

The implementation boundary is a macOS helper using VideoToolbox decode,
IOSurface-backed Metal textures, a command buffer for source/webcam/cursor/tile
composition, and VideoToolbox encode. It needs a macOS runner for output and
pixel-parity tests before it becomes an eligible route. That work cannot be
validated or shipped from this Windows-only CUDA environment.

Next substantial improvements:

1. Separate NVENC submission from completion waits/bitstream collection using a
   bounded queue and explicit buffer ownership. The SDK currently waits on the
   encode thread. NVIDIA recommends a separate output-processing thread in its
   [NVENC threading guidance](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-video-encoder-api-prog-guide/index.html#threading-model).
2. Move repeatable caption/frame/annotation visuals to reusable native atlases
   and time-indexed draw commands; avoid browser rasterization and readback for
   unchanged content.
3. Extend native webcam ownership with validated pixel-parity shadows.
4. Reduce cached-background writes that are immediately overwritten by opaque
   video; benchmark against the existing fast copy engines before retaining this.
5. Consider dual-NVENC split-frame encoding as an explicit speed/quality choice.
   P4 with High Quality does not implicitly enable it. NVIDIA documents a quality
   tradeoff, so it was not silently forced during this optimization.
   See [split-frame encoding](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-video-encoder-api-prog-guide/index.html#multi-nvenc-split-frame-encoding-in-hevc-and-av1).

## Validation limits

The CUDA helper and Vite/Electron bundles rebuilt successfully; TypeScript,
focused Biome checking, and `git diff --check` passed. Ten focused test files
passed (240 tests), followed by the native overlay/cursor and temporal contract
checks (21 tests, partially overlapping the focused run).

The production `benchmark-lightning-cuda4k.mjs --runs 1 --keep-workdir` smoke
also passed through the rebuilt app, with verified HEVC/CUDA routing and 4K30
output. Its six-second fixture measured 123.1 native FPS, 8.321 seconds of
renderer-reported export time, and 10.949 seconds including app launch/shutdown
(16.4 end-to-end FPS). This single run is an integration check, not a before/after
speedup claim. Source preparation, app overhead and finalization remain material.

The opt-in GPU test is `tiledOverlayNative.test.mjs`. Run with
`RECORDLY_CUDA_NATIVE_TESTS=1`; optionally set `RECORDLY_CUDA_BASELINE_HELPER` to a
saved older executable for additional comparison. It compares actual decoded
output against raw overlays, not a JavaScript copy of the blend implementation.

A moving `testsrc2` source produced different decoded hashes across repeated
runs of the **untouched baseline**, including with no overlays. The root cause
was not established. This is why bit-exact assertions here use a constant source
with changing overlays/zoom and a textured background. This audit does not claim
general moving-source determinism or full preview/export visual parity.
