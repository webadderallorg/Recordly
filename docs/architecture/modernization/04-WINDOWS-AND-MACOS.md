# 04 — Windows and macOS Desktop Architecture

> Defines the Tauri v2 migration, native capture engines, and platform-specific
> desktop implementations.
>
> **Master reference:** `00-MASTER-ARCHITECTURE.md` Sections 3 and 4.
> **API contracts:** `03-SHARED-CORE-AND-API.md`.

---

## 1. Tauri v2 Migration

### 1.1 Why Tauri v2

| Factor             | Electron (Current)                 | Tauri v2 (Target)                    |
|--------------------|------------------------------------|--------------------------------------|
| Binary size        | ~150-200 MB                        | ~10-20 MB (uses system WebView)      |
| Memory idle        | ~150-300 MB (Chromium)             | ~30-60 MB (system WebView + Rust)    |
| IPC                | `ipcMain/ipcRenderer` + preload    | `invoke()` + Tauri commands (serde)  |
| Security           | Node.js in main process            | Rust (memory-safe), capability-based |
| Native APIs        | N-API or child process             | Direct Rust crate or sidecar binary  |
| Auto-update        | electron-updater                   | tauri-plugin-updater                 |
| Multi-window       | `BrowserWindow`                    | `WebviewWindowBuilder`               |

### 1.2 Migration Scope

| Electron Module                       | Tauri Replacement                      | Strategy      |
|---------------------------------------|----------------------------------------|---------------|
| `electron/main.ts` (869 LOC)         | `src-tauri/src/main.rs`               | Rewrite       |
| `electron/windows.ts` (1,174 LOC)    | `src-tauri/src/windows/`              | Rewrite       |
| `electron/preload.ts` (1,132 LOC)    | Eliminated (Tauri invoke)             | Remove        |
| `electron/ipc/handlers.ts`           | `src-tauri/src/commands/mod.rs`       | Rewrite       |
| `electron/appSettingsStore.ts`        | `tauri-plugin-store`                  | Replace       |
| `electron/updater.ts`                | `tauri-plugin-updater`                | Replace       |
| `electron/mediaServer.ts`            | Rust static file server or `asset://` | Evaluate      |
| `electron/gpuSwitches.ts`            | Command-line flags in `tauri.conf.json` | Adapt       |
| `electron/ipc/recording/`            | `src-tauri/src/commands/recording.rs` | Rewrite       |
| `electron/ipc/cursor/`               | `src-tauri/src/commands/cursor.rs`    | Rewrite       |
| `electron/ipc/export/`               | `src-tauri/src/commands/export.rs`    | Rewrite       |
| `electron/ipc/captions/`             | `src-tauri/src/commands/captions.rs`  | Rewrite       |
| `electron/ipc/project/`              | `src-tauri/src/commands/storage.rs`   | Rewrite       |
| `electron/ipc/providers/`            | `src-tauri/src/captions/providers.rs` | Rewrite       |
| `electron/ipc/ffmpeg/`               | `src-tauri/src/export/ffmpeg.rs`      | Rewrite       |

### 1.3 Tauri Configuration

```json
// apps/desktop/src-tauri/tauri.conf.json (outline)
{
  "identifier": "dev.recordly.app",
  "build": { "frontendDist": "../dist" },
  "app": {
    "windows": [
      { "label": "main", "title": "Recordly", "width": 380, "height": 240 },
      { "label": "editor", "title": "Recordly Editor", "width": 1280, "height": 800 }
    ],
    "security": {
      "capabilities": ["default", "recording", "export", "storage"]
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "dmg", "appimage"],
    "icon": ["icons/icon.ico", "icons/icon.icns", "icons/icon.png"]
  }
}
```

### 1.4 Capability-Based Permissions

```json
// apps/desktop/src-tauri/capabilities/recording.json
{
  "identifier": "recording",
  "description": "Screen recording permissions",
  "permissions": [
    "core:default",
    "shell:allow-execute",
    "fs:allow-read",
    "fs:allow-write",
    "process:allow-command"
  ]
}
```

---

## 2. Windows Native Engine

### 2.1 Current Windows Architecture

| Module                     | Language | LOC    | Purpose                           |
|----------------------------|----------|--------|-----------------------------------|
| `wgc-capture/`             | C++      | ~1,200 | Windows Graphics Capture (primary)|
| `windows-capture/`         | C++      | ~700   | DXGI capture (fallback)           |
| `cursor-monitor/`          | C++      | ~60    | Win32 cursor position hook        |
| `gpu-export-probe/`        | C++      | ~500   | GPU capability detection          |
| `nvidia-cuda-compositor/`  | CUDA     | ~500   | CUDA/NVENC video compositor       |

### 2.2 Sidecar Strategy

The existing C++ native modules are compiled as standalone executables that
communicate with the Electron main process via stdin/stdout JSON.

**Decision: Wrap as Tauri sidecars, do not rewrite in Rust.**

Rationale:
- The C++ modules are mature, tested, and functional.
- Rewriting in Rust provides minimal benefit since these are process-isolated.
- Tauri's sidecar system (`tauri-plugin-shell`) natively supports the
  stdin/stdout communication pattern already used.
- The existing `stdinListenerThread` pattern in each C++ binary already
  supports the "send JSON, receive JSON" protocol.

### 2.3 Windows Capture Pipeline

```
Tauri Command: start_recording
    │
    ▼
Rust Orchestrator (commands/recording.rs)
    │
    ├── Spawn sidecar: wgc-capture (primary)
    │   ├── WGC session (wgc_session.cpp)
    │   ├── Media Foundation encoder (mf_encoder.cpp)
    │   ├── WASAPI loopback audio (wasapi_loopback.cpp)
    │   └── Monitor resolution (monitor_utils.cpp)
    │
    ├── Fallback: windows-capture (DXGI)
    │   ├── DXGI session (dxgi_session.cpp)
    │   ├── MF encoder
    │   ├── WASAPI loopback
    │   └── Monitor utils
    │
    ├── Spawn sidecar: cursor-monitor
    │   └── Win32 GetCursorPos() hook
    │
    └── Output:
        ├── Video file (.mp4)
        ├── Companion audio timing JSON
        └── Cursor telemetry JSON
```

### 2.4 Windows GPU Export Pipeline

```
Rust Export Command
    │
    ├── Probe GPU: gpu-export-probe sidecar
    │   └── Returns: GPU vendor/model, NVENC support, D3D11 capabilities
    │
    ├── Route decision (static layout vs frame-by-frame)
    │
    ├── Static layout with NVIDIA GPU:
    │   └── nvidia-cuda-compositor sidecar
    │       ├── CUDA kernel compositing
    │       ├── NVENC H.264 encoding
    │       └── Cursor overlay, zoom, webcam
    │
    ├── Static layout with non-NVIDIA GPU:
    │   └── gpu-export-probe (D3D11 compositor mode)
    │       ├── D3D11 compositing
    │       ├── Media Foundation H.264 encoding
    │       └── Shader-based effects
    │
    └── Fallback: Frame-by-frame (PixiJS + WebCodecs in WebView)
        └── FFmpeg mux via Rust process supervision
```

### 2.5 Windows-Specific Tauri Features

- **Transparent HUD:** `WebviewWindowBuilder` with transparent background,
  Win32 `WS_EX_TRANSPARENT` for click-through via `SetWindowLong`.
- **System tray:** `tauri-plugin-tray` replaces Electron Tray.
- **Auto-start:** Registry entry via `tauri-plugin-autostart`.
- **Custom protocol:** `recordly://` deep link for auth callback.
- **Process priority:** `SetPriorityClass` for export sidecar processes.
- **Power guard:** `SetThreadExecutionState` during export.

---

## 3. macOS Native Engine

### 3.1 Current macOS Architecture

| Module                          | Language | LOC    | Purpose                     |
|---------------------------------|----------|--------|-----------------------------|
| `ScreenCaptureKitRecorder.swift`| Swift    | ~1,031 | Screen capture (SCStream)   |
| `ScreenCaptureKitWindowList.swift`| Swift  | ~100   | Window enumeration          |
| `NativeCursorMonitor.swift`     | Swift    | ~80    | Cursor tracking             |
| `SystemCursorAssets.swift`      | Swift    | ~50    | System cursor images        |

### 3.2 Sidecar Strategy (macOS)

**Decision: Wrap Swift executables as Tauri sidecars.**

The Swift `ScreenCaptureKitRecorder` is a standalone command-line tool
(`RecorderService` class) that:
1. Reads JSON config from command-line argument.
2. Uses SCStream for capture at 60fps.
3. Writes H.264/AAC to disk via AVAssetWriter.
4. Supports pause/resume via stdin commands.
5. Returns result JSON on stdout.

This protocol is already compatible with Tauri's sidecar model.

### 3.3 macOS Capture Pipeline

```
Tauri Command: start_recording
    │
    ▼
Rust Orchestrator (commands/recording.rs)
    │
    ├── Spawn sidecar: sck-recorder
    │   ├── ScreenCaptureKit (SCStream)
    │   ├── Screen/window/region capture at 60fps
    │   ├── Inline microphone + system audio capture
    │   ├── AVAssetWriter for H.264/AAC encoding
    │   └── Pause/resume via stdin
    │
    ├── Spawn sidecar: native-cursor-monitor (optional)
    │   └── CGEvent tap for cursor position
    │
    └── Output:
        ├── Video file (.mov)
        ├── Companion audio metadata
        └── Cursor telemetry
```

### 3.4 macOS-Specific Features

- **ScreenCaptureKit permissions:** `CGRequestScreenCaptureAccess()`.
  macOS 14+ requires TCC approval.
- **Hardened runtime:** Entitlements for audio input, screen capture.
- **Traffic lights:** Window title bar customization via
  `WebviewWindowBuilder::title_bar_style(TitleBarStyle::Overlay)`.
- **Dock icon:** Show/hide based on recording state.
- **Universal binary:** Build for both x64 and arm64 (M-series).
- **Notarization:** Required for distribution outside App Store.

---

## 4. Shared Desktop Architecture

### 4.1 Rust Core Structure

```
apps/desktop/src-tauri/src/
├── main.rs                  # Tauri builder, plugin registration
├── commands/
│   ├── mod.rs               # Command registration
│   ├── recording.rs         # Recording start/stop/pause/resume
│   ├── export.rs            # Export pipeline orchestration
│   ├── storage.rs           # Settings + project persistence
│   ├── cursor.rs            # Cursor telemetry management
│   ├── audio.rs             # Audio device enumeration
│   ├── captions.rs          # Whisper + cloud transcription
│   ├── window.rs            # Window creation and management
│   └── cloud.rs             # Cloud sharing upload
├── capture/
│   ├── orchestrator.rs      # Recording lifecycle management
│   ├── sidecar.rs           # Sidecar process spawning + monitoring
│   └── telemetry.rs         # Cursor telemetry ring buffer
├── export/
│   ├── pipeline.rs          # Export pipeline routing
│   ├── ffmpeg.rs            # FFmpeg binary resolution + execution
│   ├── gpu_probe.rs         # GPU capability detection
│   └── metrics.rs           # Export metrics collection
├── storage/
│   ├── settings.rs          # App settings via tauri-plugin-store
│   ├── project.rs           # Project file management
│   └── library.rs           # Recording library
├── windows/
│   ├── hud.rs               # HUD overlay management
│   ├── editor.rs            # Editor window management
│   └── tray.rs              # System tray
└── captions/
    ├── providers.rs         # Provider registry
    ├── whisper.rs            # Local whisper runtime
    └── cloud_provider.rs    # OpenAI/custom API provider
```

### 4.2 Rust Dependencies (Cargo.toml outline)

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "protocol-asset"] }
tauri-plugin-store = "2"
tauri-plugin-shell = "2"
tauri-plugin-updater = "2"
tauri-plugin-autostart = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
thiserror = "1"
tracing = "0.1"
tracing-subscriber = "0.3"

[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = ["Win32_UI_WindowsAndMessaging"] }
```

### 4.3 Recording Preferences

The existing `electron/ipc/settings/recordingPreferencesStore.ts` manages
recording preferences. In Tauri, this moves to `tauri-plugin-store`:

```rust
// storage/settings.rs
use tauri_plugin_store::StoreExt;

#[tauri::command]
async fn load_setting(app: tauri::AppHandle, key: String) -> Result<Value, Error> {
    let store = app.store("settings.json")?;
    Ok(store.get(&key).unwrap_or(Value::Null))
}
```

---

## 5. Native Permissions

### 5.1 Windows

| Permission                    | API                              | Handling          |
|-------------------------------|----------------------------------|-------------------|
| Screen capture                | Windows Graphics Capture (auto)  | Prompt on first use |
| Microphone                    | MediaCapture capability          | System prompt     |
| Camera (webcam)               | MediaCapture capability          | System prompt     |
| File system                   | Full access (desktop app)        | Unrestricted      |

### 5.2 macOS

| Permission                    | API                              | Handling          |
|-------------------------------|----------------------------------|-------------------|
| Screen recording              | `CGRequestScreenCaptureAccess`   | TCC prompt        |
| Microphone                    | `AVCaptureDevice.requestAccess`  | TCC prompt        |
| Camera                        | `AVCaptureDevice.requestAccess`  | TCC prompt        |
| Accessibility (input hooks)   | TCC accessibility permission     | TCC prompt        |
| File system                   | App sandbox entitlements          | Entitlements      |

---

## 6. Platform-Specific Implementation Phases

### Phase 1: Tauri Shell (Foundation)
- Create `apps/desktop/` with Tauri v2 scaffold.
- Implement window management (main, editor, HUD).
- Implement settings storage via `tauri-plugin-store`.
- Implement project file management.
- Get the React UI rendering in Tauri WebView.

### Phase 2: Recording Integration
- Port sidecar orchestration from `electron/ipc/recording/windows.ts`.
- Port `electron/ipc/recording/mac.ts` for macOS.
- Register sidecars in `tauri.conf.json`.
- Implement cursor tracking command.
- Verify recording quality matches Electron version.

### Phase 3: Export Integration
- Port native export pipeline from `electron/ipc/export/`.
- Port GPU probe and compositor sidecar management.
- Port FFmpeg process supervision.
- Verify export quality and performance.

### Phase 4: Caption Integration
- Port whisper runtime management.
- Port provider registry.
- Port cloud transcription (OpenAI, custom).

### Phase 5: Polish
- System tray.
- Auto-updater.
- Deep linking (recordly:// protocol).
- macOS notarization.
- Windows NSIS installer.
