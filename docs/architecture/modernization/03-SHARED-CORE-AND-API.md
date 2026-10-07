# 03 — Shared Core and API

> Defines the platform adapter interface, API contracts, data models,
> and boundary between shared and platform-specific code.
>
> **Master reference:** `00-MASTER-ARCHITECTURE.md` Sections 3.2, 5, and 7.

---

## 1. Platform Adapter Interface

The `PlatformAdapter` is the single abstraction between the shared UI and
platform-specific implementations. The editor and all shared components
import only from this interface, never from platform APIs directly.

### 1.1 Core Adapter Interface

```typescript
// packages/platform-api/src/adapter.ts

export interface PlatformAdapter {
  readonly platform: PlatformType;
  readonly capabilities: PlatformCapabilities;

  // Sub-adapters
  readonly recording: RecordingAdapter;
  readonly export: ExportAdapter;
  readonly storage: StorageAdapter;
  readonly cursor: CursorAdapter;
  readonly audio: AudioAdapter;
  readonly captions: CaptionAdapter;
  readonly window: WindowAdapter;
  readonly clipboard: ClipboardAdapter;
  readonly shell: ShellAdapter;
}

export type PlatformType = "desktop-windows" | "desktop-macos" | "web" | "ios" | "android";

export interface PlatformCapabilities {
  screenRecording: boolean;
  systemAudioCapture: boolean;
  microphoneCapture: boolean;
  cursorTracking: boolean;
  nativeOverlays: boolean;
  fileSystemAccess: boolean;
  gpuAcceleration: boolean;
  nativeExport: boolean;
  localWhisper: boolean;
  autoUpdater: boolean;
  multiWindow: boolean;
}
```

### 1.2 Recording Adapter

```typescript
// packages/platform-api/src/recording.ts

export interface RecordingAdapter {
  startRecording(config: RecordingConfig): Promise<RecordingSession>;
  stopRecording(sessionId: string): Promise<RecordingResult>;
  pauseRecording(sessionId: string): Promise<void>;
  resumeRecording(sessionId: string): Promise<void>;
  cancelRecording(sessionId: string): Promise<void>;
  getAvailableSources(): Promise<CaptureSource[]>;
  requestPermissions(): Promise<PermissionStatus>;
}

export interface RecordingConfig {
  sourceId: string;
  sourceType: "screen" | "window" | "region";
  microphoneEnabled: boolean;
  microphoneDeviceId?: string;
  systemAudioEnabled: boolean;
  webcamEnabled: boolean;
  webcamDeviceId?: string;
  videoBitsPerSecond: number;
  countdownDelay: number;
}

export interface RecordingSession {
  id: string;
  state: "recording" | "paused" | "finalizing";
}

export interface RecordingResult {
  videoPath: string;
  duration: number;
  companionAudioPath?: string;
  cursorTelemetryPath?: string;
  webcamPath?: string;
}
```

### 1.3 Export Adapter

```typescript
// packages/platform-api/src/export.ts

export interface ExportAdapter {
  getNativeExportCapabilities(): Promise<NativeExportCapabilities>;
  startNativeExport(options: NativeExportOptions): Promise<NativeExportSession>;
  writeFrame(sessionId: string, frame: Uint8Array): Promise<WriteResult>;
  finishExport(sessionId: string, audioOptions: AudioMuxOptions): Promise<ExportResult>;
  cancelExport(sessionId: string): Promise<void>;
  probeVideoMetadata(path: string): Promise<VideoMetadata>;
  getFFmpegPath(): Promise<string | null>;
  getFFprobePath(): Promise<string | null>;
  onExportProgress(callback: (progress: ExportProgress) => void): () => void;
}
```

### 1.4 Storage Adapter

```typescript
// packages/platform-api/src/storage.ts

export interface StorageAdapter {
  loadSetting<T>(key: string): T | null;
  saveSetting<T>(key: string, value: T): void;

  saveProject(path: string, data: ProjectData): Promise<void>;
  loadProject(path: string): Promise<ProjectData>;
  deleteProject(path: string): Promise<void>;
  listProjects(): Promise<ProjectEntry[]>;

  getRecordingsDirectory(): Promise<string>;
  getProjectsDirectory(): Promise<string>;
  getTempDirectory(): Promise<string>;

  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  openPath(path: string): Promise<void>;
  showSaveDialog(options: SaveDialogOptions): Promise<string | null>;
}
```

### 1.5 Cursor Adapter

```typescript
// packages/platform-api/src/cursor.ts

export interface CursorAdapter {
  startTracking(): Promise<void>;
  stopTracking(): Promise<void>;
  getCursorTelemetry(): Promise<CursorTelemetryPoint[]>;
  loadCursorTelemetryFromFile(path: string): Promise<CursorTelemetryPoint[]>;
  hideCursor(): void;
  showCursor(): void;
}
```

### 1.6 Audio Adapter

```typescript
// packages/platform-api/src/audio.ts

export interface AudioAdapter {
  getMicrophoneDevices(): Promise<AudioDevice[]>;
  getAudioLevel(stream: MediaStream): number;
  decodeAudioPeaks(path: string, sampleCount: number): Promise<Float32Array>;
}
```

### 1.7 Caption Adapter

```typescript
// packages/platform-api/src/captions.ts

export interface CaptionAdapter {
  generateCaptions(request: TranscriptionRequest): Promise<TranscriptionResult>;
  getAvailableProviders(): CaptionProvider[];
  getWhisperStatus(): Promise<WhisperStatus>;
  downloadWhisperModel(modelId: string): Promise<void>;
  onWhisperDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
}
```

### 1.8 Window Adapter

```typescript
// packages/platform-api/src/window.ts

export interface WindowAdapter {
  createEditorWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  setAlwaysOnTop(value: boolean): void;
  getWindowChrome(): Promise<WindowChrome>;
  onWindowChromeChanged(callback: (chrome: WindowChrome) => void): () => void;
  isFullscreen(): boolean;
  toggleFullscreen(): void;
}

export interface WindowChrome {
  trafficLightsVisible: boolean;
  titleBarStyle: "native" | "custom";
}
```

---

## 2. Tauri Command Contracts

Tauri commands map 1:1 to the platform adapter methods on desktop.
All commands use `tauri::command` macro with serde-serialized arguments.

### 2.1 Command Organization (Rust)

```
src-tauri/src/commands/
├── recording.rs      # start_recording, stop_recording, pause, resume, cancel
├── export.rs         # native_export_*, write_frame, finish_export
├── storage.rs        # load_setting, save_setting, project CRUD
├── cursor.rs         # start_tracking, stop_tracking, get_telemetry
├── audio.rs          # get_microphone_devices, decode_audio_peaks
├── captions.rs       # generate_captions, whisper_status, download_model
├── window.rs         # window management commands
└── mod.rs            # Command registration
```

### 2.2 Command Naming Convention

Tauri commands use `snake_case`. TypeScript invoke calls mirror this:

```typescript
// Desktop adapter implementation
await invoke("start_recording", { config });
await invoke("stop_recording", { sessionId });
await invoke("load_setting", { key });
```

### 2.3 Event Contracts

```typescript
// Events from Rust → Frontend (via tauri::Emitter)
export interface RecordingStateEvent {
  type: "recording-state";
  payload: { state: "started" | "paused" | "resumed" | "stopped"; sessionId: string };
}

export interface ExportProgressEvent {
  type: "export-progress";
  payload: ExportProgress;
}

export interface WhisperDownloadProgressEvent {
  type: "whisper-download-progress";
  payload: DownloadProgress;
}
```

---

## 3. Shared Data Models

All data models live in `packages/domain/`. The existing types from
`src/components/video-editor/types.ts` are the current source of truth.

### 3.1 Core Models (from existing code)

| Model                  | Source Location                           | Relations |
|------------------------|-------------------------------------------|-----------|
| `ClipRegion`           | `types.ts:L229-L247`                     | 21+ callers (getClipSourceStartMs) |
| `ZoomRegion`           | `types.ts:L10-L17`                       | High       |
| `CursorTelemetryPoint` | `types.ts:L19-L41`                       | Used by cursor renderer, export |
| `CursorVisualSettings` | `types.ts:L43-L56`                       | Editor state |
| `WebcamOverlaySettings`| `types.ts:L136-L157`                     | Editor state, export |
| `CaptionCue`           | `types.ts:L569-L575`                     | Caption system |
| `AutoCaptionSettings`  | `types.ts:L586-L601`                     | Caption generation |
| `AnnotationRegion`     | `types.ts:L477-L493`                     | Annotation system |
| `TrimRegion`           | `types.ts:L223-L227`                     | Clip/timeline |
| `AudioRegion`          | `types.ts:L559-L567`                     | Audio mixing |
| `CropRegion`           | `types.ts:L523-L528`                     | Video cropping |
| `Padding`              | `types.ts:L539-L545`                     | Layout padding |

### 3.2 LLM Configuration Models

Defined once in `packages/domain/`, used by both frontend and backend adapters:

| Model                  | Current Locations (duplicated)                       |
|------------------------|------------------------------------------------------|
| `LlmProviderConfig`   | `src/lib/llmSettings.ts` + `electron/ipc/providers/types.ts` |
| `TranscriptionRequest` | `electron/ipc/providers/types.ts`                   |
| `TranscriptionResult`  | `electron/ipc/providers/types.ts`                   |
| `TranscriptionProvider`| `electron/ipc/providers/types.ts`                   |

---

## 4. Error Handling Strategy

### 4.1 Error Format

```typescript
// packages/domain/src/types/errors.ts

export interface RecordlyError {
  code: string;           // Machine-readable error code
  message: string;        // Human-readable message
  details?: unknown;      // Structured error context
  recoverable: boolean;   // Whether the user can retry
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: RecordlyError };
```

### 4.2 Error Codes

| Code Prefix       | Domain                 | Example                         |
|--------------------|------------------------|---------------------------------|
| `REC_*`            | Recording              | `REC_PERMISSION_DENIED`         |
| `EXP_*`            | Export                 | `EXP_ENCODER_UNAVAILABLE`       |
| `STR_*`            | Storage                | `STR_FILE_NOT_FOUND`            |
| `CAP_*`            | Captions               | `CAP_WHISPER_MODEL_MISSING`     |
| `AUTH_*`            | Authentication         | `AUTH_SESSION_EXPIRED`          |
| `NET_*`            | Network                | `NET_UPLOAD_FAILED`             |

### 4.3 Tauri Error Mapping

Rust errors are serialized through Tauri's error handling:

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
pub enum RecordlyError {
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("File not found: {0}")]
    FileNotFound(String),
    // ...
}

impl From<RecordlyError> for tauri::InvokeError { ... }
```

---

## 5. Versioning Strategy

### 5.1 API Version

- Internal APIs between packages do not need versioning. They evolve together
  in the monorepo.
- The Tauri command API between TypeScript and Rust is internal and does not
  need semver.
- Only the cloud API (recordly-share worker) needs versioned endpoints.

### 5.2 Cloud API Versioning

The existing Cloudflare Worker API should use URL path versioning:

```
https://share.recordly.dev/api/v1/upload
https://share.recordly.dev/api/v1/share
```

---

## 6. Storage Interfaces

### 6.1 App Settings

| Platform | Implementation                      | Current                        |
|----------|-------------------------------------|--------------------------------|
| Desktop  | `tauri-plugin-store` + `RwLock`     | `electron/appSettingsStore.ts` |
| Web      | `localStorage`                      | N/A (new)                      |
| Mobile   | `AsyncStorage` or `tauri-plugin-store` | N/A (new)                  |

### 6.2 Project Storage

| Platform | Implementation                      | Current                          |
|----------|-------------------------------------|----------------------------------|
| Desktop  | File system (`.recordly` JSON files)| `electron/ipc/project/`          |
| Web      | OPFS + IndexedDB                    | N/A (new)                        |
| Mobile   | App document directory              | N/A (new)                        |

---

## 7. Platform Adapter Implementations

### 7.1 Desktop (Tauri)

```typescript
// apps/desktop/src/adapters/tauriAdapter.ts
import { invoke, listen } from "@tauri-apps/api/core";

export class TauriPlatformAdapter implements PlatformAdapter {
  readonly platform = process.platform === "darwin" ? "desktop-macos" : "desktop-windows";
  readonly capabilities = {
    screenRecording: true,
    systemAudioCapture: true,
    microphoneCapture: true,
    cursorTracking: true,
    nativeOverlays: true,
    fileSystemAccess: true,
    gpuAcceleration: true,
    nativeExport: true,
    localWhisper: true,
    autoUpdater: true,
    multiWindow: true,
  };
  // ... sub-adapter implementations using invoke()
}
```

### 7.2 Web (Browser)

```typescript
// apps/web/src/adapters/browserAdapter.ts

export class BrowserPlatformAdapter implements PlatformAdapter {
  readonly platform = "web";
  readonly capabilities = {
    screenRecording: true,      // via getDisplayMedia
    systemAudioCapture: true,   // via getDisplayMedia with audio
    microphoneCapture: true,    // via getUserMedia
    cursorTracking: false,      // CSS cursor only
    nativeOverlays: false,
    fileSystemAccess: "showSaveFilePicker" in window,
    gpuAcceleration: false,     // No CUDA/NVENC
    nativeExport: false,
    localWhisper: false,
    autoUpdater: false,
    multiWindow: false,
  };
  // ... sub-adapter implementations using browser APIs
}
```

### 7.3 Mobile (Future)

```typescript
// apps/mobile/src/adapters/mobileAdapter.ts

export class MobilePlatformAdapter implements PlatformAdapter {
  readonly platform = Platform.OS === "ios" ? "ios" : "android";
  readonly capabilities = {
    screenRecording: false,
    systemAudioCapture: false,
    microphoneCapture: true,
    cursorTracking: false,
    nativeOverlays: false,
    fileSystemAccess: true,
    gpuAcceleration: false,
    nativeExport: false,
    localWhisper: false,
    autoUpdater: false,
    multiWindow: false,
  };
}
```

---

## 8. Testing Strategy

### 8.1 Mock Adapter

```typescript
// packages/platform-api/src/testing/mockAdapter.ts

export function createMockAdapter(
  overrides?: Partial<PlatformAdapter>
): PlatformAdapter {
  return {
    platform: "web",
    capabilities: { ... },
    recording: createMockRecordingAdapter(),
    export: createMockExportAdapter(),
    // ...
    ...overrides,
  };
}
```

### 8.2 Contract Tests

Each adapter implementation must pass a shared contract test suite:

```typescript
// packages/platform-api/src/testing/adapterContract.test.ts

export function runAdapterContractTests(createAdapter: () => PlatformAdapter) {
  test("capabilities match declared platform", ...);
  test("storage round-trip", ...);
  test("error format compliance", ...);
}
```

---

## 9. Dependencies Between Modules

```
packages/domain       → (no dependencies)
packages/platform-api → domain (types only)
packages/i18n         → domain
packages/ui           → domain, i18n
packages/editor       → domain, ui, i18n, platform-api
apps/desktop          → all packages + @tauri-apps/*
apps/web              → all packages (browser APIs)
apps/mobile           → all packages (RN APIs)
```

No circular dependencies. `domain` and `platform-api` have no runtime
dependencies beyond TypeScript standard library.
