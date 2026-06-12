# Timeline Magnet, Black Gaps, B-to-Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default split-at-playhead to B; add a magnet toggle (ON = ripple display + today's gap-removal semantics, OFF = gaps are black time in preview and export); fix the gap seek-skip glitch.

**Architecture:** `magnetEnabled` is project state (default true). Magnet ON collapses the timeline *display* via the existing source↔timeline mapping applied at the VideoEditor→TimelineEditor boundary (regions, playhead, duration in; callbacks reverse-mapped out) — timeline internals untouched. Magnet OFF: a shared pure `buildOutputTimeline(durationMs, trims, speeds, gapsAsBlack)` produces source/black slices consumed by the exporter's PTS mapping, black-frame emission, and audio silence insertion; the preview replaces trim seeks with a wall-clock gap driver + black overlay. The seek re-entry guard fixes the glitch in magnet-ON mode.

**Tech Stack:** React/TS, dnd-timeline, WebCodecs exporter, OfflineAudioContext, vitest, Biome (TABS).

**Spec:** `docs/superpowers/specs/2026-06-10-timeline-magnet-and-gaps-design.md`

**Conventions:** npm from `/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY`; git from `/Users/justmaiko/PROJECTS/Mini Tools`. Baseline: ONE pre-existing failure (`electron/ipc/paths/binaries.test.ts`); tsc CLEAN. Execute AFTER the camera-track plan.

---

### Task 1: B-to-cut default + hint text

**Files:**
- Modify: `src/lib/shortcuts.ts:77` (`DEFAULT_SHORTCUTS.splitClip` → `{ key: "b" }`)
- Modify: `src/components/video-editor/timeline/TimelineCanvas.tsx:393` hint text — make it DYNAMIC from the configured binding rather than hard-coding "B": the canvas (or its parent) should receive the current `splitClip` binding label. Investigate how TimelineCanvas gets props; if threading the shortcut config is disproportionate, set the literal to "Press B to split clip" and note it.
- Test: `src/lib/shortcuts.test.ts` if it exists (grep); else add a tiny test file asserting `DEFAULT_SHORTCUTS.splitClip.key === "b"` and `findConflict` reports no conflict for the default set.

- [ ] **Step 1:** Failing test → change default → pass. Check `ShortcutsConfigDialog` renders labels from config (no hard-coded "C" — grep `"C"` / `splitClip` in it and the i18n `shortcuts.json` files; update any literal).
- [ ] **Step 2:** tsc/biome/vitest; manual: press B in the editor over a clip → splits at playhead (saved user configs override defaults — note in commit).
- [ ] **Step 3: Commit** — `git commit -m "Default split-at-playhead shortcut to B"`

---

### Task 2: Seek re-entry guard (glitch fix, magnet-ON path)

**Files:**
- Modify: `src/components/video-editor/videoPlayback/videoEventHandlers.ts:30-193`
- Test: `src/components/video-editor/videoPlayback/videoEventHandlers.test.ts` (create if absent — the module takes refs + a video element; construct a minimal fake `video` object `{ currentTime, duration, paused, ended, play, pause, addEventListener... }` — read the module first to see what the handlers touch and fake exactly that; if the module resists unit construction, grep for an existing test of this file or sibling pattern)

- [ ] **Step 1: Read the module fully.** Confirm the glitch mechanism: `updateTime`/`handleSeeked` call `skipPastTrimRegion` with no guard, so late frame callbacks (with pre-seek timestamps) re-trigger seeks → the skip→replay loop.
- [ ] **Step 2: Implement the guard.** Add `let pendingTrimSkipTargetMs: number | null = null;` in `createVideoEventHandlers`. In `skipPastTrimRegion`: set it to the seek target before assigning `video.currentTime`. In `updateTime` and `handleSeeked`: when `pendingTrimSkipTargetMs !== null`, ignore trim handling (and stale times) until the observed time reaches `pendingTrimSkipTargetMs - 1ms` (then clear it). Also clear it in `handleSeeking` triggered by USER seeks (distinguish: clear on any externally-initiated seek — simplest: clear at the top of `handleSeeking` if the new target differs from the pending one... read the code and implement the minimal correct rule; the TESTS encode the contract):

```ts
	it("does not re-skip the same trim region from a stale frame callback", () => {
		// enter trim at 5000-9000ms -> seek to 9.0s issued
		// a late frame callback reports 5.2s again -> must NOT seek again
	});
	it("clears the pending skip once playback passes the target", () => {});
	it("user scrubbing into a trim region still skips once", () => {});
```

Write these as real tests against the fake video object (assert `video.currentTime` assignment counts).
- [ ] **Step 3:** vitest (new tests pass, no regressions in `src/components/video-editor`), tsc, biome. Manual: delete a middle clip (magnet semantics today), play across the gap → clean skip, playhead keeps moving, no loop.
- [ ] **Step 4: Commit** — `git commit -m "Guard trim-region skip against stale frame callbacks"`

---

### Task 3: `magnetEnabled` state + toolbar toggle

**Files:**
- Modify: `src/components/video-editor/projectPersistence.ts` (`magnetEnabled: boolean`, default `true`, in `ProjectEditorState` + `normalizeProjectEditor`) + extend `projectPersistence.webcamLayout.test.ts` (or a sibling) with a failing normalization test first
- Modify: `src/components/video-editor/VideoEditor.tsx` (state, project open/save funnel — same spots as `webcamLayoutRegionsEnabled`; toolbar button)
- Modify: all 10 `src/i18n/locales/*/editor.json` OR wherever toolbar tooltips live (grep how the split button title is translated; follow it)

- [ ] **Step 1:** Normalization TDD (`normalizeProjectEditor({}).magnetEnabled === true`; `false` round-trips).
- [ ] **Step 2:** Toolbar toggle next to the split button (`VideoEditor.tsx:6113-6197` left-tools group): a ghost icon Button using the `MagnetIcon` from `@phosphor-icons/react` (verify export name in `node_modules/@phosphor-icons/react/dist/index.d.ts`; `Magnet` exists in phosphor — use the suffixed form matching this repo's imports... NOTE: this toolbar uses `lucide-react` icons (`Scissors`, `ZoomIn` per exploration) — CHECK the actual import source of `Scissors` in VideoEditor.tsx and use the same library's magnet icon (`Magnet` exists in lucide). Active state: accent color when ON (grep how other active/toggled toolbar buttons style; else `text-blue-400` when ON). Tooltip: translated "Magnet: close gaps when deleting" / "Magnet off: gaps stay as black space" via the toolbar's existing i18n pattern.
- [ ] **Step 3:** tsc/biome/i18n-check/vitest. **Commit** — `git commit -m "Add magnet project setting with timeline toolbar toggle"`

---

### Task 4: Output timeline pure model (TDD — the shared core for export gaps)

**Files:**
- Create: `src/lib/exporter/outputTimeline.ts`
- Test: `src/lib/exporter/outputTimeline.test.ts`

- [ ] **Step 1: Failing tests:**

```ts
import { describe, expect, it } from "vitest";
import { buildOutputTimeline, outputDurationMs, sourceToOutputMs } from "./outputTimeline";

const trims = [{ id: "t", startMs: 2000, endMs: 5000 }];

describe("buildOutputTimeline", () => {
	it("removes gaps when gapsAsBlack is false", () => {
		const slices = buildOutputTimeline(10000, trims, [], false);
		expect(slices).toEqual([
			{ kind: "source", sourceStartMs: 0, sourceEndMs: 2000, outputStartMs: 0, outputEndMs: 2000, speed: 1 },
			{ kind: "source", sourceStartMs: 5000, sourceEndMs: 10000, outputStartMs: 2000, outputEndMs: 7000, speed: 1 },
		]);
	});

	it("emits black slices when gapsAsBlack is true", () => {
		const slices = buildOutputTimeline(10000, trims, [], true);
		expect(slices).toEqual([
			{ kind: "source", sourceStartMs: 0, sourceEndMs: 2000, outputStartMs: 0, outputEndMs: 2000, speed: 1 },
			{ kind: "black", sourceStartMs: 2000, sourceEndMs: 5000, outputStartMs: 2000, outputEndMs: 5000, speed: 1 },
			{ kind: "source", sourceStartMs: 5000, sourceEndMs: 10000, outputStartMs: 5000, outputEndMs: 10000, speed: 1 },
		]);
	});

	it("applies speed regions inside source slices", () => {
		const slices = buildOutputTimeline(10000, trims, [{ id: "s", startMs: 0, endMs: 2000, speed: 2 }], true);
		expect(slices[0]).toEqual({
			kind: "source", sourceStartMs: 0, sourceEndMs: 2000, outputStartMs: 0, outputEndMs: 1000, speed: 2,
		});
		expect(slices[1].outputStartMs).toBe(1000);
		expect(slices[1].outputEndMs).toBe(4000); // black duration unaffected by speed
	});

	it("preserves leading/trailing gaps", () => {
		const slices = buildOutputTimeline(10000, [{ id: "a", startMs: 0, endMs: 1000 }], [], true);
		expect(slices[0].kind).toBe("black");
		expect(slices[0].outputStartMs).toBe(0);
	});
});

describe("sourceToOutputMs / outputDurationMs", () => {
	it("maps source times through black gaps", () => {
		const slices = buildOutputTimeline(10000, trims, [], true);
		expect(sourceToOutputMs(slices, 1000)).toBe(1000);
		expect(sourceToOutputMs(slices, 6000)).toBe(6000);
		expect(outputDurationMs(slices)).toBe(10000);
	});

	it("maps source times when gaps removed", () => {
		const slices = buildOutputTimeline(10000, trims, [], false);
		expect(sourceToOutputMs(slices, 6000)).toBe(3000);
		expect(outputDurationMs(slices)).toBe(7000);
	});
});
```

- [ ] **Step 2: Implement** `outputTimeline.ts`:

```ts
import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";

export interface OutputSlice {
	kind: "source" | "black";
	sourceStartMs: number;
	sourceEndMs: number;
	outputStartMs: number;
	outputEndMs: number;
	speed: number;
}

/**
 * Splits [0, durationMs] into source slices (kept material, speed-adjusted)
 * and — when gapsAsBlack — black slices for trimmed ranges (real-time, speed 1).
 * When gapsAsBlack is false, trimmed time is removed (output cursor does not
 * advance), matching the exporter's existing semantics.
 */
export function buildOutputTimeline(
	durationMs: number,
	trimRegions: TrimRegion[],
	speedRegions: SpeedRegion[],
	gapsAsBlack: boolean,
): OutputSlice[] {
	// boundaries from trims + speeds + [0, duration]; walk intervals; for each
	// interval determine trimmed (midpoint in a trim) and speed; emit source
	// slices always, black slices only when gapsAsBlack && trimmed; advance the
	// output cursor by (interval/speed) for source and by interval for black.
	...
}

export function sourceToOutputMs(slices: OutputSlice[], sourceMs: number): number { ... }

export function outputDurationMs(slices: OutputSlice[]): number {
	return slices.length > 0 ? slices[slices.length - 1].outputEndMs : 0;
}
```

Implement fully (the `...` bodies follow directly from the tests — interval walk over sorted boundary set, exactly like `audioEncoder.buildTimelineSlices` lines 1363-1404 but emitting both kinds; read that function and mirror its boundary/midpoint technique). Merge adjacent same-kind/speed slices not required (tests define exact expected output — match them).
- [ ] **Step 3:** PASS + lint. **Commit** — `git commit -m "Add output timeline model with black gap slices"`

---### Task 5: Export — black gaps (video + audio + skip reason)

**Files:**
- Modify: `src/lib/exporter/modernVideoExporter.ts` (config `magnetEnabled?: boolean`; skip reason ~1556; frame PTS mapping + black frame emission in the WebCodecs path)
- Modify: `src/lib/exporter/modernFrameRenderer.ts` (a `renderBlackFrame(timestamp)`-capable path)
- Modify: `src/lib/exporter/audioEncoder.ts` (silent spans in `buildTimelineSlices`/scheduling, duration math)
- Modify: `src/components/video-editor/VideoEditor.tsx` (pass `magnetEnabled` into the export config; field added to the config types like `webcamLayoutRegions` was)
- Test: extend `modernVideoExporter.nativeStaticLayout.test.ts` (skip reason) + `audioEncoder.test.ts` (silent span scheduling if the offline path has a test seam — read it first)

This is investigation-first; the contracts:

- [ ] **Step 1: Skip reason (TDD).** `gapsAsBlack = config.magnetEnabled === false && (config.trimRegions ?? []).length > 0`. When true → push `"unsupported-black-gaps"` in `getNativeStaticLayoutSkipReasons` (~line 1556, next to the annotation check). Extend the existing skip-reason test (same seam as `unsupported-webcam-layout-regions`).
- [ ] **Step 2: Video frames.** Investigate the WebCodecs frame loop in `modernVideoExporter.ts` (where decoded frames are filtered against trims and given output timestamps — start from `buildNativeTrimSegments` 1120-1145 consumers and the encode loop). Replace the trim-time computation with `buildOutputTimeline(...)` + `sourceToOutputMs(...)` when `gapsAsBlack` (when false, the slices reproduce existing behavior — consider using the new model for BOTH paths only if the mapping verifiably matches the existing math; otherwise gate strictly on `gapsAsBlack`). For each black slice, emit synthetic black frames at the export fps across `[outputStartMs, outputEndMs)`: render via the frame renderer with screen container AND background hidden (add a `renderBlackFrame(timestampUs, durationUs)` method to `ModernFrameRenderer` that hides `cameraContainer`, `backgroundContainer`, webcam container, renders, and restores visibility — reuse the existing render/encode plumbing that `renderFrame` feeds). Emit black slices in output order interleaved with source slices (the encode loop is sequential by output time — insert black-frame runs when the loop crosses a black slice boundary).
- [ ] **Step 3: Audio.** In `audioEncoder.ts`: thread `gapsAsBlack` into `process(...)`; when true, ALWAYS use the offline-render path (`renderAndMuxOfflineAudio` — add `gapsAsBlack` to its signature) and in `buildTimelineSlices` keep trimmed intervals as slices marked silent (e.g. `speed: 1, silent: true`) whose scheduling skips the buffer but advances the output offset; total render duration = `outputDurationMs`. Match `sourceTimeToOutputTime` (1407-1425) to the new mapping when `gapsAsBlack` (use `sourceToOutputMs` from the shared model to avoid drift).
- [ ] **Step 4: Duration plumbing.** Find where export duration (`effectiveDurationSec` / muxer duration) is computed from trims and make it use `outputDurationMs(slices)` when `gapsAsBlack` so container metadata matches.
- [ ] **Step 5: Verify.** `npx vitest --run src/lib/exporter` no new failures + new tests pass; tsc; biome. Manual export check deferred to final task (cannot run visually).
- [ ] **Step 6: Commit** — `git commit -m "Export black segments for timeline gaps when magnet is off"`

---

### Task 6: Preview — wall-clock black gap playback

**Files:**
- Modify: `src/components/video-editor/videoPlayback/videoEventHandlers.ts` (gap driver)
- Modify: `src/components/video-editor/VideoPlayback.tsx` (magnetEnabled prop → ref → handlers; black overlay)
- Modify: `src/components/video-editor/VideoEditor.tsx` (pass `magnetEnabled`)
- Test: extend `videoEventHandlers.test.ts` from Task 2

- [ ] **Step 1: Gap driver (TDD against the fake video object).** Contract when `magnetEnabledRef.current === false` and playback enters a trim region `[gStart, gEnd)`:
  - pause the video element (once), record `gapWallStart = performance.now()` and `gapStartMs`;
  - on each scheduled tick (the existing rAF fallback keeps running while paused — verify; if `requestVideoFrameCallback` stalls on paused video, switch the scheduler to rAF while in a gap), emit time `gapStartMs/1000 + (now - gapWallStart)/1000`, and notify a new callback `onGapStateChange(true)`;
  - when emitted time reaches `gEnd`: seek video to `gEnd/1000`, `video.play()`, `onGapStateChange(false)`, resume normal flow (set the Task-2 pending-skip target to suppress stale callbacks);
  - user pause during a gap freezes the wall clock (store accumulated gap elapsed; resume continues it); user scrub out of the gap cancels the driver.
  Tests: entering gap pauses + emits advancing times; reaching end seeks+plays; pause mid-gap freezes; scrub-out cancels.
- [ ] **Step 2: Black overlay.** `VideoPlayback.tsx`: `onGapStateChange` from the handlers sets state `inBlackGap`; render `{inBlackGap && <div className="absolute inset-0 z-40 bg-black" />}` inside the preview frame (`previewFrameRef` container, above background + canvas, below floating UI like captions? — above everything visual: place as the last child before the invisible `<video>`). Also when SCRUBBING into a gap while paused (no driver running), show the overlay: derive `inBlackGap` ALSO from `magnetEnabled && currentTime inside any trim` computed per time update (simplest: VideoEditor computes `isInGapAtCurrentTime` memo and passes it down OR VideoPlayback derives from `trimRegions` + `currentTime` prop — derive in VideoPlayback from existing props; the driver callback then only needs to keep emitted time advancing).
- [ ] **Step 3: Magnet-ON unchanged.** When `magnetEnabled` is true, behavior = Task 2's guarded skip (assert with the Task 2 tests still green).
- [ ] **Step 4:** tsc/biome/vitest. Manual: magnet OFF → delete a middle clip → play: smooth black passage, playhead advances, audio regions over the gap still play, source audio silent; export duration matches preview.
- [ ] **Step 5: Commit** — `git commit -m "Play timeline gaps as smooth black time in preview when magnet is off"`

---

### Task 7: Magnet-ON collapsed timeline display

**Files:**
- Create: `src/components/video-editor/timelineDisplayMapping.ts` (+ test)
- Modify: `src/components/video-editor/VideoEditor.tsx` (the `<TimelineEditor>` call site ~6302-6349 and the handlers it passes)

The timeline internals stay untouched: when magnet is ON, VideoEditor passes DISPLAY-space data and reverse-maps callbacks.

- [ ] **Step 1: Pure mapping module (TDD).** `timelineDisplayMapping.ts` wraps `mapSourceTimeToTimelineTime`/`mapTimelineTimeToSourceTime` (types.ts:274-311) into region/span helpers:

```ts
export function regionToDisplay<T extends { startMs: number; endMs: number }>(region: T, clips: ClipRegion[]): T;
export function spanToSource(span: { start: number; end: number }, clips: ClipRegion[]): { start: number; end: number };
export function msToDisplay(ms: number, clips: ClipRegion[]): number;
export function msToSource(ms: number, clips: ClipRegion[]): number;
```

Tests: round-trip for points inside clips; regions spanning a gap collapse correctly; clip list mapping produces contiguous display spans (`clipsToDisplay(clips)` — each clip's display span = [Σ previous display durations, +own duration/speed]).
- [ ] **Step 2: Investigate the current playhead contract.** VideoEditor already computes `timelinePlayheadTime = mapSourceTimeToTimelineTime(currentTime*1000)/1000` (~line 3290) and TimelineEditor takes `playheadTime ?? currentTime` (TimelineEditor.tsx:162). Determine what's ACTUALLY passed today (`playheadTime` prop present at the call site?) and whether spans are source-space — they are (`timelineModel.ts` uses `region.startMs`). Reconcile: if `timelinePlayheadTime` is already passed while spans are source-space, that's an existing inconsistency to understand BEFORE changing anything — report findings in the commit message.
- [ ] **Step 3: Implement the boundary mapping.** In VideoEditor, when `magnetEnabled`:
  - Regions/clips passed to TimelineEditor are mapped to display space (`clipsToDisplay`, `regionToDisplay` for zoom/annotation/audio/camera arrays — memoized);
  - `videoDuration` prop = timeline duration (already computed as `timelineDuration` ~3293);
  - playhead prop = display-mapped current time; `onSeek(seconds)` maps back via `msToSource`;
  - `onClipSplit(ms)` maps back; region span-change callbacks map spans back via `spanToSource` BEFORE the existing clamp/update logic; camera double-click-add ms maps back;
  - CLIP items: body drag disabled and edge-resize disabled in magnet mode (pass the existing `disabled`-style flag on clip items or intercept clip span changes with a no-op + a toast explaining "turn magnet off to adjust clip edges") — choose the lighter intercept (no-op + toast) and note it; clip SELECTION and DELETE still work (ripple happens naturally since display recomputes from remaining clips).
  When magnet OFF: pass-through exactly as today.
- [ ] **Step 4:** tsc/biome/vitest. Manual: magnet ON → delete a middle clip → remaining clips snap together on the timeline, playhead/ruler consistent, zoom/camera segments sit at the right collapsed positions, scrubbing/splitting accurate; toggle magnet OFF → gaps reappear at source positions (black gap behavior from Task 6); all region drag/resize still lands correctly in both modes.
- [ ] **Step 5: Commit** — `git commit -m "Collapse timeline display when magnet is on"`

---

### Task 8: Final verification

- [ ] **Step 1:** `npm test` (only the 1 pre-existing failure), tsc clean, i18n:check no new failures, biome on all touched files.
- [ ] **Step 2:** Manual matrix: (a) magnet ON: B-split, delete → ripple display, smooth playback, export drops time; (b) magnet OFF: delete → black gap plays smoothly + exports as black with matching duration; (c) glitch scenario from the user (delete middle clip, play across boundary) clean in BOTH modes; (d) camera track + zoom regions render correctly in collapsed display.
- [ ] **Step 3:** Commit fixes; rebuild + reinstall the app (vite build → normalize → smoke → `npx electron-builder --mac dir --arm64` → swap /Applications/Recordly.app).
