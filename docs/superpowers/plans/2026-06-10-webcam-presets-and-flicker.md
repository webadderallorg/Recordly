# Webcam Presets Fix + Slider Flicker Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make webcam framing portable across recordings via the existing preset/preferences system (without clobbering per-recording webcam sources), and fix the preview flicker when dragging the webcam custom-position sliders.

**Architecture:** A small helper module defines the layout-vs-per-recording split of `WebcamOverlaySettings`. Preset apply and preset/preference persistence use it. The flicker fix makes `applyWebcamBubbleLayout` read its inputs from a ref so its identity is stable and webcam-field changes no longer re-trigger the heavy stage-layout effect.

**Tech Stack:** React/TS, vitest, Biome (TABS).

**Spec:** `docs/superpowers/specs/2026-06-10-webcam-presets-and-flicker-design.md`

**Conventions:** npm commands from `/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY`; git commits from repo root `/Users/justmaiko/PROJECTS/Mini Tools`. Baseline: full suite has exactly ONE pre-existing failure (`electron/ipc/paths/binaries.test.ts` Windows path test). tsc is clean. Run `npx biome check <touched files>` before each commit.

---

### Task 1: Webcam layout-field split helper (TDD)

**Files:**
- Create: `src/components/video-editor/webcamSettingsFields.ts`
- Test: `src/components/video-editor/webcamSettingsFields.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/components/video-editor/webcamSettingsFields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_WEBCAM_OVERLAY, type WebcamOverlaySettings } from "./types";
import { pickWebcamLayoutFields, stripWebcamPerRecordingFields } from "./webcamSettingsFields";

const sample: WebcamOverlaySettings = {
	...DEFAULT_WEBCAM_OVERLAY,
	enabled: true,
	sourcePath: "/tmp/recording.webcam.webm",
	timeOffsetMs: 250,
	mirror: false,
	cropRegion: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
	positionPreset: "custom",
	positionX: 0.95,
	positionY: 1,
	size: 32,
	cornerRadius: 90,
	shadow: 0.27,
	margin: 24,
};

describe("pickWebcamLayoutFields", () => {
	it("returns only layout fields", () => {
		const layout = pickWebcamLayoutFields(sample);
		expect(layout).toEqual({
			mirror: false,
			cropRegion: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
			corner: sample.corner,
			positionPreset: "custom",
			positionX: 0.95,
			positionY: 1,
			size: 32,
			reactToZoom: sample.reactToZoom,
			cornerRadius: 90,
			shadow: 0.27,
			margin: 24,
		});
		expect("sourcePath" in layout).toBe(false);
		expect("timeOffsetMs" in layout).toBe(false);
		expect("enabled" in layout).toBe(false);
	});
});

describe("stripWebcamPerRecordingFields", () => {
	it("resets per-recording fields and keeps layout", () => {
		const stripped = stripWebcamPerRecordingFields(sample);
		expect(stripped.sourcePath).toBeNull();
		expect(stripped.timeOffsetMs).toBe(DEFAULT_WEBCAM_OVERLAY.timeOffsetMs);
		expect(stripped.enabled).toBe(false);
		expect(stripped.positionX).toBe(0.95);
		expect(stripped.size).toBe(32);
		expect(stripped.cropRegion).toEqual(sample.cropRegion);
	});
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest --run src/components/video-editor/webcamSettingsFields.test.ts` → module not found.

- [ ] **Step 3: Implement** — create `src/components/video-editor/webcamSettingsFields.ts`:

```ts
import { DEFAULT_WEBCAM_OVERLAY, type WebcamOverlaySettings } from "./types";

/**
 * Layout fields are portable across recordings (presets, preferences).
 * Per-recording fields (sourcePath, timeOffsetMs, enabled) belong to a
 * specific recording's webcam capture and must never travel with a preset.
 */
export type WebcamLayoutFields = Pick<
	WebcamOverlaySettings,
	| "mirror"
	| "cropRegion"
	| "corner"
	| "positionPreset"
	| "positionX"
	| "positionY"
	| "size"
	| "reactToZoom"
	| "cornerRadius"
	| "shadow"
	| "margin"
>;

export function pickWebcamLayoutFields(webcam: WebcamOverlaySettings): WebcamLayoutFields {
	return {
		mirror: webcam.mirror,
		cropRegion: { ...webcam.cropRegion },
		corner: webcam.corner,
		positionPreset: webcam.positionPreset,
		positionX: webcam.positionX,
		positionY: webcam.positionY,
		size: webcam.size,
		reactToZoom: webcam.reactToZoom,
		cornerRadius: webcam.cornerRadius,
		shadow: webcam.shadow,
		margin: webcam.margin,
	};
}

export function stripWebcamPerRecordingFields(
	webcam: WebcamOverlaySettings,
): WebcamOverlaySettings {
	return {
		...webcam,
		...pickWebcamLayoutFields(webcam),
		enabled: false,
		sourcePath: null,
		timeOffsetMs: DEFAULT_WEBCAM_OVERLAY.timeOffsetMs,
	};
}
```

Note: if `DEFAULT_WEBCAM_OVERLAY` is not exported from `./types` under that exact name, check `src/components/video-editor/types.ts:190-205` for the actual export name and use it in both files.

- [ ] **Step 4: Run to verify PASS**, lint both files.
- [ ] **Step 5: Commit** — `git add RECORDLY/src/components/video-editor/webcamSettingsFields.*` → `git commit -m "Add webcam layout/per-recording field split helpers"`

---

### Task 2: Preset apply merges layout only; persistence strips per-recording fields

**Files:**
- Modify: `src/components/video-editor/VideoEditor.tsx:878` (`applyEditorPresetSnapshot`, inside lines 836-910)
- Modify: `src/components/video-editor/editorPreferences.ts:340` (`normalizeEditorControls` webcam line)
- Test: `src/components/video-editor/editorPreferences.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `editorPreferences.test.ts` (match its existing imports/setup style — read the top of the file first; it mocks storage):

```ts
	it("strips per-recording webcam fields from persisted preset snapshots", () => {
		const snapshot = serializeEditorPresetSnapshot({
			...basePresetSnapshot(), // reuse/extend the fixture pattern used by "preserves crop region in editor preset snapshots" (lines ~438-464)
			webcam: {
				...DEFAULT_EDITOR_PREFERENCES.webcam,
				enabled: true,
				sourcePath: "/tmp/old-recording.webcam.webm",
				timeOffsetMs: 500,
				positionX: 0.95,
				size: 32,
			},
		});
		const parsed = JSON.parse(snapshot);
		expect(parsed.webcam.sourcePath).toBeNull();
		expect(parsed.webcam.enabled).toBe(false);
		expect(parsed.webcam.positionX).toBe(0.95);
		expect(parsed.webcam.size).toBe(32);
	});
```

Adapt the fixture construction to the file's existing helpers — the test "preserves crop region in editor preset snapshots" (lines ~438-464) shows how snapshots are built there; mirror it exactly rather than inventing a `basePresetSnapshot()` if no such helper exists.

- [ ] **Step 2: Run to verify FAIL** — `npx vitest --run src/components/video-editor/editorPreferences.test.ts` → sourcePath survives serialization.

- [ ] **Step 3: Implement the persistence strip** — in `editorPreferences.ts`, import the helper and change the webcam line in `normalizeEditorControls` (line ~340):

```ts
import { stripWebcamPerRecordingFields } from "./webcamSettingsFields";
```

```ts
		webcam: stripWebcamPerRecordingFields(sanitizedRaw.webcam ?? fallback.webcam),
```

This covers BOTH preferences persistence and preset snapshots (both flow through `normalizeEditorControls`). Check the `webcam` line at ~405 (`normalized.webcam` in the save path) — if that path bypasses `normalizeEditorControls`, apply the same strip there.

- [ ] **Step 4: Implement the preset-apply merge** — in `VideoEditor.tsx` line 878, replace:

```ts
		setWebcam({ ...snapshot.webcam });
```

with:

```ts
		// Apply only layout fields: the preset's webcam source belongs to the
		// recording it was saved from, not the project it's applied to.
		setWebcam((current) => ({ ...current, ...pickWebcamLayoutFields(snapshot.webcam) }));
```

and add the import `import { pickWebcamLayoutFields } from "./webcamSettingsFields";` with the other `./` imports.

- [ ] **Step 5: Run tests** — `npx vitest --run src/components/video-editor/editorPreferences.test.ts src/components/video-editor/webcamSettingsFields.test.ts` → PASS, plus `npx vitest --run src/components/video-editor 2>&1 | tail -3` for no collateral failures. `npx tsc --noEmit` clean.

- [ ] **Step 6: Verify the preferences→fresh-recording flow is now safe by reading code** (no change expected): fresh recordings seed webcam from `initialEditorPreferences.webcam` (`VideoEditor.tsx:492-494`) — now always stripped (sourcePath null, enabled false) — and the recording session then sets `enabled`/`sourcePath`/`timeOffsetMs` (`VideoEditor.tsx:2414-2421`). Layout fields flow through untouched. If reading reveals a path where the stripped `enabled:false` breaks a recording WITH webcam (session update sets `enabled: Boolean(sessionWebcamPath)` — it does, so it's fine), report it instead of patching ad hoc.

- [ ] **Step 7: Commit** — `git commit -m "Apply webcam presets as layout-only merge; strip per-recording fields from persisted snapshots"`

---

### Task 3: Fix custom-position slider flicker

**Files:**
- Modify: `src/components/video-editor/VideoPlayback.tsx` (`applyWebcamBubbleLayout` at ~808-877; heavy layout effect deps at ~1070-1080)

This is a **verify-first** task (the root-cause hypothesis is high-confidence but unconfirmed).

- [ ] **Step 1: Confirm the root cause.** Run `npm run dev`, open a recording with webcam + auto-zoom regions, park the playhead inside a zoom region, open webcam settings → Custom position, drag Horizontal. Observe the webcam bubble (and possibly the whole stage) momentarily render at un-zoomed scale per tick. Then confirm mechanism in code: `applyWebcamBubbleLayout`'s `useCallback` deps include `webcamPositionX/Y/...` (lines 864-876), and the heavy stage-layout effect (deps list at ~1070-1080) lists `applyWebcamBubbleLayout` — so every slider tick re-runs the heavy effect, which resets `cameraContainer.scale.set(1)` (line ~1059) before the animation state reasserts. If the observed mechanism differs, STOP and report findings before changing code.

- [ ] **Step 2: Implement the decoupling.**

(a) Add a ref capturing the webcam layout inputs (near the other webcam consts, ~line 780):

```ts
		const webcamLayoutInputsRef = useRef({
			webcamEnabled,
			webcamMargin,
			webcamSize,
			webcamReactToZoom,
			webcamPositionPreset,
			webcamPositionX,
			webcamPositionY,
			webcamCorner,
			webcamCornerRadius,
			webcamShadow,
		});
		webcamLayoutInputsRef.current = {
			webcamEnabled,
			webcamMargin,
			webcamSize,
			webcamReactToZoom,
			webcamPositionPreset,
			webcamPositionX,
			webcamPositionY,
			webcamCorner,
			webcamCornerRadius,
			webcamShadow,
		};
```

(b) Change `applyWebcamBubbleLayout` to read every webcam value from `webcamLayoutInputsRef.current` instead of closure variables, and shrink its dep array to only what remains closed-over (`webcamVideoPath` may stay a dep, or also move into the ref — move it for a fully stable identity). The body keeps identical logic; only the value sources change.

(c) Add a lightweight effect after the callback so slider changes still update the bubble immediately:

```ts
		// Webcam layout inputs changed: restyle only the bubble. Must NOT run the
		// heavy stage-layout effect (it resets the zoom container and causes a
		// visible scale flicker while dragging position sliders).
		useEffect(() => {
			applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);
		}, [
			applyWebcamBubbleLayout,
			webcamEnabled,
			webcamMargin,
			webcamSize,
			webcamReactToZoom,
			webcamPositionPreset,
			webcamPositionX,
			webcamPositionY,
			webcamCorner,
			webcamCornerRadius,
			webcamShadow,
			webcamVideoPath,
		]);
```

(d) The heavy layout effect's dep list (~1070-1080) keeps `applyWebcamBubbleLayout` — now stable, so webcam field changes no longer re-run it. Do NOT remove it from the deps (lint correctness).

- [ ] **Step 3: Verify the fix.** `npx tsc --noEmit` clean; `npx biome check src/components/video-editor/VideoPlayback.tsx` no NEW complaints (compare pre-existing via `git stash && npx biome check ... && git stash pop` if any appear). Re-run the manual scenario from Step 1: dragging Horizontal/Vertical/size/margin sliders inside a zoom region must update the bubble smoothly with no transient scale jump, and zoom/playback behavior elsewhere must be unchanged (play through a zoom region; webcam follows as before).

- [ ] **Step 4: Run the video-editor suite** — `npx vitest --run src/components/video-editor 2>&1 | tail -3` → no new failures.

- [ ] **Step 5: Commit** — `git commit -m "Fix webcam preview flicker while dragging custom position sliders"`

---

### Task 4: Final verification

- [ ] **Step 1:** `npm test` (only the 1 pre-existing baseline failure), `npx tsc --noEmit` (clean), `npx biome check` on all touched files.
- [ ] **Step 2:** Manual end-to-end: in dev, open recording A → set custom position/size/crop → save preset → open a different recording B → apply preset → framing identical AND B's webcam video still plays (sourcePath untouched). Drag sliders → no flicker.
- [ ] **Step 3:** Commit any verification fixes.
