# Greenscreen Facecam Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the green screen behind the facecam with an uploaded image — chroma key + garbage matte + color controls — identically in editor preview and export.

**Architecture:** A pure-math module (`chromaKeyMath.ts`) defines the per-pixel alpha/color transforms and is fully unit-tested; a WebGL2 module (`webcamProcessor.ts`) mirrors that math in a fragment shader and exposes `processFrame(source) → canvas`, producing a composited frame (background image + keyed foreground) at source resolution. Both the editor's webcam bubble and the exporters insert the processor directly in front of their existing frame source, so all current crop/mirror/cover/shadow layout code is untouched. Settings extend `WebcamOverlaySettings` and persist with the project.

**Tech Stack:** TypeScript, React, WebGL2, vitest, biome. No git in this working copy — "commit" steps are replaced by verification steps.

**Scope note:** This plan covers spec sections 1 (pipeline) and the export/preview integration. Scene styles, fill-frame mode, and hotkeys (spec sections 2–4) get a separate follow-up plan.

---

### Task 1: Pure key/matte/color math (`chromaKeyMath.ts`)

**Files:**
- Create: `src/lib/webcamProcessing/chromaKeyMath.ts`
- Test: `src/lib/webcamProcessing/chromaKeyMath.test.ts`

- [ ] **Step 1: Write failing tests** covering: green pixel → alpha 0 at default strength; skin-tone pixel → alpha 1; edge pixel → partial alpha that decreases as `edgeSoftness` rises; spill suppression clamps green channel toward max(r,b) only when alpha < 1; matte falloff is 1 inside rect, 0 outside, smooth across feather band; rounded-corner distance respects cornerRadius; color transform identity at all-zero settings; brightness shifts luma, contrast pivots at 0.5, highlights only affect luma > 0.5, shadows only luma < 0.5.
- [ ] **Step 2: Run tests, confirm fail** (`npx vitest run src/lib/webcamProcessing/chromaKeyMath.test.ts`).
- [ ] **Step 3: Implement.** Key math (YCbCr-based): convert RGB → Cb/Cr; `chromaDist = hypot(cb - keyCb, cr - keyCr)`; `alpha = smoothstep(tol, tol + soft, chromaDist)` where `tol = mix(0.02, 0.22, keyStrength)`, `soft = mix(0.01, 0.18, edgeSoftness)`. Spill: `g' = min(g, mix(g, max(r, b), (1 - alpha) * spillFactor))` with fixed `spillFactor = 0.7` (not user-exposed). Matte: signed distance to rounded rect in normalized coords; `matteAlpha = 1 - smoothstep(0, feather * 0.25 + 1e-4, sd)`. Color: `v += brightness * 0.5`; `v = (v - 0.5) * (1 + contrast) + 0.5`; highlights/shadows via luma-weighted gain: `w_h = smoothstep(0.5, 1.0, luma)`, `v += highlights * 0.5 * w_h` (shadows mirrored below 0.5). Export every constant; shader (Task 3) must use the same formulas.
- [ ] **Step 4: Tests pass.**
- [ ] **Step 5: Verify** `npx tsc --noEmit` and `npx biome check src/lib/webcamProcessing/` are clean.

### Task 2: Settings model + persistence

**Files:**
- Modify: `src/components/video-editor/types.ts` (extend `WebcamOverlaySettings` + `DEFAULT_WEBCAM_OVERLAY`)
- Modify: `src/components/video-editor/projectPersistence.ts` (~line 1020 webcam block: normalize new fields)
- Modify: `src/components/video-editor/webcamSettingsFields.ts` (`stripWebcamPerRecordingFields` keeps the new style fields; greenscreen/mask/color are style fields, `backgroundImagePath` is per-project)
- Test: extend `src/components/video-editor/projectPersistence.webcamLayout.test.ts` pattern with a new round-trip test file `projectPersistence.webcamProcessing.test.ts`

- [ ] **Step 1:** Add to `WebcamOverlaySettings` (all optional for backward compat):
```ts
greenscreen?: { enabled: boolean; backgroundImagePath: string | null; keyStrength: number; edgeSoftness: number };
mask?: { enabled: boolean; rect: CropRegion; cornerRadius: number; feather: number };
color?: { brightness: number; contrast: number; highlights: number; shadows: number };
```
Defaults in `DEFAULT_WEBCAM_OVERLAY`: greenscreen `{enabled:false, backgroundImagePath:null, keyStrength:0.5, edgeSoftness:0.35}`, mask `{enabled:false, rect:{x:0,y:0,width:1,height:1}, cornerRadius:0, feather:0.2}`, color all `0`.
- [ ] **Step 2:** Write failing round-trip test: serialize project with non-default values → parse → equal; parse legacy project without the fields → defaults.
- [ ] **Step 3:** Implement normalizers in `projectPersistence.ts` following the existing `normalizeWebcamCropRegion` style (clamp numbers to ranges, booleans via `typeof`, fall back to defaults).
- [ ] **Step 4:** Tests pass; full suite still green.

### Task 3: WebGL2 processor (`webcamProcessor.ts`)

**Files:**
- Create: `src/lib/webcamProcessing/webcamProcessor.ts`
- Test: `src/lib/webcamProcessing/webcamProcessor.test.ts` (uniform-prep + lifecycle logic only; WebGL itself isn't available in vitest)

- [ ] **Step 1:** API:
```ts
export interface WebcamProcessingSettings { /* greenscreen/mask/color resolved (non-optional) */ }
export function isProcessingActive(s: WebcamOverlaySettings): boolean; // any non-default
export function resolveProcessingSettings(s: WebcamOverlaySettings): WebcamProcessingSettings;
export class WebcamProcessor {
  constructor();
  setBackgroundImage(img: ImageBitmap | HTMLImageElement | null): void;
  processFrame(source: TexImageSource, w: number, h: number, settings: WebcamProcessingSettings): HTMLCanvasElement | null; // null if WebGL unavailable
  destroy(): void;
}
```
Fragment shader implements exactly the Task 1 formulas (key → spill → matte multiply → color on fg) and composites `fg over bg` (bg sampled cover-fit to source aspect; transparent black if no image / greenscreen disabled). Output canvas is source-sized; **no mirroring** (callers already mirror).
- [ ] **Step 2:** Failing tests for `isProcessingActive` (false on defaults/undefined, true per group) and `resolveProcessingSettings` clamping.
- [ ] **Step 3:** Implement; WebGL context loss → `processFrame` returns null and caller falls back to raw frame.
- [ ] **Step 4:** Tests pass; typecheck/lint clean.

### Task 4: Background image upload

**Files:**
- Modify: `electron/ipc/register/sources.ts` or the existing custom-background IPC (locate `Upload Custom` handler used by the background tab; reuse its asset-copy helper)
- Modify: `electron/preload.ts`, `electron/electron-env.d.ts` if a new channel is needed
- Test: none beyond typecheck (thin IPC glue following existing pattern)

- [ ] **Step 1:** Find the handler behind the background tab's "Upload Custom" (grep `upload-custom` / `custom-background`). If it stores into project assets and returns a path, reuse it directly for the webcam greenscreen image (no new IPC). Only add a parallel handler if the existing one is coupled to background-tab state.
- [ ] **Step 2:** Renderer helper `pickGreenscreenImage(): Promise<string | null>` wrapping the dialog + copy; store returned path in `webcam.greenscreen.backgroundImagePath`.
- [ ] **Step 3:** Typecheck + lint clean.

### Task 5: Editor preview integration (VideoPlayback)

**Files:**
- Modify: `src/components/video-editor/VideoPlayback.tsx` (webcam bubble content, ~lines 824–930)

- [ ] **Step 1:** Add a `<canvas>` sibling to the bubble's `<video>` inside `webcamCropContentRef`'s box, same sizing styles. When `isProcessingActive(webcam)`: video element gets `visibility: hidden` (it remains the sync/time driver), canvas shown.
- [ ] **Step 2:** Drive frames with `video.requestVideoFrameCallback` (fallback: rAF while playing/seeking): call `processor.processFrame(video, vw, vh, resolved)`, draw result into the visible canvas via 2D `drawImage`. Lazily create one `WebcamProcessor` per mounted playback; `destroy()` on unmount. Load `backgroundImagePath` into an ImageBitmap on change (file URL via existing local-media URL helper used for `webcamVideoPath`).
- [ ] **Step 3:** `processFrame` returns null → show raw video (one-time `console.warn`).
- [ ] **Step 4:** Manual check via dev app: bubble shows keyed output, crop/mirror/size/position still behave.

### Task 6: Export integration (both renderers)

**Files:**
- Modify: `src/lib/exporter/frameRenderer.ts` (insert after `webcamFrameSource` resolution, ~line 2498)
- Modify: `src/lib/exporter/modernFrameRenderer.ts` (same seam — locate its webcam bubble draw)

- [ ] **Step 1:** In each renderer: lazily create a `WebcamProcessor` member (and `destroy()` in the renderer's existing cleanup). After `webcamFrameSource` is resolved and before the crop/cover math:
```ts
if (isProcessingActive(this.config.webcam)) {
  const processed = this.webcamProcessor.processFrame(webcamFrameSource, sourceWidth, sourceHeight, resolved);
  if (processed) webcamFrameSource = processed; // same dimensions; downstream code unchanged
}
```
Background image decoded once per export from `backgroundImagePath` (await during renderer init alongside existing media loading).
- [ ] **Step 2:** Run existing exporter test suites — must stay green (processing inactive by default).
- [ ] **Step 3:** Manual: export a greenscreen project; exported frames match editor preview.

### Task 7: Settings UI

**Files:**
- Modify: `src/components/video-editor/SettingsPanel.tsx` (webcam section)
- Create: `src/components/video-editor/WebcamMaskControl.tsx` (clone interaction pattern from `WebcamCropControl.tsx`, editing `mask.rect` + corner radius instead of crop)

- [ ] **Step 1:** Three new groups in the webcam panel, using existing `SliderControl`/toggle components:
  - **Green Screen:** enable toggle; "Choose image…" button + filename/thumbnail (Task 4 helper); `keyStrength`, `edgeSoftness` sliders (0–100%).
  - **Mask:** enable toggle; `WebcamMaskControl` preview widget; `feather` slider; Reset.
  - **Color:** brightness/contrast/highlights/shadows sliders (−100..100 mapped to −1..1); Reset.
- [ ] **Step 2:** All controls write through the same `onWebcamChange` path the existing webcam fields use (history/undo comes free).
- [ ] **Step 3:** Typecheck + lint + manual smoke in dev app.

### Task 8: Full verification

- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean on touched files
- [ ] `npx vitest run` — all suites green except the known pre-existing `electron/ipc/paths/binaries.test.ts` environment failure
- [ ] Manual end-to-end in dev app: enable greenscreen → pick image → tune key → mask out walls → adjust color → export → compare against preview
