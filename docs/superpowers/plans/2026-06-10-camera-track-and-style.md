# Timeline Camera Track + Facecam Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show camera-full segments as an editable track on the timeline (drag edges, move, delete, double-click-to-add), and add a fit/fill facecam style chosen in the HUD before recording and changeable in the editor.

**Architecture:** The camera track copies the zoom-row pattern (row constant → `buildTimelineItems` entry → dnd bindings kind → selection/delete wiring → VideoEditor props). The style is a `"fit" | "fill"` value carried in the layout-events sidecar (v2), normalized into project state, and branched on in both renderers via a new `getCoverRect` pure function.

**Tech Stack:** React/TS, dnd-timeline, Pixi preview, WebCodecs exporter, vitest, Biome (TABS).

**Spec:** `docs/superpowers/specs/2026-06-10-camera-track-and-style-design.md`

**Conventions:** npm from `/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY`; git from `/Users/justmaiko/PROJECTS/Mini Tools`. Baseline: ONE pre-existing test failure (`electron/ipc/paths/binaries.test.ts`); tsc CLEAN. i18n keys must go to ALL 10 locales; `npm run i18n:check` may not gain new failures. Execute BEFORE the magnet/gaps plan (its display mapping wraps this track too).

---

### Task 1: Geometry + segment-editing pure functions (TDD)

**Files:**
- Modify: `src/components/video-editor/webcamLayoutRegions.ts`
- Test: `src/components/video-editor/webcamLayoutRegions.test.ts` (extend)

- [ ] **Step 1: Failing tests** — append to the existing test file:

```ts
describe("getCoverRect", () => {
	it("covers the frame, cropping the long axis, centered", () => {
		const rect = getCoverRect({ width: 1600, height: 900 }, { width: 1000, height: 1000 });
		// scale = max(1000/1600, 1000/900) = 1.111... -> 1777.8 x 1000
		expect(rect.height).toBeCloseTo(1000);
		expect(rect.width).toBeCloseTo(1000 * (1600 / 900));
		expect(rect.x).toBeCloseTo((1000 - 1000 * (1600 / 900)) / 2);
		expect(rect.y).toBeCloseTo(0);
	});

	it("degrades safely on invalid content", () => {
		expect(getCoverRect({ width: 0, height: 0 }, { width: 1000, height: 500 })).toEqual({
			x: 0,
			y: 0,
			width: 1000,
			height: 500,
		});
	});
});

describe("clampWebcamLayoutSpan", () => {
	const others = [
		{ id: "a", startMs: 1000, endMs: 2000 },
		{ id: "b", startMs: 5000, endMs: 6000 },
	];

	it("clamps to neighbors and duration", () => {
		expect(
			clampWebcamLayoutSpan({ startMs: 1500, endMs: 5500 }, others, "x", 10000),
		).toEqual({ startMs: 2000, endMs: 5000 });
		expect(clampWebcamLayoutSpan({ startMs: -50, endMs: 800 }, others, "x", 10000)).toEqual({
			startMs: 0,
			endMs: 800,
		});
		expect(
			clampWebcamLayoutSpan({ startMs: 9500, endMs: 12000 }, others, "x", 10000),
		).toEqual({ startMs: 9500, endMs: 10000 });
	});

	it("ignores the region's own id and enforces minimum length", () => {
		expect(
			clampWebcamLayoutSpan({ startMs: 1000, endMs: 1010 }, others, "a", 10000),
		).toEqual({ startMs: 1000, endMs: 1100 });
		expect(clampWebcamLayoutSpan({ startMs: 3000, endMs: 3010 }, others, "x", 10000)).toEqual(
			{ startMs: 3000, endMs: 3100 },
		);
	});

	it("returns null when no valid placement exists", () => {
		expect(
			clampWebcamLayoutSpan({ startMs: 1200, endMs: 1300 }, others, "x", 10000),
		).toBeNull();
	});
});

describe("normalizeWebcamLayoutStyle", () => {
	it("accepts fit/fill and falls back to fit", () => {
		expect(normalizeWebcamLayoutStyle("fill")).toBe("fill");
		expect(normalizeWebcamLayoutStyle("fit")).toBe("fit");
		expect(normalizeWebcamLayoutStyle("bogus")).toBe("fit");
		expect(normalizeWebcamLayoutStyle(undefined)).toBe("fit");
	});
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest --run src/components/video-editor/webcamLayoutRegions.test.ts`.
- [ ] **Step 3: Implement** — add to `webcamLayoutRegions.ts`:

```ts
export type WebcamLayoutStyle = "fit" | "fill";

export const MIN_WEBCAM_LAYOUT_REGION_MS = 100;

export function normalizeWebcamLayoutStyle(value: unknown): WebcamLayoutStyle {
	return value === "fill" ? "fill" : "fit";
}

/** Largest content-aspect rect that fully covers the frame, centered (crops overflow). */
export function getCoverRect(content: SizeLike, frame: SizeLike): LetterboxRect {
	if (
		!Number.isFinite(content.width) ||
		!Number.isFinite(content.height) ||
		content.width <= 0 ||
		content.height <= 0
	) {
		return { x: 0, y: 0, width: frame.width, height: frame.height };
	}
	const scale = Math.max(frame.width / content.width, frame.height / content.height);
	const width = content.width * scale;
	const height = content.height * scale;
	return {
		x: (frame.width - width) / 2,
		y: (frame.height - height) / 2,
		width,
		height,
	};
}

/**
 * Clamps a dragged/resized camera segment span against its neighbors and the
 * video duration. Returns null when the span cannot fit anywhere valid.
 */
export function clampWebcamLayoutSpan(
	span: { startMs: number; endMs: number },
	regions: WebcamLayoutRegion[],
	ownId: string,
	durationMs: number,
): { startMs: number; endMs: number } | null {
	const others = regions
		.filter((region) => region.id !== ownId)
		.sort((a, b) => a.startMs - b.startMs);

	let startMs = Math.max(0, Math.round(span.startMs));
	let endMs = Math.min(durationMs, Math.round(span.endMs));

	for (const other of others) {
		// Clamp the span out of each overlapping neighbor, preferring the side
		// the span already leans toward.
		const overlaps = startMs < other.endMs && endMs > other.startMs;
		if (!overlaps) continue;
		if (startMs >= other.startMs) {
			startMs = Math.max(startMs, other.endMs);
		} else {
			endMs = Math.min(endMs, other.startMs);
		}
	}

	if (endMs - startMs < MIN_WEBCAM_LAYOUT_REGION_MS) {
		endMs = startMs + MIN_WEBCAM_LAYOUT_REGION_MS;
		if (endMs > durationMs) return null;
		// Re-check the stretched span against neighbors.
		for (const other of others) {
			if (startMs < other.endMs && endMs > other.startMs) return null;
		}
	}

	return startMs < endMs ? { startMs, endMs } : null;
}
```

- [ ] **Step 4: Run to verify PASS**; lint. Adjust the clamp implementation if any listed expectation fails — the TESTS are the contract.
- [ ] **Step 5: Commit** — `git commit -m "Add cover-rect geometry and camera segment clamping primitives"`

---

### Task 2: Style end-to-end plumbing (sidecar v2 + HUD popover + editor state)

**Files:**
- Modify: `electron/ipc/recording/webcamLayoutEvents.ts` + its test (style in sidecar)
- Modify: `electron/windows.ts` (cache style next to `selectedWebcamDeviceId`), `electron/preload.ts`, `electron/electron-env.d.ts`
- Modify: `src/components/launch/popovers/WebcamPopover.tsx`, `src/components/launch/LaunchWindow.tsx`
- Modify: `src/components/video-editor/projectPersistence.ts` (+ its webcamLayout test), `src/components/video-editor/VideoEditor.tsx`, `src/components/video-editor/SettingsPanel.tsx`
- Modify: all 10 `src/i18n/locales/*/launch.json` and `*/settings.json`

- [ ] **Step 1: Sidecar v2 (TDD).** Failing tests first in `electron/ipc/recording/webcamLayoutEvents.test.ts`:

```ts
	it("persists the layout style and reads it back, defaulting v1 sidecars to fit", async () => {
		beginWebcamLayoutSession();
		setWebcamLayoutSessionStyle("fill");
		recordWebcamLayoutEvent({ timeMs: 5000, mode: "camera-full" });
		await persistWebcamLayoutEvents(videoPath);

		const raw = JSON.parse(await fs.readFile(getWebcamLayoutEventsPath(videoPath), "utf8"));
		expect(raw.version).toBe(2);
		expect(raw.style).toBe("fill");

		const read = await readWebcamLayoutSidecar(videoPath);
		expect(read.style).toBe("fill");
		expect(read.events).toHaveLength(1);

		// v1 compatibility
		await fs.writeFile(
			getWebcamLayoutEventsPath(videoPath),
			JSON.stringify({ version: 1, events: [{ timeMs: 1, mode: "camera-full" }] }),
		);
		const v1 = await readWebcamLayoutSidecar(videoPath);
		expect(v1.style).toBe("fit");
		expect(v1.events).toHaveLength(1);
	});
```

Implement in `webcamLayoutEvents.ts`: module state `sessionStyle: "fit" | "fill" = "fit"` reset in `beginWebcamLayoutSession()`; `export function setWebcamLayoutSessionStyle(style)` (validate, default fit); persist writes `{ version: 2, style: sessionStyle, events }`; add `readWebcamLayoutSidecar(videoPath): Promise<{ style: "fit" | "fill"; events: WebcamLayoutEvent[] }>` (keep the existing `readWebcamLayoutEvents` delegating to it for compatibility). Update the existing IPC handler `get-webcam-layout-events` in `electron/ipc/register/recording.ts` to return `{ success, style, events }` via the new reader.

- [ ] **Step 2: HUD style choice.** In `electron/windows.ts` next to the `webcam-device-changed` handler: `let selectedWebcamLayoutStyle = "fit";` + `ipcMain.on("webcam-layout-style-changed", ...)` caching a validated value, and have the recording-start path apply it: in `electron/main.ts` where `beginWebcamLayoutSession()` is called, also call `setWebcamLayoutSessionStyle(getSelectedWebcamLayoutStyle())` (export a getter from windows.ts; import the setter from webcamLayoutEvents). Preload + env.d.ts: `webcamLayoutStyleChanged(style: "fit" | "fill"): void`. In `LaunchWindow.tsx`: persist the choice in localStorage (`recordly-webcam-layout-style`), push on mount + change (same `useEffect` pattern as `webcamDeviceChanged`). In `WebcamPopover.tsx`: a two-item style selector after the floating-preview item — two `DropdownItem`s (selected state per current style) labeled `t("recording.webcamStyleFit", "Camera fullscreen: fit with background")` and `t("recording.webcamStyleFill", "Camera fullscreen: fill screen")`, wired via two new props (`webcamLayoutStyle`, `onWebcamLayoutStyleChange`) passed from LaunchWindow. i18n keys in all 10 `launch.json` (translate naturally; en values as above).

- [ ] **Step 3: Editor state.** `projectPersistence.ts`: add `webcamLayoutStyle: WebcamLayoutStyle` to `ProjectEditorState`, normalized via `normalizeWebcamLayoutStyle` (default fit) — extend `projectPersistence.webcamLayout.test.ts` first (failing):

```ts
	it("normalizes webcam layout style", () => {
		expect(normalizeProjectEditor({}).webcamLayoutStyle).toBe("fit");
		expect(normalizeProjectEditor({ webcamLayoutStyle: "fill" }).webcamLayoutStyle).toBe("fill");
		expect(normalizeProjectEditor({ webcamLayoutStyle: "junk" }).webcamLayoutStyle).toBe("fit");
	});
```

`VideoEditor.tsx`: state `webcamLayoutStyle` (default "fit"); set from `normalizedEditor` on project open; include in the persisted-state payload (same funnel as `webcamLayoutRegions` — `buildPersistedEditorState` + `currentPersistedEditorState` memo + deps); seed from the sidecar on fresh load (the existing sidecar-load effect now receives `style` — apply it with the same only-if-unset spirit: track whether the project provided one; simplest correct rule: apply sidecar style only when also seeding regions from the sidecar, i.e. inside the same `current.length > 0 ? current : ...` branch — restructure that setter into an explicit `if` so both states update together). Pass to `<VideoPlayback webcamLayoutStyle={...}>` and into the export config (`webcamLayoutStyle` field added to `FrameRenderConfig` + `VideoExporterConfig` + pass-through, like `webcamLayoutRegions` was). `SettingsPanel.tsx`: next to the "Use recorded camera switches" row, a small two-option segmented/select control bound to three new props (`webcamLayoutStyle`, `onWebcamLayoutStyleChange`, visible under the same `webcamLayoutRegionsAvailable` gate) with label `tSettings("effects.webcamLayoutStyle", "Camera fullscreen style")` and option labels `tSettings("effects.webcamLayoutStyleFit", "Fit with background")` / `tSettings("effects.webcamLayoutStyleFill", "Fill screen")` — copy whichever two-option control pattern already exists in SettingsPanel (grep for a segmented/two-button group; else two small Buttons with selected styling). i18n keys in all 10 `settings.json`.

- [ ] **Step 4: Verify** — vitest (electron + video-editor suites), tsc, biome, i18n:check (no new failures). **Commit** — `git commit -m "Carry facecam fullscreen style from HUD through sidecar into project state"`

---

### Task 3: Renderers honor fit/fill

**Files:**
- Modify: `src/components/video-editor/VideoPlayback.tsx` (camera-full branch in `applyWebcamBubbleLayout`)
- Modify: `src/lib/exporter/modernFrameRenderer.ts` (camera-full branch in `updateWebcamOverlay`)
- Test: extend `src/lib/exporter/modernFrameRenderer.test.ts` (the existing camera-full layout test seam)

- [ ] **Step 1: Preview.** `VideoPlayback.tsx` gains prop `webcamLayoutStyle?: "fit" | "fill"` (default "fit"), mirrored into `latestWebcamLayoutInputs`. In the camera-full branch: when style is `fill`, use `getCoverRect(croppedDims, { width: overlay.clientWidth, height: overlay.clientHeight })` (no padding), set the bubble rect to the FRAME (x:0, y:0, overlay size) with the inner video positioned by the cover rect — simplest faithful approach given the existing structure: keep the bubble at the full overlay rect with `clipPath` removed (no squircle), no drop-shadow, and let the existing inner "cover" crop math fill it (it already covers a bubble of any aspect — with the bubble at the frame's aspect, cover crops exactly as `getCoverRect` describes). So `fill` = bubble rect {0, 0, overlayW, overlayH}, no squircle clip (reset `clipPath` to `none`), `filter: none`. `fit` = current behavior. Ensure switching styles resets the styles it doesn't set (clipPath/filter must be explicitly restored in fit + bubble modes — they already are set every call; verify and set `clipPath`/`filter` explicitly in ALL branches).
- [ ] **Step 2: Export.** `modernFrameRenderer.ts`: config field `webcamLayoutStyle` (added in Task 2); in the camera-full path, when `fill`: layout rect = full output frame `{x:0, y:0, width: config.width, height: config.height}` with mask radius 0 and shadow disabled, relying on the existing sprite cover-fit within the layout rect to crop. Extend the existing camera-full unit test with a `fill` case asserting the webcam layout rect equals the full frame and the screen container is hidden.
- [ ] **Step 3: Verify** — `npx vitest --run src/lib/exporter src/components/video-editor` (no new failures), tsc, biome. **Commit** — `git commit -m "Render facecam fill style in preview and export"`

---

### Task 4: Camera track on the timeline

**Files:**
- Modify: `src/components/video-editor/timeline/core/constants.ts` (add `CAMERA_ROW_ID = "row-camera"`)
- Modify: `src/components/video-editor/timeline/model/timelineModel.ts:34-90` (`buildTimelineItems` — camera items, `variant: "camera"`)
- Modify: `src/components/video-editor/timeline/TimelineEditor.tsx:33-79` (props) and its row rendering (add the camera row, slim height, rendered above/below the zoom row matching existing row markup)
- Modify: `src/components/video-editor/timeline/hooks/useTimelineDndBindings.ts:33-178` (`resolveItemKind` + `handleItemSpanChange` camera case)
- Modify: `src/components/video-editor/timeline/Item.tsx` (camera variant styling — blue bar, reuse existing variant styling switch; find how `variant` maps to classes and add "camera" with blue fill e.g. `bg-blue-500/70 border-blue-400`)
- Modify: `src/components/video-editor/timeline/hooks/useTimelineSelection.ts` (selectedCameraId + deleteSelectedCamera), `timeline/hooks/utils/timelineSelectionUtils.ts` (target "camera"), `timeline/hooks/useTimelineKeyboardShortcuts.ts:93-120` (delete dispatch)
- Modify: `src/components/video-editor/TimelineCanvas.tsx` only if row hover/click plumbing requires it for double-click-add (see Step 3)
- Modify: `src/components/video-editor/VideoEditor.tsx` (handlers + props at the `<TimelineEditor>` call ~6302-6349)
- Test: `src/components/video-editor/timeline/model/timelineModel.test.ts` if it exists (grep; extend with camera items), else rely on the pure clamp tests from Task 1 + manual.

- [ ] **Step 1: Read the zoom-row pattern end to end first** (all files above) — the explorer-confirmed flow: VideoEditor props → `buildTimelineItems` → row render → `useItem` drag/resize → `handleItemSpanChange(id, span, rowId)` → parent callback. Copy it for camera with these specifics:
  - Items: `{ id, rowId: CAMERA_ROW_ID, span: { start: region.startMs, end: region.endMs }, label: "Camera", variant: "camera" }`.
  - The row renders only when `cameraRegions.length > 0 || cameraTrackVisible` (pass `cameraTrackVisible = webcam available` from VideoEditor; spec: track shown when webcam usable).
  - When `webcamLayoutRegionsEnabled` is false, pass a `disabled`/dimmed visual (Item has a `disabled` prop per `useItem({ disabled })`; use a dimmed class instead so segments stay editable — spec says dimmed, still gating only rendering).
- [ ] **Step 2: VideoEditor handlers** (place near `handleZoomSpanChange` siblings):

```ts
	const handleCameraSpanChange = useCallback(
		(id: string, span: { start: number; end: number }) => {
			setWebcamLayoutRegions((prev) => {
				const clamped = clampWebcamLayoutSpan(
					{ startMs: span.start, endMs: span.end },
					prev,
					id,
					Math.round(duration * 1000),
				);
				if (!clamped) return prev;
				return prev
					.map((region) =>
						region.id === id ? { ...region, startMs: clamped.startMs, endMs: clamped.endMs } : region,
					)
					.sort((a, b) => a.startMs - b.startMs);
			});
		},
		[duration],
	);

	const handleCameraDelete = useCallback((id: string) => {
		setWebcamLayoutRegions((prev) => prev.filter((region) => region.id !== id));
	}, []);

	const handleCameraAddAtMs = useCallback(
		(timeMs: number) => {
			setWebcamLayoutRegions((prev) => {
				const span = clampWebcamLayoutSpan(
					{ startMs: timeMs, endMs: timeMs + 3000 },
					prev,
					"",
					Math.round(duration * 1000),
				);
				if (!span) return prev;
				return [
					...prev,
					{ id: `webcam-layout-${Date.now()}-${Math.round(span.startMs)}`, ...span },
				].sort((a, b) => a.startMs - b.startMs);
			});
		},
		[duration],
	);
```

(`duration` is the source duration in seconds in VideoEditor — verify the actual variable name and use it.) Pass regions + handlers + `selectedCameraId` state through TimelineEditor props.
- [ ] **Step 3: Double-click to add.** Follow the zoom row's hover/click pattern (`TimelineCanvas.tsx:173-186` uses single-click with `zoomRowHoverMs`); implement the camera row with `onDoubleClick` on the row element using the same hover-ms tracking (or `pixelsToValue` of the event offset, matching however the zoom row computes hover ms). Empty-space only: ignore if the ms falls inside an existing region.
- [ ] **Step 4: Selection + delete.** Extend `resolveDeleteSelectionTarget` (+ its test if one exists — grep `timelineSelectionUtils.test`), `useTimelineSelection`, `useTimelineKeyboardShortcuts` per the zoom/clip pattern. Clicking a camera item selects it (Item click → `onSelectCamera(id)` — copy how zoom items select).
- [ ] **Step 5: Verify** — tsc, biome on touched files, `npx vitest --run src/components/video-editor` no new failures. Manual (dev): record/open a project with camera segments → blue bars on the track; drag edges/body (clamped, no overlap), double-click adds, select+Delete removes; preview cuts follow edits live; checkbox-off dims the bars.
- [ ] **Step 6: Commit** — `git commit -m "Add editable camera-full track to the timeline"`

---

### Task 5: Final verification

- [ ] **Step 1:** `npm test` (only the 1 pre-existing failure), `npx tsc --noEmit` clean, `npm run i18n:check` no new failures, biome on all touched files.
- [ ] **Step 2:** Manual end-to-end: HUD → pick "Fill screen" style → record with toggles → editor shows fill-style camera-full + segments on track → switch style in settings → preview + export flip style; export MP4 with edited segments matches the timeline.
- [ ] **Step 3:** Commit fixes if any.
