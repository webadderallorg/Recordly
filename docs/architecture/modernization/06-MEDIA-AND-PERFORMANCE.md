# 06 — Media and Performance

> Defines the recording architecture, export pipeline, media processing,
> performance targets, and profiling strategy.
>
> **Master reference:** `00-MASTER-ARCHITECTURE.md` Section 5.
> **Platform engines:** `04-WINDOWS-AND-MACOS.md`.
> **Web pipeline:** `05-WEB-AND-MOBILE.md`.

---

## 1. Current Media Pipeline Analysis

### 1.1 Recording Pipeline (GRAFT-verified)

The recording pipeline involves multiple native processes coordinated by
the Electron main process:

| Component                      | Location                              | LOC   | Relations |
|--------------------------------|---------------------------------------|-------|-----------|
| `useScreenRecorder.ts`         | `src/hooks/`                          | 2,461 | 31 symbols |
| `recording/windows.ts`         | `electron/ipc/recording/`             | —     | WGC/DXGI orchestration |
| `recording/mac.ts`             | `electron/ipc/recording/`             | —     | SCK orchestration |
| `wgc-capture` sidecar          | `electron/native/wgc-capture/`        | 1,200 | C++ |
| `windows-capture` sidecar      | `electron/native/windows-capture/`    | 700   | C++ |
| `ScreenCaptureKitRecorder`     | `electron/native/`                    | 1,031 | Swift |
| `cursor-monitor` sidecar       | `electron/native/cursor-monitor/`     | 60    | C++ |
| `cursor/telemetry.ts`          | `electron/ipc/cursor/`                | —     | JS ring buffer |
| `cursor/monitor.ts`            | `electron/ipc/cursor/`                | —     | Process management |
| `cursor/bounds.ts`             | `electron/ipc/cursor/`                | —     | Window bounds |

### 1.2 Export Pipeline (GRAFT-verified)

| Component                      | Location                              | Relations |
|--------------------------------|---------------------------------------|-----------|
| `native-video.ts`              | `electron/ipc/export/`                | 653 (critical) |
| `modernFrameRenderer.ts`       | `src/lib/exporter/`                   | 534 (critical) |
| `modernVideoExporter.ts`       | `src/lib/exporter/`                   | 482 (high) |
| `exportStream.ts`              | `electron/ipc/export/`                | Export stream mgmt |
| `nativeStaticLayoutRoutePlan.ts` | `electron/ipc/export/`              | Pipeline routing |
| `nvidia-cuda-compositor`       | `electron/native/`                    | CUDA compositing |
| `gpu-export-probe`             | `electron/native/`                    | GPU detection |

### 1.3 Export Pipeline Decision Tree (existing)

```
ModernVideoExporter.export()
    │
    ├── Load video metadata (probe)
    ├── Build audio plan
    ├── Check native static layout eligibility
    │
    ├── Static layout eligible? ──────────────────────────────────────────┐
    │   ├── NVIDIA GPU + CUDA opt-in? → nvidia-cuda-compositor sidecar   │
    │   ├── D3D11 GPU? → gpu-export-probe (D3D11 compositor mode)        │
    │   └── CPU fallback → FFmpeg with filter_complex                    │
    │                                                                     │
    └── Complex timeline (clips, speed changes, annotations)?            │
        └── Frame-by-frame pipeline:                                      │
            ├── FrameRenderer (PixiJS) renders each frame                 │
            ├── WebCodecs VideoEncoder encodes H.264                     │
            ├── Frames sent to Electron main process via IPC             │
            ├── FFmpeg muxes video + audio                               │
            └── Output: .mp4 or .gif                                     │
                                                                          │
        ◄─────────────────────────────────────────────────────────────────┘
```

---

## 2. Recording Architecture (Modernized)

### 2.1 Common Recording Lifecycle

```typescript
// packages/domain/src/types/recording.ts

export type RecordingState =
  | "idle"
  | "preparing"
  | "countdown"
  | "recording"
  | "paused"
  | "finalizing"
  | "complete"
  | "error";

export interface RecordingSession {
  id: string;
  state: RecordingState;
  startedAt?: number;
  duration: number;
  sourceId: string;
  sourceType: "screen" | "window" | "region";
  microphoneEnabled: boolean;
  systemAudioEnabled: boolean;
  webcamEnabled: boolean;
}
```

### 2.2 Platform-Specific Capture

| Platform | Capture Method             | Audio Method          | Cursor Method        |
|----------|----------------------------|-----------------------|----------------------|
| Windows  | WGC sidecar (primary)      | WASAPI loopback (inline) | cursor-monitor sidecar |
|          | DXGI sidecar (fallback)    | WASAPI loopback       | cursor-monitor       |
| macOS    | SCK sidecar                | CoreAudio (inline)    | CGEvent tap          |
| Web      | `getDisplayMedia`          | DisplayMedia audio    | PointerEvent listener|
| Mobile   | Not available              | Not available         | Not available        |

### 2.3 Audio/Video Synchronization

Current synchronization mechanism (from `wgc-capture/src/main.cpp`):

1. **Companion audio metadata:** Each recording produces a `.wav.json` file
   with `startDelayMs` — the offset between video and audio start times.
2. **QPC timestamps:** Video frames use `QueryPerformanceCounter` for
   nanosecond-precision timestamps.
3. **Pause intervals:** Open/close pause events tracked with timestamps,
   accumulated offset subtracted from presentation times.

This mechanism must be preserved in the Tauri migration. The sidecar approach
automatically preserves it since the same C++ code runs unchanged.

---

## 3. Export Architecture (Modernized)

### 3.1 Export Pipeline Routing

The existing `ModernVideoExporter` already contains the routing logic.
The modernization preserves this logic and adapts the IPC layer:

| Route                    | Trigger Condition                      | Platform      |
|--------------------------|----------------------------------------|---------------|
| Native static layout     | No annotations, simple zoom, no speed  | Desktop only  |
| CUDA compositor          | NVIDIA GPU + user opt-in               | Windows only  |
| D3D11 compositor         | Non-NVIDIA GPU with D3D11              | Windows only  |
| Frame-by-frame (native)  | Complex effects, desktop               | Desktop       |
| Frame-by-frame (web)     | All exports on web                     | Web           |
| Cloud export             | Mobile devices                         | Mobile (future)|

### 3.2 Preserving the ModernVideoExporter

The `ModernVideoExporter` (3,787 LOC, 482 relations) is the most complex
single class in the codebase. It should NOT be rewritten but rather:

1. **Extract platform-specific IPC** into the `ExportAdapter` interface.
2. **Keep the rendering logic** in `packages/editor/src/exporter/`.
3. **Keep FrameRenderer** (3,339 LOC) in `packages/editor/src/exporter/`.
4. **Replace `window.electronAPI.*` calls** with `PlatformAdapter.export.*`.

### 3.3 Memory Management

Current memory concerns:

| Issue                                 | Current Impact           | Mitigation                  |
|---------------------------------------|--------------------------|-----------------------------|
| In-memory MediaRecorder blobs (web)   | V8 heap pressure         | Stream to disk (desktop)    |
| PixiJS texture allocation per frame   | GPU memory pressure      | Reuse textures              |
| WebCodecs encoder queue               | Back-pressure needed     | `encodeQueueSize` monitoring|
| FFmpeg stdin pipe buffering           | Backpressure via drain   | Already implemented         |
| Web recording memory limit            | ~2GB browser limit       | Enforce max recording time  |

---

## 4. Audio Processing

### 4.1 Audio Pipeline Components

| Component                     | Location                              | Purpose               |
|-------------------------------|---------------------------------------|------------------------|
| `audioEncoder.ts`             | `src/lib/exporter/`                   | WebCodecs audio encode |
| `audioMediaProcessor.ts`      | `src/lib/exporter/`                   | Audio decode/process   |
| `audioRoutingEngine.ts`       | `src/lib/exporter/`                   | Audio track routing    |
| `audioTimelineProcessor.ts`   | `src/lib/exporter/`                   | Timeline audio sync    |
| `offlineAudioProcessor.ts`    | `src/lib/exporter/`                   | Offline rendering      |
| `sourceAudioFallback.ts`      | `src/lib/exporter/`                   | Audio source fallback  |
| `waveform/WaveformGenerator.ts` | `src/components/video-editor/audio/` | Waveform visualization |
| WASAPI loopback (C++)         | `electron/native/wgc-capture/`        | System audio capture   |
| Companion audio metadata      | Generated by capture sidecars         | A/V sync               |

### 4.2 Audio Synchronization

```
Recording produces:
  video.mp4          — H.264 video (from WGC/SCK/DXGI)
  video.wav.json     — { startDelayMs: N, pauseIntervals: [...] }
  microphone.webm    — MediaRecorder output (browser API)

Export resolves audio by:
  1. Read companion metadata for system audio offset
  2. Align microphone track using startDelayMs
  3. Apply clip speed changes to audio segments
  4. Mix system audio + microphone using FFmpeg filtergraph or Web Audio
  5. Mux final audio into output container
```

---

## 5. Performance Targets

### 5.1 Proposed Targets (require baseline measurement)

| Metric                        | Target           | Measurement Method              |
|-------------------------------|------------------|---------------------------------|
| Cold startup (desktop)        | < 2s             | Time from launch to UI ready    |
| Cold startup (web)            | < 3s             | Time from navigation to UI ready |
| Idle CPU (desktop)            | < 1%             | Process Monitor idle measurement |
| Idle CPU (web)                | < 0.5%           | DevTools Performance Monitor    |
| Recording CPU (desktop)       | < 5-8%           | During 1080p30 recording        |
| Recording CPU (web)           | < 15%            | During 720p30 recording         |
| Memory idle (desktop)         | < 100 MB         | Process working set              |
| Memory idle (web)             | < 80 MB          | Chrome task manager              |
| Memory recording (desktop)    | < 200 MB         | During active recording          |
| Editor preview FPS            | >= 30 fps        | PixiJS render loop               |
| Timeline scrub latency        | < 50 ms          | Time from input to frame render  |
| Export speed (GPU)             | >= 2x realtime   | For 1080p30 static layout        |
| Export speed (CPU + WebCodecs) | >= 0.5x realtime | For 1080p30 frame-by-frame      |
| Binary size (desktop)         | < 50 MB          | installer package size            |
| Binary size (web)             | < 5 MB           | gzipped transfer size             |

### 5.2 Current Bottlenecks (identified from GRAFT analysis)

| Bottleneck                                    | Evidence                           | Severity |
|-----------------------------------------------|-------------------------------------|----------|
| `modernFrameRenderer.ts` (534 relations)      | Complex compositing every frame     | High     |
| Audio level meter 60Hz React re-renders       | `useAudioLevelMeter.ts:L48-L88`   | Medium   |
| `currentTime` in root React state             | `useEditorUiState.ts:L20-L120`    | Medium   |
| 200k float peak sorting for waveform          | `WaveformGenerator.ts:L100-L135`   | Medium   |
| `native-video.ts` (653 relations)             | Export orchestration complexity     | High     |
| IPC serialization for frame data              | Frame bytes cross process boundary  | Medium   |

### 5.3 Optimizations Identified in TAURI_MIGRATION_PLAN

The existing migration plan identifies these specific optimizations:

1. **Stream chunks to disk** instead of V8 heap blob accumulation.
2. **O(1) ring buffer** for cursor telemetry instead of `Array.shift()`.
3. **Direct Win32 `ShowCursor()`** instead of `spawnSync(powershell)`.
4. **Event-driven WASAPI** instead of `Sleep()` polling.
5. **Direct OS queries** for window bounds instead of child process spawning.
6. **Offload waveform peak sorting** to Rust.
7. **Decouple `currentTime`** from root React state.

These should be evaluated individually for actual impact before implementation.

---

## 6. Profiling Strategy

### 6.1 Desktop Profiling

| Tool                          | What to Measure                        |
|-------------------------------|----------------------------------------|
| Windows Performance Analyzer  | CPU, GPU, disk I/O during recording    |
| Rust `tracing` + `tracing-chrome` | Tauri command latency, sidecar timing |
| Chrome DevTools (via Tauri)   | React render counts, JS heap           |
| PixiJS Stats                  | FPS, draw calls, texture count         |
| `nvidia-smi`                  | GPU utilization during CUDA export     |

### 6.2 Web Profiling

| Tool                          | What to Measure                        |
|-------------------------------|----------------------------------------|
| Chrome DevTools Performance   | CPU, memory, layout shifts             |
| Lighthouse                    | Load time, TTI, bundle size            |
| WebCodecs metrics             | Encode queue depth, frame drop rate    |
| `performance.measure()`       | Custom timing marks                    |

### 6.3 Regression Prevention

1. **Performance test suite:** Automated benchmarks for:
   - Startup time.
   - Editor preview FPS with standard test project.
   - Export time for standard test recording.
   - Memory usage during 5-minute recording.
2. **CI performance budget:** Fail build if bundle size exceeds budget.
3. **Benchmark scripts:** Extend existing `benchmark-export-queues.mjs`.

---

## 7. GPU Utilization

### 7.1 Windows GPU Pipeline

```
D3D11 Device → Create textures
    │
    ├── Source video texture (D3D11_USAGE_DEFAULT)
    ├── Webcam overlay texture
    ├── Cursor overlay texture
    └── Output composition texture
    │
    ▼
Shader pipeline (vertex + pixel shaders)
    ├── Scale/crop source
    ├── Apply zoom transform
    ├── Composite webcam overlay
    ├── Draw cursor with click effects
    └── Write to output surface
    │
    ▼
Media Foundation Sink Writer → H.264 encoded output
```

### 7.2 CUDA/NVENC Pipeline

```
CUDA Kernels:
    ├── cu_composite_frame()  — scale + crop + padding
    ├── cu_zoom_transform()   — viewport zoom interpolation
    ├── cu_cursor_overlay()   — cursor sprite compositing
    └── cu_webcam_blend()     — webcam overlay blending
    │
    ▼
NVENC Encoder → H.264 output with hardware encoding
```

### 7.3 Web GPU (Future)

WebGPU is not currently used but could accelerate:
- PixiJS rendering (already uses WebGL).
- Video frame compositing.
- Not a priority for MVP.

---

## 8. Encoding and Container Formats

| Format    | Desktop          | Web              | Mobile           |
|-----------|------------------|------------------|------------------|
| H.264/MP4 | FFmpeg / NVENC   | WebCodecs        | Cloud or none    |
| VP9/WebM  | FFmpeg           | WebCodecs        | Not supported    |
| GIF       | gif.js           | gif.js           | Not supported    |
| ProRes    | FFmpeg (macOS)   | Not supported    | Not supported    |

---

## 9. Buffering and Streaming Strategy

### 9.1 Recording Buffering

| Platform | Strategy                                               |
|----------|--------------------------------------------------------|
| Desktop  | Sidecar writes directly to disk. No in-memory buffering.|
| Web      | MediaRecorder chunks in memory. Limit recording time.   |

### 9.2 Export Buffering

| Pipeline         | Strategy                                              |
|------------------|-------------------------------------------------------|
| Native static    | Sidecar reads source, writes output. Minimal memory.  |
| Frame-by-frame   | Encoder queue with backpressure. Max 4 frames queued.  |
| Web export       | WebCodecs queue with encodeQueueSize monitoring.       |

---

## 10. Disk I/O

### 10.1 Recording Output Structure

```
recordings/
└── 2026-09-30-Recording/
    ├── video.mp4              # Primary recording (H.264)
    ├── video.wav.json         # Audio timing metadata
    ├── microphone.webm        # Microphone sidecar (optional)
    ├── webcam.webm            # Webcam overlay (optional)
    ├── cursor-telemetry.json  # Cursor position + click data
    └── thumbnail.jpg          # Preview thumbnail
```

### 10.2 Project File Format

```json
// project.recordly (JSON)
{
  "version": 1,
  "videoPath": "...",
  "duration": 30000,
  "clipRegions": [...],
  "zoomRegions": [...],
  "annotations": [...],
  "captions": [...],
  "webcamOverlay": {...},
  "cursorSettings": {...},
  "exportSettings": {...}
}
```

This format is platform-agnostic and can be opened on any platform.
