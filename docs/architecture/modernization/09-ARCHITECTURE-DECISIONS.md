# 09 — Architecture Decisions

> Records major architecture decisions using ADR-style entries.
> Each decision includes context, options, trade-offs, and evidence.

---

## ADR-01: Migrate from Electron to Tauri v2

### Context
Recordly currently uses Electron (v43.7.5) for its desktop application.
The application includes a React frontend, a Node.js main process with
~170 IPC channels, and native C++/Swift/CUDA sidecar processes.

### Options Considered
1. **Stay on Electron** — Keep current architecture.
2. **Migrate to Tauri v2** — Rust backend, system WebView.
3. **Migrate to NW.js** — Alternative Chromium wrapper.
4. **Native desktop (C++/Swift)** — Separate native apps per platform.

### Decision
**Proposed: Option 2 (Tauri v2)**

### Evidence
- Binary size: Electron ~150-200 MB vs Tauri ~10-20 MB.
- Memory: Electron ~150-300 MB idle vs Tauri ~30-60 MB.
- Tauri v2 supports multi-window, system tray, auto-updater.
- Tauri sidecar system matches existing native binary communication pattern
  (stdin/stdout JSON).
- Existing `TAURI_MIGRATION_PLAN/MIGRATION_ROADMAP.md` in repository
  indicates team intent to migrate.

### Trade-offs
| Pro                                    | Con                                    |
|----------------------------------------|----------------------------------------|
| Smaller binary and memory footprint    | System WebView != Chromium             |
| Rust for security-critical backend     | WebView rendering differences          |
| Sidecar system for existing C++ bins   | Less mature ecosystem than Electron    |
| Mobile support path (Tauri Mobile)     | Node.js IPC must be rewritten in Rust  |
| Capability-based security model        | Tauri v2 still evolving                |

### Consequences
- All Electron IPC handlers must be rewritten as Tauri commands.
- The preload script (1,132 LOC) is eliminated.
- Native modules work as sidecars without code changes.
- WebView rendering must be validated for PixiJS and HeroUI.

### Conditions to Revisit
- If Tauri v2 WebView shows critical rendering bugs with PixiJS 8.
- If Tauri Mobile proves unsuitable for the mobile strategy.
- If the Tauri project becomes unmaintained.

---

## ADR-02: Monorepo with npm/pnpm Workspaces

### Context
Recordly is a single-package repository. The modernization requires
shared code across desktop, web, and mobile platforms.

### Options Considered
1. **npm/pnpm workspaces** — Built-in monorepo with minimal tooling.
2. **Nx** — Full monorepo framework with build caching.
3. **Turborepo** — Task-based monorepo runner.
4. **Lerna** — Package publishing-focused monorepo.
5. **Separate repositories** — One repo per platform.

### Decision
**Proposed: Option 1 (npm/pnpm workspaces)**

### Evidence
- The codebase has ~629 TypeScript files — not large enough to need Nx/Turborepo.
- Workspace packages (`packages/*`) provide module boundaries.
- No need for distributed build caching at current scale.
- Biome and Vite already support workspace configurations.

### Trade-offs
| Pro                                    | Con                                    |
|----------------------------------------|----------------------------------------|
| Zero additional tooling                | No built-in build caching              |
| Simple configuration                   | No task orchestration                  |
| Native npm/pnpm support               | May need Turborepo later at scale      |

### Consequences
- Package boundaries enforced by `package.json` dependencies.
- Build order managed manually or via workspace dependency graph.
- May adopt Turborepo later if build times become problematic.

### Conditions to Revisit
- If build times exceed 60 seconds for incremental builds.
- If team grows beyond 5 concurrent developers.

---

## ADR-03: Platform Adapter Interface Pattern

### Context
The editor currently calls `window.electronAPI.*` directly. This couples
the frontend to Electron.

### Options Considered
1. **Platform Adapter interface** — TypeScript interface, platform-specific implementations.
2. **Abstract service layer** — Class hierarchy with platform subclasses.
3. **Feature detection** — Runtime checks (`if (window.electronAPI)` vs browser).
4. **Dependency injection** — IoC container with platform modules.

### Decision
**Proposed: Option 1 (Platform Adapter interface)**

### Evidence
- Current `window.electronAPI` has ~170 methods (from preload.ts analysis).
- Feature detection leads to scattered `if/else` blocks throughout the codebase.
- A TypeScript interface is the simplest solution that enforces the contract.
- React Context makes the adapter available throughout the component tree.

### Trade-offs
| Pro                                    | Con                                    |
|----------------------------------------|----------------------------------------|
| Strong type safety                     | All methods must be implemented        |
| No platform checks in shared code      | Adapter may grow large                 |
| Easy to mock for testing               | Requires upfront interface design      |
| Clear boundary for new developers      | —                                      |

### Consequences
- All `window.electronAPI.*` calls replaced with `adapter.*` calls.
- Each platform implements the full adapter interface.
- Unsupported features throw or return null per capability flags.

---

## ADR-04: Retain PixiJS for Editor Rendering

### Context
The video editor preview uses PixiJS 8 for rendering video frames, cursor
overlay, annotations, captions, webcam, and zoom effects. The export
pipeline also uses PixiJS for frame-by-frame rendering.

### Options Considered
1. **Keep PixiJS 8** — Current renderer, WebGL-based.
2. **Replace with Canvas 2D** — Simpler, fewer dependencies.
3. **Replace with Three.js** — More 3D capability.
4. **Custom WebGPU renderer** — Future-proof but high effort.

### Decision
**Proposed: Option 1 (Keep PixiJS 8)**

### Evidence
- `modernFrameRenderer.ts` (3,339 LOC, 534 relations) is a massive,
  mature renderer with complex compositing logic.
- PixiJS handles shadows, blur, masks, sprites, and texture management.
- Rewriting this renderer would take months with regression risk.
- PixiJS 8 works in both Chromium, WKWebView, and WebView2.
- pixi-filters provides additional visual effects.

### Trade-offs
| Pro                                    | Con                                    |
|----------------------------------------|----------------------------------------|
| Existing complex renderer works        | PixiJS adds 500KB+ to bundle          |
| WebGL hardware acceleration            | WebGL context limits                   |
| Large ecosystem (pixi-filters)         | Learning curve for new developers      |
| Works in WebView                       | Mobile WebView performance uncertain   |

### Consequences
- PixiJS remains a core dependency.
- Mobile must validate WebGL performance in WebView.
- Bundle size impact is acceptable given the rendering requirements.

---

## ADR-05: Tailwind 4 + Design Tokens for Cross-Platform UI

### Context
The application uses Tailwind CSS 4, HeroUI, and custom CSS.

### Decision
**Proposed: Keep Tailwind 4, extract design tokens, evaluate HeroUI alternatives.**

### Evidence
- Tailwind 4 is already configured and used throughout.
- 26 shared UI components use Tailwind classes.
- HeroUI is not compatible with React Native.
- Design tokens can be shared across all platforms via CSS custom properties.

### Conditions to Revisit
- If HeroUI blocks the mobile strategy, replace with Radix UI primitives.

---

## ADR-06: Wrap Existing C++/Swift Modules as Tauri Sidecars

### Context
Recordly has 5+ native C++/Swift/CUDA executables that communicate via
stdin/stdout JSON protocol.

### Options Considered
1. **Wrap as Tauri sidecars** — Same binaries, Tauri manages lifecycle.
2. **Rewrite in Rust** — Native Rust implementations.
3. **Use Rust FFI** — Call C++ directly from Rust via FFI.
4. **Keep as child processes** — Manual process management in Rust.

### Decision
**Proposed: Option 1 (Tauri sidecars)**

### Evidence
- Native modules are mature and tested.
- They already use stdin/stdout JSON protocol.
- Tauri `tauri-plugin-shell` is designed for this exact pattern.
- Rewriting in Rust provides minimal benefit for process-isolated code.
- The `wgc-capture` module (1,200 LOC C++) uses platform-specific APIs
  (WGC, D3D11, Media Foundation) that have no Rust equivalents of the
  same maturity.

### Trade-offs
| Pro                                    | Con                                    |
|----------------------------------------|----------------------------------------|
| No rewrite risk                        | Extra process per module               |
| Proven functionality preserved         | Cross-compilation complexity            |
| Faster migration                       | Process startup latency                |

### Consequences
- Native binaries move to `apps/desktop/src-tauri/sidecars/`.
- Build scripts adapt to Tauri sidecar naming conventions.
- No functional changes to native code.

---

## ADR-07: Web Export via WebCodecs + MP4Box.js

### Context
The web version cannot use FFmpeg or CUDA for export.

### Decision
**Proposed: WebCodecs VideoEncoder + MP4Box.js muxing.**

### Evidence
- The existing `ModernVideoExporter` already supports WebCodecs encoding.
- MP4Box.js is already a dependency (`mp4box ^2.2.0`).
- `web-demuxer.wasm` is already bundled in `public/wasm/`.
- The frame-by-frame pipeline (PixiJS → WebCodecs → MP4Box) works in the
  current codebase for the fallback export path.

---

## ADR-08: Mobile as View/Edit Only (No Recording)

### Context
iOS and Android do not allow arbitrary screen recording of other applications.

### Decision
**Proposed: Mobile platforms focus on project viewing, editing, and sharing.**

### Evidence
- iOS `ReplayKit` only records the app itself, not other apps.
- Android `MediaProjection` requires foreground service and shows a persistent
  notification. It records the entire screen but is unreliable and restricted.
- The core value of mobile is accessing and editing projects created on desktop.
- Cloud-based caption generation is available on all platforms.

### Conditions to Revisit
- If Apple/Google change screen recording policies.
- If users request self-recording (app-only recording) on mobile.

---

## ADR-09: LLM Provider Registry Pattern (Accepted)

### Context
The existing `ProviderRegistry<T>` in `electron/ipc/providers/registry.ts`
provides a generic, typed registry for AI providers.

### Decision
**Accepted: Keep existing pattern, move to shared package.**

### Evidence
- Pattern is well-designed: generic, typed, extensible.
- Three providers already registered: whisper-local, openai-whisper, custom.
- Tests exist: `registry.test.ts`, `openaiWhisperProvider.test.ts`.

---

## ADR-10: Supabase + Cloudflare Workers for Backend (Accepted)

### Context
The application uses Supabase for authentication and Cloudflare Workers
(with D1 SQLite) for the cloud sharing service.

### Decision
**Accepted: Keep existing backend services.**

### Evidence
- `services/supabase/` contains config, functions, migrations, and tests.
- `services/recordly-share/worker/` is a mature Cloudflare Worker.
- Both services are platform-agnostic and work with desktop, web, and mobile.
- No reason to replace functional backend infrastructure.

### Conditions to Revisit
- If cloud project storage is needed (may require Supabase Storage or S3).
- If cloud rendering/export is needed (requires compute, not Workers).

---

## Unverified Assumptions

The following assumptions could not be verified during this planning phase:

| ID | Assumption                                          | Risk    | Verification Method        |
|----|-----------------------------------------------------|---------|----------------------------|
| A1 | PixiJS 8 renders correctly in WKWebView (macOS)     | Medium  | Build Tauri prototype       |
| A2 | PixiJS 8 renders correctly in WebView2 (Windows)    | Low     | Build Tauri prototype       |
| A3 | HeroUI components work in Tauri WebView              | Medium  | Build Tauri prototype       |
| A4 | Tauri sidecar protocol supports existing JSON format | Low     | Test sidecar registration   |
| A5 | WebCodecs VideoEncoder available in all target browsers | Medium | Browser compatibility check |
| A6 | OPFS is available in all target browsers              | Medium  | Browser compatibility check |
| A7 | PixiJS 8 WebGL works in mobile WebView               | High    | Mobile prototype            |
| A8 | Tauri Mobile is production-ready for iOS/Android      | High    | Evaluate Tauri Mobile beta  |
| A9 | File System Access API sufficient for web export      | Low     | Browser testing             |
| A10| Tailwind 4 works without modification in Tauri WebView| Low     | Build Tauri prototype       |
