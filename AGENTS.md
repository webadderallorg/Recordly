# AGENTS.md

Operational notes for working with Recordly from source. Learned the hard way during a
build-from-source + dev-run session on Windows. Kept practical.

## Project shape

- Electron app (screen recorder + editor). Renderer is React + Vite; `electron/main.ts`
  compiles to `dist-electron/main.cjs`.
- Versioning is semantic-ish; lots of prerelease bets. Real cadence: fire-hose of small
  point releases Nov 2025–Apr 2026, then batched big-feature releases (v1.3.x). There is
  NO CHANGELOG file — derive user-facing diffs from `git log <tag>..HEAD`.
- Release process (RELEASING.md) is heavy: signed + notarized macOS (x64+arm64),
  Authenticode Windows NSIS, Linux AppImage, Homebrew tap automation. Don't expect fast
  stables; they batch fixes into bigger cuts.

## Build / run from source

```
npm ci                 # runs postinstall which builds native helper C/C++ modules
npm run dev            # vite-plugin-electron: starts Vite + launches Electron (dev)
```

Key scripts (package.json): `dev`, `build:platform-native-helpers`, `build:whisper-runtime`,
`build:windows-capture`, `build:windows-gpu-export`, `build:nvidia-cuda-compositor`,
`build:cursor-monitor`, `test` (vitest), `lint`/`format` (biome).

### Windows gotchas (real, hit in this repo)

1. Native helper compilation needs the MSVC toolchain. On this machine:
   `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\...` with MSVC 19.44.
2. CMake is NOT on PATH. It ships inside VS Build Tools at:
   `C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin`
   Add it to PATH before any cmake-using build:
   `export PATH="/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin:$PATH"`
3. `scripts/build-whisper-runtime.mjs` `findCmake()` only probes
   `C:\Program Files\Microsoft Visual Studio\...` — it never checks the `(x86)` path used by
   Build Tools-only installs. Pre-existing bug: on such systems it reports "CMake not found".
   Workaround: put the (x86) cmake dir on PATH. (Also accepts `WHISPER_RUNTIME_ALLOW_MISSING=1`
   to skip auto-caption support.)
4. The same script downloads whisper.cpp, then calls `tar -xzf` — but `execFileSync("tar",...)`
   resolves to Windows' system `bsdtar`, which fails on the project path ("Cannot connect to C:").
   Workaround: pre-extract into the expected dir so `ensureSourceTree()` short-circuits:
   ```
   cd .tmp/whisper-runtime && tar -xzf v1.8.4.tar.gz -C src-v1.8.4
   ```
   (git-bash tar reads the archive fine; the Windows bsdtar path handling is the problem.)
5. The dev-mode app uses an ISOLATED data dir: `C:\Users\nmz\AppData\Roaming\Recordly-dev`
   (note the `-dev` suffix), separate from the installed/released app's
   `C:\Users\nmz\AppData\Roaming\Recordly`. Running from source will not touch released-app
   recordings/settings.

### Uninstalling the released app (Windows)

- Per-user NSIS install lives at `C:\Users\nmz\AppData\Local\Programs\Recordly`
  (case-insensitive = also listed as `recordly`).
- Run the bundled `Uninstall Recordly.exe` silently:
  `powershell -NoProfile -Command "Start-Process -FilePath '.\Uninstall Recordly.exe' -ArgumentList '/S' -Wait"`
- The uninstaller deletes the install dir + start-menu shortcut but preserves user data in
  `C:\Users\nmz\AppData\Roaming\Recordly` (recordings, settings) — call that out to users.
- After uninstalling, an empty `Programs\Recordly` dir may remain; `rmdir` it.

## Dev-run lifecycle

- `npm run dev` blocks and is tied to its shell. To background it, use nohup + log file;
  on next launch it reconnects to the existing window/vite process.
- Kill the process tree to stop; relaunch with `npm run dev` (CMake PATH only needed again
  if rebuilding whisper).
- No auto-update in dev (that's installer-only via electron-updater).

## Export codec & bitrate (durable rules)

Recordly supports persistent custom MP4 bitrate control and opt-in H.265/HEVC export with
Auto/Hardware/CPU encoder policies. H.264 + Auto remains the default/unchanged compatibility
path. These rules are durable � preserved across refactors:

- H.264 + Auto is the compatibility/default path. It preserves the existing
  WebCodecs/native static-layout/Breeze routing and the automatic bitrate heuristic. Do not
  disturb it.
- Explicit H.264 Hardware/CPU requests continue to use the native FFmpeg `rawvideo` route.
  This does not change the H.264 + Auto compatibility path.
- Eligible HEVC Auto/Hardware native-layout jobs may use the dedicated codec-aware NVIDIA CUDA
  compositor. It performs GPU decode, compose, and encode with NV12 surfaces and `hevc_nvenc`.
  HEVC must never enter the existing H.264-only D3D11, `gpu-export-probe`, or legacy
  `nvidia-cuda-compositor` assumptions; the generalized codec-aware compositor is a distinct
  safe route.
- The native-layout CUDA source contract remains a decodable H.264/AVC source in a supported
  MP4, M4V, or MOV container. Other source codecs or containers are normalized to a validated
  H.264/yuv420p proxy before the native graph. Source preparation constraints do not change
  the requested output codec.
- The codec-aware CUDA route requires a successful Windows/NVIDIA runtime probe and a helper
  built with CMake 3.24+, MSVC/C++17, CUDA Toolkit with CUDA language support, and the
  NVIDIA Video Codec SDK samples (`NvCodec`, including `nvcuvid.lib`). Build it with
  `npm run build:nvidia-cuda-compositor`; set `RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT` when
  the SDK is not at `.tmp/video-sdk-samples`. Missing requirements make this route
  unavailable; do not substitute an H.264-only GPU probe or compositor.
- After any required source-proxy preparation, the native FFmpeg/CUDA graph keeps video pixels
  on the GPU through decode, NV12 composition, and encode. It must not require renderer
  readback of video pixels.
- HEVC CPU remains native FFmpeg `rawvideo` with `libx265`. Unsupported canvas-only effects,
  an ineligible source/layout, or an unavailable CUDA route use renderer raw frames. HEVC
  Auto may try codec-aware CUDA hardware (`hevc_nvenc`), then native rawvideo hardware, then
  CPU according to the encoder resolution rules. Hardware never silently falls back to CPU;
  CPU uses the software encoder only.
- On Windows, `hevc_nvenc` is the preferred HEVC hardware encoder for the CUDA route and when
  native raw probing succeeds; other raw hardware candidates are `hevc_qsv`, `hevc_amf`, and
  `hevc_mf`. macOS uses `hevc_videotoolbox`. Linux uses `hevc_nvenc`/`hevc_qsv`.
- `libx265` is the CPU HEVC fallback; `libx264` is the H.264 CPU encoder.
- Encoder resolution: Auto = try eligible GPU hardware, then native raw hardware candidates,
  then CPU; Hardware = hardware candidates only and MUST NOT silently fall back to CPU (fails
  with an actionable error); CPU = software encoder only.
- Persist only high-level user preferences (codec enum, encoder preference, bitrate mode,
  custom Mbps), NEVER derived bitrate-in-bps, NEVER WebCodecs codec strings (avc1.*), NEVER
  FFmpeg encoder names (libx265/hevc_nvenc).
- HEVC output is export-only; playback/source decoding/preview are intentionally unchanged. Do
  not route HEVC through the WebCodecs AVC muxer, the H.264 stream-copy path, or any legacy
  H.264-only native-layout route.
- Key integration points (optional but helpful): src/lib/exporter/types.ts
  (ExportSettings/ExportConfig contract + EXPORT_BITRATE_* constants),
  src/lib/exporter/exportBitrate.ts (resolveExportBitrate),
  src/components/video-editor/mp4ExportRouting.ts (codec-aware route and needsNativeRawFrame),
  src/lib/exporter/modernVideoExporter.ts (native-layout/CUDA selection and raw fallback),
  electron/ipc/nativeVideoExport.ts (getNativeEncoderCandidates /
  buildNativeVideoExportArgs), electron/ipc/export/nativeStaticLayoutRoutePlan.ts
  (codec-aware native-layout route selection), and electron/ipc/export/native-video.ts
  (source proxy preparation, CUDA route, and resolveNativeVideoEncoder).

## Native raw-frame transport (durable rules)

- H.264 + Auto remains the compatibility path: WebCodecs/Annex-B transport and its
  existing routing are unchanged.
- HEVC is not universally a renderer-raw job. Eligible Auto/Hardware native-layout jobs may
  use the distinct codec-aware NVIDIA CUDA compositor. Renderer raw frames are used for HEVC
  CPU, native raw hardware fallback, unsupported canvas-only effects, and unavailable or
  ineligible CUDA routes. HEVC must not use the H.264 WebCodecs/Annex-B path or any legacy
  H.264-only native static-layout compositor.
- The preferred internal renderer-raw transport is a negotiated native-frame `MessagePort`
  stream. The stream has an explicit protocol/version, sequence ordering, fixed-size frame
  validation, acknowledgements, and settlement for cancellation, errors, and port closure.
  Byte and frame queues are bounded to provide backpressure; producers must not grow either
  queue without limit.
- Electron 43 may fail to deliver transferable `ArrayBuffer` values through
  `MessagePortMain`. The cloned `ipcRenderer.send` path remains the safe fallback when
  transferable delivery is unavailable or fails.
- Transport metrics must distinguish transferable-stream traffic from cloned-IPC traffic.
  They are diagnostic only and must not claim physical zero-copy unless that behavior has been
  measured.
- Renderer raw RGBA frames are canonical top-down. Renderer and FFmpeg integration must not
  add duplicate vertical flips. The CUDA compositor's internal NV12 surfaces are not a direct
  canvas transport contract.
- Transport mode, transport bytes, buffer counts, and selected encoder names are diagnostic
  values only. Never persist them as user settings; transport details are not persisted.
- The upstream target is a generic Electron transferable-`ArrayBuffer`
  renderer-to-main binary IPC / `MessagePortMain` transferable-resource fix. Use
  `scripts/benchmark-native-frame-transport.mjs` and
  `docs/upstream/electron-transferable-frame-ipc.md` to support that target.
- Direct canvas-to-NV12 transport is intentionally not assumed until runtime support is proven;
  renderer raw RGBA remains the canonical fallback contract.

## Native overlay-layer composition (durable rules)

- The FFmpeg CUDA static-layout route owns source-video decode, layout composition, and output
  encoding. Browser code must not send source-video RGBA frames for this route. The current
  bundled FFmpeg build cannot alpha-compose RGBA/YUVA overlays with `overlay_cuda`; effectful
  overlay jobs therefore use FFmpeg's CPU alpha overlay after CUDA decode/scale and before
  NVENC, while effect-free jobs retain the existing all-GPU graph.
- Browser export code may prepare temporary transparent RGBA overlay sidecars for cursor,
  captions, annotations, webcam, and frame visuals. Overlay sidecars are export-session data,
  are never persisted, and must be deleted after the native export attempt.
- Overlay layers are ordered explicitly and must match the output dimensions, frame rate, and
  duration. Alpha and z-order must be preserved; a native command must never omit a requested
  layer silently.
- The generalized NVIDIA CUDA compositor (run-mp4-pipeline.mjs -> main.cu) ALSO accepts the
  renderer-prepared RGBA overlay sidecar through an `--overlay-manifest` JSON (layers with
  path/x/y/width/height/frameCount). It streams the raw RGBA frames with a double-buffered
  prefetch (bounded: two device buffers + one pinned host buffer per layer) and alpha-blends
  them top-down ON TOP of the composed, blurred video — so cursor/captions/annotations stay
  sharp. When overlay layers are present the renderer bakes cursor+webcam into the sidecar,
  so the CUDA route must NOT also draw the native cursor atlas for that export.
- Temporal zoom motion blur is implemented in the CUDA compositor from the renderer-resolved
  plan (`--temporal-blur-sample-count N --temporal-blur-shutter-fraction F
  --temporal-blur-weight-power P`, mirroring src/lib/exporter/temporalMotionBlur.ts). Each
  output frame is re-composited at the symmetric cos-tapered shutter sample offsets with the
  camera transform interpolated from the zoom telemetry, then accumulated into one bounded
  scratch NV12 buffer. Temporal blur replaces the spatial blur for that frame (the renderer's
  temporal path also disables the velocity filters). If the CUDA route is unavailable,
  temporal blur stays an explicit non-duplicated skip (`unsupported-temporal-motion-blur`)
  rather than being silently dropped by the FFmpeg overlay route.
- Blur annotations, extension render hooks, and timeline mappings remain raw-fallback cases
  until their native representation is implemented and validated. A failed or incomplete
  overlay preparation must return to the renderer raw-frame route.
- The custom SDK NVENC compositor is optional for effectful exports. The validated FFmpeg CUDA
  path remains authoritative when the SDK wrapper cannot initialize on a supported NVIDIA
  system. H.264 + Auto compatibility routing remains unchanged.

## NVIDIA CUDA compositor stream sync + NVENC capability rules (durable)

- All composite/zoom-blur/overlay kernels run on a single non-blocking compositor stream
  (`cudaStreamNonBlocking`). There is exactly ONE per-frame synchronization
  (`cudaStreamSynchronize(copyStream)`) before NVENC's synchronous input copy; there must
  never be a per-frame global `cudaDeviceSynchronize` in the encode loop (the only remaining
  `cudaDeviceSynchronize` is the one-time prewarm). The CUDA primary context
  (`cuDevicePrimaryCtxRetain`) is used so the CUDA runtime allocations and NVENC share one
  context; it is released with `cuDevicePrimaryCtxRelease`, never `cuCtxDestroy`.
- NVENC is configured minimal-first from a capability probe, never from the (often empty)
  preset config returned by `nvEncGetEncodePresetConfig`: explicit encodeGUID/presetGUID,
  tuningInfo (P1/P4/P6 presets are required on Blackwell and must pair with
  `NV_ENC_TUNING_INFO_HIGH_QUALITY`), chromaFormatIDC=1 for NV12, VBR when the device lists it
  (CBR fallback), custom VBV/AQ only when the caps report them. The build uses the FFmpeg
  nv-codec-headers nvEncodeAPI.h 13.x (pinned tag n13.0.19.1), NOT the legacy 8.1 header in
  the Video Codec SDK samples checkout, which fails with NV_ENC_ERR_INVALID_PARAM (error 8)
  on current drivers; scripts/build-nvidia-cuda-compositor.mjs stages the headers and patches
  the samples NvEncoder.cpp for API-13 compatibility.
- Capability/version diagnostics (deviceName, driver/CUDA/SDK versions, compute capability,
  per-codec support, RC modes, custom VBV, async, temporal AQ, WxH/MB-per-sec caps) are
  reported in the summary `nvencDiagnostics` and in the failure JSON (`noCpuFallback:true`).
  The compositor never claims a codec, rate-control mode, AQ, or VBV feature the probe or
  live-encoder caps did not confirm (`rcModeUsed`/`customVbvUsed`/`aqUsed` show what was
  applied). A failed CUDA helper must not silently route zoom-blur-with-overlay or temporal
  blur through CPU FFmpeg; the renderer rejects non-CUDA result routes and native-video.ts
  throws when those effects are requested but CUDA cannot run.
- Stage metrics (decode, overlay upload, composite GPU, zoom blur GPU, overlay blend GPU,
  NVENC) are reported in the summary and PROGRESS intervals so the bottleneck can be proven
  rather than assumed. Renderer-reported FPS is only labeled native when the helper measured
  it; the stale native FPS is cleared when a static-layout attempt falls back to raw frames.
- Strict HEVC Hardware policy (durable): when `exportEncoderPreference === "hardware"` with
  HEVC, the generalized NVIDIA CUDA compositor is the ONLY acceptable route. Any static-layout
  skip reason, CUDA capability/IPC failure, route mismatch, helper failure, or post-validation
  failure MUST hard-fail the export with an actionable error (including the first skip reason
  and `noCpuFallback:true`) and MUST NOT fall back to the renderer raw frame path
  (WebGPU/WebGL -> FFmpeg hevc_nvenc), Breeze, or CPU. The cursor atlas is only required when
  the cursor is NOT baked into the transparent overlay sidecar; a missing atlas must never
  skip the CUDA route for overlay exports (this previously forced the slow ~17 FPS renderer
  raw path). HEVC Auto and H.264 Auto keep their existing fallback behavior.
- Decision observability: every static-layout decision logs `[VideoExporter] Native
  static-layout decision` (codec/preference/experimental flags, canUseNativeGpuStaticLayout,
  shouldTry, shouldDefer), `[native-export] NVIDIA CUDA availability` (available/skipReason/
  hasNvidiaGpu/hasWrapper), `[VideoExporter] Native static layout skipped|selected`
  (reason + route + flags), and the strict-policy guards log the skip reasons before throwing.
