# 05 — Web and Mobile Architecture

> Defines the browser-based application, mobile product scope, and
> platform-specific limitations.
>
> **Master reference:** `00-MASTER-ARCHITECTURE.md` Sections 3 and 4.
> **API contracts:** `03-SHARED-CORE-AND-API.md`.

---

## 1. Web Browser Architecture

### 1.1 Application Scope

The web version of Recordly targets the following use cases:

1. **Video editing** — Full editor with timeline, effects, captions, zoom.
2. **Screen recording** — Via `getDisplayMedia` (limited compared to native).
3. **Export** — Via WebCodecs + MP4Box.js (no FFmpeg, no GPU compositor).
4. **Cloud projects** — Open/save projects to cloud storage.
5. **Sharing** — Direct integration with recordly-share service.

Features **not available** in the web version:

- Native HUD overlay during recording.
- System-level cursor tracking with click telemetry.
- Transparent click-through overlays.
- Window-specific capture (only full screen or browser tab).
- Local Whisper model execution.
- CUDA/NVENC hardware encoding.
- D3D11/Metal hardware compositing.
- Multi-window (no editor + HUD simultaneously).
- System tray.
- Auto-updater.
- File associations (`.recordly` project files).

### 1.2 Web Technology Stack

| Layer              | Technology                        | Notes                     |
|--------------------|-----------------------------------|---------------------------|
| Build              | Vite                              | Same as desktop           |
| UI Framework       | React 19                          | Shared packages           |
| Rendering          | PixiJS 8                          | Same as desktop           |
| Video decode       | WebCodecs `VideoDecoder`          | Already used in exporter  |
| Video encode       | WebCodecs `VideoEncoder`          | H.264 or VP9              |
| Muxing             | MP4Box.js                         | Already a dependency      |
| Audio decode       | Web Audio API                     | Already used              |
| Screen capture     | `getDisplayMedia`                 | Browser-native            |
| File access        | File System Access API / OPFS     | With fallback to download |
| Storage            | `localStorage` + IndexedDB       | Settings + project data   |
| WASM               | `web-demuxer.wasm`                | Already bundled           |

### 1.3 Web Application Entry Point

```typescript
// apps/web/src/main.tsx
import { BrowserPlatformAdapter } from "./adapters/browserAdapter";
import { PlatformContext } from "@recordly/platform-api";
import { App } from "@recordly/editor";

const adapter = new BrowserPlatformAdapter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <PlatformContext.Provider value={adapter}>
    <ThemeProvider>
      <I18nProvider>
        <App windowType="editor" />  {/* Web is always editor mode */}
      </I18nProvider>
    </ThemeProvider>
  </PlatformContext.Provider>
);
```

### 1.4 Web Recording Implementation

```typescript
// apps/web/src/adapters/browserRecording.ts

export class BrowserRecordingAdapter implements RecordingAdapter {
  async startRecording(config: RecordingConfig): Promise<RecordingSession> {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: config.systemAudioEnabled,
    });

    let micStream: MediaStream | null = null;
    if (config.microphoneEnabled) {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: config.microphoneDeviceId },
      });
    }

    // Use MediaRecorder for capture (existing pattern from useScreenRecorder.ts)
    const recorder = new MediaRecorder(displayStream, {
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: config.videoBitsPerSecond,
    });

    // Store chunks in memory (web has no disk streaming)
    // ...
    return { id: sessionId, state: "recording" };
  }
}
```

### 1.5 Web Export Implementation

The existing `ModernVideoExporter` already supports WebCodecs-based encoding
and MP4Box.js muxing. This is the primary export path for the web version.

```
Web Export Pipeline:
  PixiJS FrameRenderer → canvas frame
    → WebCodecs VideoEncoder (H.264 or VP9)
      → MP4Box.js muxer
        → File download or File System Access API save
```

Key differences from desktop:
- No FFmpeg subprocess for audio muxing.
- No native static layout GPU compositor.
- Audio must be mixed using Web Audio API + OfflineAudioContext.
- Export speed is slower (no hardware encoding).

### 1.6 Web Storage

```typescript
// apps/web/src/adapters/browserStorage.ts

export class BrowserStorageAdapter implements StorageAdapter {
  loadSetting<T>(key: string): T | null {
    const stored = localStorage.getItem(`recordly:${key}`);
    return stored ? JSON.parse(stored) : null;
  }

  saveSetting<T>(key: string, value: T): void {
    localStorage.setItem(`recordly:${key}`, JSON.stringify(value));
  }

  async saveProject(path: string, data: ProjectData): Promise<void> {
    // Use OPFS for project storage
    const root = await navigator.storage.getDirectory();
    const projectDir = await root.getDirectoryHandle("projects", { create: true });
    const file = await projectDir.getFileHandle(path, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
  }

  async showSaveDialog(): Promise<string | null> {
    if ("showSaveFilePicker" in window) {
      const handle = await window.showSaveFilePicker({
        suggestedName: "recording.mp4",
        types: [{ accept: { "video/mp4": [".mp4"] } }],
      });
      return handle.name;
    }
    return null; // Fallback to download
  }
}
```

---

## 2. Web Deployment

### 2.1 Build and Hosting

```
apps/web/
├── vite.config.ts      # Vite config (no Tauri/Electron plugins)
├── index.html          # SPA entry
└── dist/               # Static build output
```

Hosting options:
- **Static hosting:** Cloudflare Pages, Vercel, Netlify, or GitHub Pages.
- **No server required:** The web app is fully client-side.
- **CDN for assets:** Wallpapers and WASM files served from CDN.

### 2.2 Service Worker

Optional Progressive Web App (PWA) support:
- Offline capability for the editor (projects in OPFS).
- Cache static assets for faster loading.
- Not required for MVP.

---

## 3. Feature Compatibility Matrix

| Feature                          | Desktop | Web       | iOS    | Android |
|----------------------------------|---------|-----------|--------|---------|
| Screen recording (full)          | Yes     | Limited   | No     | No      |
| Window-specific capture          | Yes     | No        | No     | No      |
| System audio capture             | Yes     | Tab audio | No     | No      |
| Microphone capture               | Yes     | Yes       | Yes    | Yes     |
| Webcam capture                   | Yes     | Yes       | Yes    | Yes     |
| Native cursor tracking           | Yes     | No        | No     | No      |
| CSS cursor in recording          | N/A     | Yes       | N/A    | N/A     |
| HUD overlay                      | Yes     | No        | No     | No      |
| Video editor                     | Full    | Full      | Adapted| Adapted |
| Timeline                         | Full    | Full      | Simplified | Simplified |
| PixiJS preview rendering         | Yes     | Yes       | Yes*   | Yes*    |
| Captions (local Whisper)         | Yes     | No        | No     | No      |
| Captions (cloud API)             | Yes     | Yes       | Yes    | Yes     |
| GPU-accelerated export           | Yes     | No        | No     | No      |
| WebCodecs export                 | Yes     | Yes       | No     | No      |
| Cloud-based export               | No      | Optional  | Yes    | Yes     |
| Cloud sharing                    | Yes     | Yes       | Yes    | Yes     |
| Local project files              | Yes     | OPFS      | App FS | App FS  |
| Cloud project storage            | Yes     | Yes       | Yes    | Yes     |
| Auto-updater                     | Yes     | No        | Store  | Store   |
| Multiple windows                 | Yes     | No        | No     | No      |
| System tray                      | Yes     | No        | No     | No      |
| Keyboard shortcuts               | Full    | Full**    | No     | No      |
| Touch interactions               | No      | Click     | Touch  | Touch   |
| Annotations                      | Full    | Full      | Limited| Limited |
| Custom fonts                     | Yes     | Yes       | Limited| Limited |

*PixiJS works in WebView but performance must be validated.*
**Some browser shortcuts conflict and must be avoided.*

---

## 4. Mobile Architecture

### 4.1 Mobile Product Scope

Mobile platforms (iOS and Android) cannot perform arbitrary screen recording
of other applications. The mobile product focuses on:

1. **Project dashboard** — Browse and manage recording projects synced from cloud.
2. **Video editor** — View and edit projects created on desktop or web.
3. **Sharing** — Share edited videos directly from device.
4. **Cloud captions** — Generate captions using cloud AI providers.
5. **Account management** — Login, subscription, settings.

Features explicitly **excluded** from mobile:

- Screen recording (OS restriction).
- Local Whisper inference.
- GPU-accelerated export.
- HUD overlay.
- Cursor tracking.
- Multiple windows.

### 4.2 Technology Choice

| Option             | Pros                                   | Cons                               |
|--------------------|----------------------------------------|------------------------------------|
| React Native       | Native performance, shared React knowledge | Different rendering, no PixiJS* |
| Tauri Mobile        | Shared Rust core, single codebase       | Immature mobile support, WebView |
| WebView (Capacitor) | Maximum code sharing with web version  | WebView performance limits        |
| Native (Swift/Kotlin)| Best native UX                        | Separate codebase per platform    |

**Recommended: WebView shell (Capacitor or Tauri Mobile)**

Rationale:
- Maximum code reuse with the web version.
- The mobile product is primarily the editor, which is already a React/PixiJS app.
- PixiJS renders in WebView (Canvas/WebGL).
- Mobile-specific adaptations are UI layout, not core functionality.
- Tauri Mobile provides the option of using the same Rust core for file I/O.

**This decision requires user validation.** See `09-ARCHITECTURE-DECISIONS.md` ADR-08.

### 4.3 Mobile UI Adaptations

| Area              | Desktop/Web                         | Mobile                            |
|-------------------|-------------------------------------|-----------------------------------|
| Layout            | Side panel + preview + timeline    | Stacked: preview over controls    |
| Timeline          | Horizontal, resizable              | Horizontal, touch scroll          |
| Settings panel    | Side panel, always visible         | Bottom sheet, expandable          |
| Dialogs           | Centered modal                     | Full-screen or bottom sheet       |
| Navigation        | Tabs within editor                 | Bottom tab bar                    |
| File browser      | OS file picker                     | In-app cloud project browser      |
| Export             | In-app progress dialog             | Background task + notification    |

### 4.4 Mobile Build Pipeline

```
apps/mobile/
├── capacitor.config.ts   # or tauri.mobile.conf.json
├── ios/                  # iOS native project
├── android/              # Android native project
├── src/
│   ├── main.tsx          # Mobile entry point
│   ├── App.tsx           # Mobile app shell
│   ├── adapters/
│   │   └── mobileAdapter.ts
│   └── components/
│       ├── BottomNavigation.tsx
│       ├── MobileEditorLayout.tsx
│       └── MobileSettingsSheet.tsx
└── package.json
```

---

## 5. Backend Requirements

### 5.1 Current Backend

| Service              | Technology                         | Purpose                         |
|----------------------|------------------------------------|---------------------------------|
| recordly-share       | Cloudflare Worker + D1 SQLite      | Cloud sharing (upload/view)     |
| Supabase             | Auth, Edge Functions, Postgres     | Authentication, cloud functions |

### 5.2 Additional Backend for Web/Mobile

| Requirement               | Current Support | Needed For      |
|---------------------------|-----------------|-----------------|
| Cloud project storage     | Partial (share) | Web + Mobile    |
| Cloud export (optional)   | No              | Mobile          |
| Cloud caption proxy       | No              | Web + Mobile    |
| API key management         | No              | Web (security)  |

### 5.3 Cloud Caption Proxy

For the web version, API keys for LLM providers cannot be stored securely
in the browser. Options:

1. **User provides their own key** — Stored in localStorage, sent directly
   from browser. Simple but user's key is in the browser.
2. **Backend proxy** — User authenticates with Recordly, backend proxies
   requests to LLM APIs with server-side keys. More secure, requires
   additional backend.
3. **Both** — Default to user-provided key, optional managed service.

**Recommended: Option 3 (both).** See `07-LLM-PROVIDER-ARCHITECTURE.md`.

---

## 6. Separate Deployment Considerations

### 6.1 Release Independence

| Platform  | Release Mechanism           | Independent? |
|-----------|-----------------------------|--------------|
| Desktop   | GitHub Releases + auto-update | Yes         |
| Web       | CI/CD to static hosting      | Yes          |
| iOS       | App Store Review              | Yes          |
| Android   | Play Store Review             | Yes          |

Each platform can be released independently. Shared packages are versioned
together in the monorepo, but platform apps can be deployed at different times.

### 6.2 Feature Flags

For features that roll out to different platforms at different times:

```typescript
// packages/domain/src/featureFlags.ts
export interface FeatureFlags {
  cloudProjects: boolean;
  cloudExport: boolean;
  multimodalCaptions: boolean;
  advancedAnnotations: boolean;
}
```

Feature flags are resolved per-platform at build time, not runtime.

---

## 7. Web-Specific Limitations and Mitigations

| Limitation                     | Mitigation                                   |
|--------------------------------|----------------------------------------------|
| No disk streaming during record | Accumulate in memory; warn for long recordings |
| No CUDA/NVENC encoding         | WebCodecs H.264/VP9 (slower)                |
| No FFmpeg for audio mux        | Web Audio API OfflineAudioContext            |
| Tab-only audio capture          | Document limitation in UI                    |
| No cursor telemetry             | Record CSS cursor position via PointerEvent  |
| No local Whisper                | Cloud-only caption generation                |
| No file associations            | Open from cloud or file picker               |
| Memory limits (~2GB)            | Enforce recording duration limits             |
| SharedArrayBuffer requirements  | Require COOP/COEP headers for WASM           |
