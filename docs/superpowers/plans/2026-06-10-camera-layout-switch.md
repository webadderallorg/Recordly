# In-Recording Camera/Screen Layout Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A HUD button + global `Alt+F10` hotkey during recording stamps timestamped layout events; the editor converts them to camera-full segments that hard-cut the preview and export between "webcam letterboxed over background" and the normal screen+bubble layout.

**Architecture:** The HUD renderer owns the toggle state and the pause-adjusted clock (`getRecordingDurationMs` in `useScreenRecorder`); each toggle sends `{timeMs, mode}` to the main process, which accumulates events and writes a sidecar JSON at finalize (cursor-telemetry pattern). The editor reads the sidecar into `WebcamLayoutRegion[]`, persists them in the project, and both the Pixi preview and the WebCodecs export renderer hide the screen layer + letterbox the webcam during active regions. The native static-layout export gains one skip reason.

**Tech Stack:** Electron IPC + globalShortcut, React/TS, Pixi (preview), WebCodecs exporter, vitest, Biome (TABS).

**Spec:** `docs/superpowers/specs/2026-06-10-camera-layout-switch-design.md`

**Conventions:** npm from `/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY`; git from `/Users/justmaiko/PROJECTS/Mini Tools`. Baseline: ONE pre-existing test failure (`electron/ipc/paths/binaries.test.ts`); tsc clean. New `t()` keys go to ALL 10 locales (launch.json for HUD strings, settings.json for the editor checkbox); `npm run i18n:check` must show no NEW failures. **Execute AFTER the presets+flicker plan** — Task 6 builds on the ref-based `applyWebcamBubbleLayout` from that plan.

---

### Task 1: Pure regions + geometry module (TDD)

**Files:**
- Create: `src/components/video-editor/webcamLayoutRegions.ts`
- Test: `src/components/video-editor/webcamLayoutRegions.test.ts`

- [ ] **Step 1: Failing test** — `webcamLayoutRegions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	eventsToWebcamLayoutRegions,
	getLetterboxRect,
	isCameraFullAtMs,
	type WebcamLayoutEvent,
} from "./webcamLayoutRegions";

describe("eventsToWebcamLayoutRegions", () => {
	it("pairs camera-full/screen events into regions", () => {
		const events: WebcamLayoutEvent[] = [
			{ timeMs: 5000, mode: "camera-full" },
			{ timeMs: 9000, mode: "screen" },
			{ timeMs: 20000, mode: "camera-full" },
			{ timeMs: 31000, mode: "screen" },
		];
		const regions = eventsToWebcamLayoutRegions(events);
		expect(regions.map((r) => [r.startMs, r.endMs])).toEqual([
			[5000, 9000],
			[20000, 31000],
		]);
		expect(regions[0].id).not.toBe(regions[1].id);
	});

	it("extends an unterminated camera-full segment to the end", () => {
		const regions = eventsToWebcamLayoutRegions([{ timeMs: 5000, mode: "camera-full" }]);
		expect(regions).toHaveLength(1);
		expect(regions[0].endMs).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("dedupes consecutive same-mode events and sorts by time", () => {
		const regions = eventsToWebcamLayoutRegions([
			{ timeMs: 9000, mode: "screen" },
			{ timeMs: 5000, mode: "camera-full" },
			{ timeMs: 6000, mode: "camera-full" },
		]);
		expect(regions.map((r) => [r.startMs, r.endMs])).toEqual([[5000, 9000]]);
	});

	it("drops zero-length segments and ignores leading screen events", () => {
		expect(
			eventsToWebcamLayoutRegions([
				{ timeMs: 0, mode: "screen" },
				{ timeMs: 5000, mode: "camera-full" },
				{ timeMs: 5000, mode: "screen" },
			]),
		).toEqual([]);
	});

	it("ignores invalid events", () => {
		expect(
			eventsToWebcamLayoutRegions([
				{ timeMs: Number.NaN, mode: "camera-full" },
				{ timeMs: -5, mode: "camera-full" },
			]),
		).toEqual([]);
	});
});

describe("isCameraFullAtMs", () => {
	const regions = eventsToWebcamLayoutRegions([
		{ timeMs: 5000, mode: "camera-full" },
		{ timeMs: 9000, mode: "screen" },
	]);
	it("is true inside and false outside (end exclusive)", () => {
		expect(isCameraFullAtMs(regions, 4999)).toBe(false);
		expect(isCameraFullAtMs(regions, 5000)).toBe(true);
		expect(isCameraFullAtMs(regions, 8999)).toBe(true);
		expect(isCameraFullAtMs(regions, 9000)).toBe(false);
	});
});

describe("getLetterboxRect", () => {
	it("fits wide content into a taller frame, centered, with padding", () => {
		const rect = getLetterboxRect({ width: 1600, height: 900 }, { width: 1000, height: 1000 }, 50);
		// available 900x900; 16:9 fit -> 900x506.25
		expect(rect.width).toBeCloseTo(900);
		expect(rect.height).toBeCloseTo(506.25);
		expect(rect.x).toBeCloseTo(50);
		expect(rect.y).toBeCloseTo((1000 - 506.25) / 2);
	});

	it("fits tall content into a wider frame", () => {
		const rect = getLetterboxRect({ width: 900, height: 1600 }, { width: 1920, height: 1080 }, 0);
		expect(rect.height).toBeCloseTo(1080);
		expect(rect.width).toBeCloseTo(1080 * (900 / 1600));
		expect(rect.y).toBeCloseTo(0);
	});

	it("degrades safely on invalid input", () => {
		const rect = getLetterboxRect({ width: 0, height: 0 }, { width: 1000, height: 500 }, 10);
		expect(rect).toEqual({ x: 10, y: 10, width: 980, height: 480 });
	});
});
```

- [ ] **Step 2: Run to verify FAIL** (module not found).
- [ ] **Step 3: Implement** — `webcamLayoutRegions.ts`:

```ts
export type WebcamLayoutMode = "screen" | "camera-full";

export interface WebcamLayoutEvent {
	timeMs: number;
	mode: WebcamLayoutMode;
}

export interface WebcamLayoutRegion {
	id: string;
	startMs: number;
	endMs: number;
}

interface SizeLike {
	width: number;
	height: number;
}

export interface LetterboxRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

function isValidEvent(event: WebcamLayoutEvent): boolean {
	return (
		Number.isFinite(event.timeMs) &&
		event.timeMs >= 0 &&
		(event.mode === "screen" || event.mode === "camera-full")
	);
}

/**
 * Converts recording-time toggle events into camera-full regions. Recording
 * starts in "screen" mode implicitly; an unterminated camera-full segment
 * runs to MAX_SAFE_INTEGER (renderers clamp to the video duration).
 */
export function eventsToWebcamLayoutRegions(events: WebcamLayoutEvent[]): WebcamLayoutRegion[] {
	const sorted = events.filter(isValidEvent).sort((a, b) => a.timeMs - b.timeMs);
	const regions: WebcamLayoutRegion[] = [];
	let openStartMs: number | null = null;

	for (const event of sorted) {
		if (event.mode === "camera-full") {
			if (openStartMs === null) {
				openStartMs = event.timeMs;
			}
		} else if (openStartMs !== null) {
			if (event.timeMs > openStartMs) {
				regions.push({
					id: `webcam-layout-${openStartMs}-${event.timeMs}`,
					startMs: openStartMs,
					endMs: event.timeMs,
				});
			}
			openStartMs = null;
		}
	}

	if (openStartMs !== null) {
		regions.push({
			id: `webcam-layout-${openStartMs}-end`,
			startMs: openStartMs,
			endMs: Number.MAX_SAFE_INTEGER,
		});
	}

	return regions;
}

export function isCameraFullAtMs(regions: WebcamLayoutRegion[], timeMs: number): boolean {
	return regions.some((region) => timeMs >= region.startMs && timeMs < region.endMs);
}

/** Largest content-aspect rect centered inside frame minus padding on all sides. */
export function getLetterboxRect(
	content: SizeLike,
	frame: SizeLike,
	paddingPx: number,
): LetterboxRect {
	const availableWidth = Math.max(0, frame.width - paddingPx * 2);
	const availableHeight = Math.max(0, frame.height - paddingPx * 2);
	if (
		!Number.isFinite(content.width) ||
		!Number.isFinite(content.height) ||
		content.width <= 0 ||
		content.height <= 0
	) {
		return { x: paddingPx, y: paddingPx, width: availableWidth, height: availableHeight };
	}

	const scale = Math.min(availableWidth / content.width, availableHeight / content.height);
	const width = content.width * scale;
	const height = content.height * scale;
	return {
		x: paddingPx + (availableWidth - width) / 2,
		y: paddingPx + (availableHeight - height) / 2,
		width,
		height,
	};
}
```

- [ ] **Step 4: Run to verify PASS**; lint.
- [ ] **Step 5: Commit** — `git commit -m "Add webcam layout regions and letterbox geometry primitives"`

---

### Task 2: Main process — event log, sidecar write/read, Alt+F10

**Files:**
- Create: `electron/ipc/recording/webcamLayoutEvents.ts`
- Test: `electron/ipc/recording/webcamLayoutEvents.test.ts`
- Modify: `electron/main.ts` (the `onRecordingStateChange` callback registered ~lines 974-985)
- Modify: `electron/ipc/recording/mac.ts` (`finalizeStoredVideo`, after `persistPendingCursorTelemetry` at line ~226 — this function finalizes BOTH mac and windows recordings)
- Modify: `electron/ipc/register/recording.ts` (new `ipcMain` handlers, near `get-video-audio-fallback-paths` at line ~1387)
- Modify: `electron/teleprompterShortcuts.ts` OR a new sibling module for the Alt+F10 registration helper

- [ ] **Step 1: Failing test** — `webcamLayoutEvents.test.ts` (use `vi.mock("node:fs/promises")` or a temp dir via `os.tmpdir()` — follow the style of `electron/ipc/recording/diagnostics.test.ts` which tests sidecar IO):

```ts
import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	beginWebcamLayoutSession,
	getWebcamLayoutEventsPath,
	persistWebcamLayoutEvents,
	readWebcamLayoutEvents,
	recordWebcamLayoutEvent,
} from "./webcamLayoutEvents";

describe("webcam layout events session", () => {
	let videoPath: string;

	beforeEach(async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-layout-"));
		videoPath = path.join(dir, "recording.mp4");
	});

	it("persists recorded events as a sidecar and reads them back", async () => {
		beginWebcamLayoutSession();
		recordWebcamLayoutEvent({ timeMs: 5000, mode: "camera-full" });
		recordWebcamLayoutEvent({ timeMs: 9000, mode: "screen" });
		await persistWebcamLayoutEvents(videoPath);

		const raw = JSON.parse(await fs.readFile(getWebcamLayoutEventsPath(videoPath), "utf8"));
		expect(raw.version).toBe(1);
		expect(raw.events).toHaveLength(2);

		const read = await readWebcamLayoutEvents(videoPath);
		expect(read).toEqual([
			{ timeMs: 5000, mode: "camera-full" },
			{ timeMs: 9000, mode: "screen" },
		]);
	});

	it("writes nothing when no events were recorded", async () => {
		beginWebcamLayoutSession();
		await persistWebcamLayoutEvents(videoPath);
		await expect(fs.stat(getWebcamLayoutEventsPath(videoPath))).rejects.toThrow();
	});

	it("ignores events outside a session and invalid payloads", async () => {
		recordWebcamLayoutEvent({ timeMs: 5000, mode: "camera-full" }); // no session begun
		beginWebcamLayoutSession();
		recordWebcamLayoutEvent({ timeMs: Number.NaN, mode: "camera-full" } as never);
		recordWebcamLayoutEvent({ timeMs: 5, mode: "bogus" } as never);
		await persistWebcamLayoutEvents(videoPath);
		await expect(fs.stat(getWebcamLayoutEventsPath(videoPath))).rejects.toThrow();
	});

	it("returns empty array for missing/corrupt sidecars", async () => {
		expect(await readWebcamLayoutEvents(videoPath)).toEqual([]);
		await fs.writeFile(getWebcamLayoutEventsPath(videoPath), "not json");
		expect(await readWebcamLayoutEvents(videoPath)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** — `electron/ipc/recording/webcamLayoutEvents.ts`:

```ts
import fs from "node:fs/promises";

export type WebcamLayoutMode = "screen" | "camera-full";

export interface WebcamLayoutEvent {
	timeMs: number;
	mode: WebcamLayoutMode;
}

let sessionEvents: WebcamLayoutEvent[] | null = null;

export function getWebcamLayoutEventsPath(videoPath: string): string {
	return `${videoPath}.webcam-layout-events.json`;
}

export function beginWebcamLayoutSession(): void {
	sessionEvents = [];
}

function isValidEvent(event: WebcamLayoutEvent): boolean {
	return (
		Number.isFinite(event?.timeMs) &&
		event.timeMs >= 0 &&
		(event.mode === "screen" || event.mode === "camera-full")
	);
}

export function recordWebcamLayoutEvent(event: WebcamLayoutEvent): void {
	if (!sessionEvents || !isValidEvent(event)) {
		return;
	}
	sessionEvents.push({ timeMs: Math.round(event.timeMs), mode: event.mode });
}

/** Writes the sidecar next to the final video and ends the session. No-op without events. */
export async function persistWebcamLayoutEvents(videoPath: string): Promise<void> {
	const events = sessionEvents;
	sessionEvents = null;
	if (!events || events.length === 0) {
		return;
	}
	try {
		await fs.writeFile(
			getWebcamLayoutEventsPath(videoPath),
			JSON.stringify({ version: 1, events }),
			"utf8",
		);
	} catch (error) {
		console.warn("[webcam-layout] Failed to persist layout events:", error);
	}
}

export async function readWebcamLayoutEvents(videoPath: string): Promise<WebcamLayoutEvent[]> {
	try {
		const raw = await fs.readFile(getWebcamLayoutEventsPath(videoPath), "utf8");
		const parsed = JSON.parse(raw) as { events?: WebcamLayoutEvent[] };
		return Array.isArray(parsed.events) ? parsed.events.filter(isValidEvent) : [];
	} catch {
		return [];
	}
}
```

- [ ] **Step 4: Run to verify PASS.**

- [ ] **Step 5: Wire lifecycle + hotkey.**

(a) In `electron/teleprompterShortcuts.ts` add (same warn-and-continue style as the existing functions):

```ts
const CAMERA_LAYOUT_SHORTCUT = "Alt+F10";

export function registerCameraLayoutShortcut(onPressed: () => void): void {
	try {
		const registered = globalShortcut.register(CAMERA_LAYOUT_SHORTCUT, onPressed);
		if (!registered) {
			console.warn(`[camera-layout] Could not register global shortcut ${CAMERA_LAYOUT_SHORTCUT}`);
		}
	} catch (error) {
		console.warn(
			`[camera-layout] Could not register global shortcut ${CAMERA_LAYOUT_SHORTCUT}:`,
			error,
		);
	}
}

export function unregisterCameraLayoutShortcut(): void {
	try {
		globalShortcut.unregister(CAMERA_LAYOUT_SHORTCUT);
	} catch {
		// Best effort.
	}
}
```

(b) In `electron/main.ts`, locate the `onRecordingStateChange` callback (registered with `registerIpcHandlers`/recording registration around lines 974-985 — find it by grepping `onRecordingStateChange`). Verify it fires with `recording: true` on start and `false` on stop for the macOS native path (trace from `recording.ts` broadcast sites at ~845-849 and ~1845-1849; if start does NOT route through the callback, hook the same locations where `"recording-state-changed"` is broadcast). Add:

```ts
// on recording start:
beginWebcamLayoutSession();
registerCameraLayoutShortcut(() => {
	getHudOverlayWindow()?.webContents.send("webcam-layout-hotkey");
});
// on recording stop:
unregisterCameraLayoutShortcut();
```

with imports from `./ipc/recording/webcamLayoutEvents` and `./teleprompterShortcuts`; `getHudOverlayWindow` is already exported from `./windows` (check the existing import block).

(c) In `electron/ipc/recording/mac.ts` `finalizeStoredVideo`, after `persistPendingCursorTelemetry(videoPath)` (line ~226, inside its try or as a sibling step):

```ts
	await persistWebcamLayoutEvents(videoPath);
```

import from `./webcamLayoutEvents`.

(d) In `electron/ipc/register/recording.ts`, near `get-video-audio-fallback-paths` (~1387):

```ts
	ipcMain.on("webcam-layout-toggle", (_event, payload: { timeMs: number; mode: string }) => {
		recordWebcamLayoutEvent({
			timeMs: payload?.timeMs,
			mode: payload?.mode as WebcamLayoutMode,
		});
	});

	ipcMain.handle("get-webcam-layout-events", async (_event, videoPath: string) => {
		if (!videoPath) {
			return { success: true, events: [] };
		}
		return { success: true, events: await readWebcamLayoutEvents(videoPath) };
	});
```

- [ ] **Step 6: Verify** — `npx tsc --noEmit`, `npx vitest --run electron/` (only the 1 pre-existing failure), biome on touched files.
- [ ] **Step 7: Commit** — `git commit -m "Record webcam layout toggle events and persist sidecar at finalize"`

---

### Task 3: Preload bridge + types

**Files:**
- Modify: `electron/preload.ts` (next to the teleprompter methods, ~lines 185-205)
- Modify: `electron/electron-env.d.ts` (next to the teleprompter types)

- [ ] **Step 1: Preload additions:**

```ts
	webcamLayoutToggle: (payload: { timeMs: number; mode: "screen" | "camera-full" }) => {
		ipcRenderer.send("webcam-layout-toggle", payload);
	},
	onWebcamLayoutHotkey: (callback: () => void) => {
		const listener = () => {
			callback();
		};
		ipcRenderer.on("webcam-layout-hotkey", listener);
		return () => {
			ipcRenderer.removeListener("webcam-layout-hotkey", listener);
		};
	},
	getWebcamLayoutEvents: (videoPath: string) => {
		return ipcRenderer.invoke("get-webcam-layout-events", videoPath) as Promise<{
			success: boolean;
			events: Array<{ timeMs: number; mode: "screen" | "camera-full" }>;
		}>;
	},
```

- [ ] **Step 2: Types** in `electron-env.d.ts`:

```ts
		webcamLayoutToggle: (payload: { timeMs: number; mode: "screen" | "camera-full" }) => void;
		onWebcamLayoutHotkey: (callback: () => void) => () => void;
		getWebcamLayoutEvents: (videoPath: string) => Promise<{
			success: boolean;
			events: Array<{ timeMs: number; mode: "screen" | "camera-full" }>;
		}>;
```

- [ ] **Step 3: Verify** tsc + biome. **Commit** — `git commit -m "Expose webcam layout IPC through preload bridge"`

---

### Task 4: HUD — toggle state, button, hotkey listener

**Files:**
- Modify: `src/hooks/useScreenRecorder.ts` (state near line 333; reset where recording starts; expose in the return at ~2123)
- Modify: `src/components/launch/LaunchWindow.tsx` (props at ~199-211 + hotkey effect)
- Modify: `src/components/launch/RecordingControls.tsx` (props 8-18, button after the mic button at ~61-76)
- Modify: all 10 `src/i18n/locales/*/launch.json` (`recording` section keys)

- [ ] **Step 1: Hook state.** In `useScreenRecorder.ts`:

```ts
	const [cameraFullActive, setCameraFullActive] = useState(false);
	const cameraFullActiveRef = useRef(false);
```

Find where recording actually begins (where `startTime.current` is set / recording state flips true) and reset there:

```ts
	cameraFullActiveRef.current = false;
	setCameraFullActive(false);
```

Add the toggle (near `getRecordingDurationMs`, lines ~456-463; determine the hook's actual recording-active flag name by reading the hook — LaunchWindow consumes `paused`/`elapsed`, so a boolean like `recording`/`isRecording` exists; use it):

```ts
	const toggleCameraLayout = useCallback(() => {
		if (!recordingRefOrState || !webcamEnabled) {
			return;
		}
		const timeMs = Math.round(getRecordingDurationMs(Date.now()));
		const next = !cameraFullActiveRef.current;
		cameraFullActiveRef.current = next;
		setCameraFullActive(next);
		window.electronAPI?.webcamLayoutToggle?.({
			timeMs,
			mode: next ? "camera-full" : "screen",
		});
	}, [getRecordingDurationMs, webcamEnabled /* + the recording flag */]);
```

(`recordingRefOrState` is a placeholder NAME ONLY for the hook's existing recording-active flag — substitute the real one; everything else is literal.) Export `cameraFullActive` and `toggleCameraLayout` from the hook's return object (~line 2123) and its TS interface (~line 148).

- [ ] **Step 2: LaunchWindow.** Destructure `cameraFullActive, toggleCameraLayout` from `useScreenRecorder()` (lines 59-81). Add the hotkey listener effect:

```ts
	useEffect(() => {
		const unsubscribe = window.electronAPI?.onWebcamLayoutHotkey?.(() => {
			toggleCameraLayout();
		});
		return unsubscribe;
	}, [toggleCameraLayout]);
```

Pass to RecordingControls (lines 199-211):

```tsx
		webcamEnabled={webcamEnabled}
		cameraFullActive={cameraFullActive}
		onToggleCameraLayout={toggleCameraLayout}
```

- [ ] **Step 3: RecordingControls button.** Extend the props interface (lines 8-18):

```ts
	webcamEnabled: boolean;
	cameraFullActive: boolean;
	onToggleCameraLayout: () => void;
```

After the microphone button block (~line 76), add (icons: import `MonitorIcon` and `UserSquareIcon` from `@phosphor-icons/react` — verify they exist in `node_modules/@phosphor-icons/react/dist/index.d.ts`; fall back to `MonitorIcon`/`VideoCameraIcon` if `UserSquareIcon` is missing):

```tsx
			{webcamEnabled && (
				<Button
					variant="ghost"
					size="icon"
					className={cameraFullActive ? "text-blue-400" : undefined}
					onClick={onToggleCameraLayout}
					title={
						cameraFullActive
							? t("recording.cameraLayoutToScreen", "Back to screen")
							: t("recording.cameraLayoutToCameraFull", "Camera fullscreen")
					}
					aria-label={
						cameraFullActive
							? t("recording.cameraLayoutToScreen", "Back to screen")
							: t("recording.cameraLayoutToCameraFull", "Camera fullscreen")
					}
				>
					{cameraFullActive ? (
						<MonitorIcon size={16} weight="bold" />
					) : (
						<UserSquareIcon size={16} weight="bold" />
					)}
				</Button>
			)}
```

Match the exact Button size/className conventions used by the neighboring buttons in this file (read them; adjust `size`, icon size, and classes to match).

- [ ] **Step 4: i18n** — add to the `recording` object in all 10 `launch.json` locales:

en: `"cameraLayoutToCameraFull": "Camera fullscreen", "cameraLayoutToScreen": "Back to screen"`
es: `"cameraLayoutToCameraFull": "Cámara a pantalla completa", "cameraLayoutToScreen": "Volver a la pantalla"`
fr: `"cameraLayoutToCameraFull": "Caméra plein écran", "cameraLayoutToScreen": "Retour à l'écran"`
it: `"cameraLayoutToCameraFull": "Fotocamera a schermo intero", "cameraLayoutToScreen": "Torna allo schermo"`
ko: `"cameraLayoutToCameraFull": "카메라 전체 화면", "cameraLayoutToScreen": "화면으로 돌아가기"`
nl: `"cameraLayoutToCameraFull": "Camera volledig scherm", "cameraLayoutToScreen": "Terug naar scherm"`
pt-BR: `"cameraLayoutToCameraFull": "Câmera em tela cheia", "cameraLayoutToScreen": "Voltar para a tela"`
ru: `"cameraLayoutToCameraFull": "Камера на весь экран", "cameraLayoutToScreen": "Вернуться к экрану"`
zh-CN: `"cameraLayoutToCameraFull": "摄像头全屏", "cameraLayoutToScreen": "返回屏幕"`
zh-TW: `"cameraLayoutToCameraFull": "攝影機全螢幕", "cameraLayoutToScreen": "返回螢幕"`

- [ ] **Step 5: Verify** — tsc, biome, `npm run i18n:check` (no NEW failures), full `npx vitest --run src/` quick pass.
- [ ] **Step 6: Commit** — `git commit -m "Add camera layout toggle to recording HUD with Alt+F10 relay"`

---

### Task 5: Editor — types, sidecar load, persistence, checkbox

**Files:**
- Modify: `src/components/video-editor/types.ts` (re-export `WebcamLayoutRegion` from `./webcamLayoutRegions` or import where needed)
- Modify: `src/components/video-editor/projectPersistence.ts` (add `webcamLayoutRegions` + `webcamLayoutRegionsEnabled` to `ProjectEditorState` + `normalizeProjectEditor` with defaults `[]` / `true`; follow exactly how `zoomRegions` or `annotationRegions` are normalized/persisted there)
- Modify: `src/components/video-editor/VideoEditor.tsx` (state; sidecar load near the cursor-telemetry load at ~3060-3127; project open at ~1988; include in project save; pass into export config and VideoPlayback)
- Modify: `src/components/video-editor/SettingsPanel.tsx` (checkbox in the webcam section)
- Modify: all 10 `src/i18n/locales/*/settings.json` (`effects` section key)
- Test: extend `src/components/video-editor/projectPersistence` tests if a test file exists for `normalizeProjectEditor` (check `projectPersistence` imports in existing `*.test.ts` — `editorPreferences.test.ts` exercises `normalizeProjectEditor` indirectly); at minimum add a round-trip normalization test.

- [ ] **Step 1: State + persistence.** Add to `ProjectEditorState` (in `projectPersistence.ts` or `types.ts` — wherever the interface lives; grep `interface ProjectEditorState`):

```ts
	webcamLayoutRegions: WebcamLayoutRegion[];
	webcamLayoutRegionsEnabled: boolean;
```

In `normalizeProjectEditor`, normalize: array items require finite `startMs < endMs` and a string `id` (coerce/regenerate ids if missing); default `[]`; `webcamLayoutRegionsEnabled` boolean default `true`. Write a normalization test:

```ts
	it("normalizes webcam layout regions with defaults", () => {
		const normalized = normalizeProjectEditor({});
		expect(normalized.webcamLayoutRegions).toEqual([]);
		expect(normalized.webcamLayoutRegionsEnabled).toBe(true);

		const withRegions = normalizeProjectEditor({
			webcamLayoutRegions: [
				{ id: "a", startMs: 1000, endMs: 2000 },
				{ id: "bad", startMs: 5, endMs: 5 },
			],
			webcamLayoutRegionsEnabled: false,
		});
		expect(withRegions.webcamLayoutRegions).toEqual([{ id: "a", startMs: 1000, endMs: 2000 }]);
		expect(withRegions.webcamLayoutRegionsEnabled).toBe(false);
	});
```

(place it in the existing test file that covers `normalizeProjectEditor`; if none covers it directly, create `src/components/video-editor/projectPersistence.webcamLayout.test.ts` with the imports it needs.)

- [ ] **Step 2: VideoEditor state + load.** Add state:

```ts
	const [webcamLayoutRegions, setWebcamLayoutRegions] = useState<WebcamLayoutRegion[]>([]);
	const [webcamLayoutRegionsEnabled, setWebcamLayoutRegionsEnabled] = useState(true);
```

Project open (~line 1988 where `setWebcam(normalizedEditor.webcam)` runs): also `setWebcamLayoutRegions(normalizedEditor.webcamLayoutRegions)` and `setWebcamLayoutRegionsEnabled(normalizedEditor.webcamLayoutRegionsEnabled)`. Project save: include both fields wherever the editor state object is assembled for persistence (grep the save payload that includes `zoomRegions`).

Sidecar load for fresh recordings — next to the cursor telemetry loader (~3060-3127), same guard style:

```ts
	useEffect(() => {
		let cancelled = false;
		if (!videoSourcePath) {
			return;
		}
		void (async () => {
			try {
				const result = await window.electronAPI.getWebcamLayoutEvents?.(videoSourcePath);
				if (cancelled || !result?.success || result.events.length === 0) {
					return;
				}
				setWebcamLayoutRegions((current) =>
					current.length > 0 ? current : eventsToWebcamLayoutRegions(result.events),
				);
			} catch (error) {
				console.warn("Failed to load webcam layout events:", error);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [videoSourcePath]);
```

(The `current.length > 0 ? current : ...` guard prevents clobbering regions already loaded from a saved project.)

- [ ] **Step 3: Checkbox.** In `SettingsPanel.tsx`'s webcam section (near the custom-position toggle — grep `Custom position` / `customPosition` for the exact toggle-row pattern used there), add an identical toggle row, shown only when `webcamLayoutRegions.length > 0` (pass the count or a boolean prop down from VideoEditor along with value+setter):

label: `tSettings("effects.webcamUseRecordedSwitches", "Use recorded camera switches")`

Wire `webcamLayoutRegionsEnabled` + `setWebcamLayoutRegionsEnabled` through SettingsPanel props following how other webcam toggles flow (read the component's props interface and VideoEditor call site; add three props: `webcamLayoutRegionsAvailable: boolean`, `webcamLayoutRegionsEnabled: boolean`, `onWebcamLayoutRegionsEnabledChange: (enabled: boolean) => void`).

i18n `settings.json` all 10 locales, inside the `effects` object:
en: `"webcamUseRecordedSwitches": "Use recorded camera switches"`
es: `"webcamUseRecordedSwitches": "Usar cambios de cámara grabados"`
fr: `"webcamUseRecordedSwitches": "Utiliser les changements de caméra enregistrés"`
it: `"webcamUseRecordedSwitches": "Usa i cambi di fotocamera registrati"`
ko: `"webcamUseRecordedSwitches": "녹화된 카메라 전환 사용"`
nl: `"webcamUseRecordedSwitches": "Opgenomen camerawissels gebruiken"`
pt-BR: `"webcamUseRecordedSwitches": "Usar trocas de câmera gravadas"`
ru: `"webcamUseRecordedSwitches": "Использовать записанные переключения камеры"`
zh-CN: `"webcamUseRecordedSwitches": "使用录制的摄像头切换"`
zh-TW: `"webcamUseRecordedSwitches": "使用錄製的攝影機切換"`

- [ ] **Step 4: Effective regions plumbed onward.** In VideoEditor:

```ts
	const effectiveWebcamLayoutRegions = useMemo(
		() => (webcamLayoutRegionsEnabled ? webcamLayoutRegions : []),
		[webcamLayoutRegions, webcamLayoutRegionsEnabled],
	);
```

Pass `webcamLayoutRegions={effectiveWebcamLayoutRegions}` to `<VideoPlayback ...>` (call site ~line 5100-5157) and add `webcamLayoutRegions: effectiveWebcamLayoutRegions` to the export config object (grep where `zoomRegions` enters the exporter config). VideoPlayback prop typing comes in Task 6 — to keep this task compiling, do Task 6's prop addition signature first if needed, or land Tasks 5+6 in one commit; prefer adding the prop as part of this task with a no-op default `[]` in VideoPlayback and the rendering logic in Task 6.

- [ ] **Step 5: Verify** — tsc, biome, vitest video-editor suite, i18n:check (no NEW failures).
- [ ] **Step 6: Commit** — `git commit -m "Load, persist, and gate webcam layout regions in the editor"`

---

### Task 6: Preview rendering (camera-full in VideoPlayback)

**Files:**
- Modify: `src/components/video-editor/VideoPlayback.tsx`

Builds on the presets+flicker plan's ref-based `applyWebcamBubbleLayout`.

- [ ] **Step 1: Investigate before coding.** Confirm in code: `cameraContainerRef` (line ~490, created ~1950) holds ONLY the screen video content (not the wallpaper background); toggling `cameraContainerRef.current.visible = false` leaves the background visible. Identify where `currentTime` updates reach the component (`currentTimeRef` effect ~1659-1667). If background lives inside the same container, find the screen-content child (sprite/mask) to hide instead, and report the deviation in the commit message.

- [ ] **Step 2: Implement.**

(a) Add prop `webcamLayoutRegions?: WebcamLayoutRegion[]` (default `[]`) to the component's props (interface near line 331's `currentTime`).

(b) Mirror into a ref (alongside the existing webcam input refs from the flicker fix):

```ts
		const webcamLayoutRegionsRef = useRef<WebcamLayoutRegion[]>([]);
		webcamLayoutRegionsRef.current = webcamLayoutRegions ?? [];
		const cameraFullActiveRef = useRef(false);
```

(c) Add an updater that recomputes the active mode and applies visibility + bubble layout; call it whenever currentTime changes (in the existing `currentTimeRef` update effect ~1659) and whenever the regions prop changes (small effect):

```ts
		const updateWebcamLayoutMode = useCallback(() => {
			const active = isCameraFullAtMs(webcamLayoutRegionsRef.current, currentTimeRef.current);
			if (cameraFullActiveRef.current === active) {
				return;
			}
			cameraFullActiveRef.current = active;
			const cameraContainer = cameraContainerRef.current;
			if (cameraContainer) {
				cameraContainer.visible = !active;
			}
			applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);
		}, [applyWebcamBubbleLayout]);
```

(d) In `applyWebcamBubbleLayout`, branch on `cameraFullActiveRef.current`: when active, instead of `getWebcamOverlaySizePx`/`getWebcamOverlayPosition`, compute the letterbox rect from the CROPPED webcam aspect and the overlay size:

```ts
			if (cameraFullActiveRef.current) {
				const crop = normalizeWebcamCropRegion(webcamCropRegion); // or however crop is accessed; the cropped aspect is (crop.width * videoW) / (crop.height * videoH)
				const videoDims = webcamVideoDimensionsRef.current; // mirror webcamVideoDimensions into a ref like the other inputs
				const contentAspectWidth = videoDims ? crop.width * videoDims.width : 16;
				const contentAspectHeight = videoDims ? crop.height * videoDims.height : 9;
				const rect = getLetterboxRect(
					{ width: contentAspectWidth, height: contentAspectHeight },
					{ width: overlay.clientWidth, height: overlay.clientHeight },
					Math.min(overlay.clientWidth, overlay.clientHeight) * 0.04,
				);
				bubble.style.display = "block";
				bubble.style.left = `${rect.x}px`;
				bubble.style.top = `${rect.y}px`;
				bubble.style.width = `${rect.width}px`;
				bubble.style.height = `${rect.height}px`;
				bubble.style.aspectRatio = "auto";
				// keep the existing squircle/shadow styling, recomputed for rect dims
				...
				return;
			}
```

The existing inner crop "cover" math fills the bubble with the cropped region; with the bubble at exactly the cropped aspect, cover === fit, so the whole (cropped) camera frame is visible. Keep the squircle clip + drop-shadow code paths but compute `getSquircleSvgPath` with `width: rect.width, height: rect.height` and a radius matching the screen frame's `borderRadius` value if accessible via ref, else reuse `webcamCornerRadius`.

(e) The bubble is square only in bubble mode — make sure the non-camera-full branch restores `aspectRatio: "1 / 1"` (it already sets it each call).

- [ ] **Step 3: Manual verification.** `npm run dev`, record a short clip with webcam + a couple of toggles (HUD button + Alt+F10), open in editor: scrubbing/playback shows hard cuts — camera letterboxed over background, screen hidden — exactly at press points; checkbox off restores normal layout everywhere; zoom regions still behave during screen segments.
- [ ] **Step 4: tsc/biome/vitest** (no new failures). **Commit** — `git commit -m "Render camera-full layout segments in editor preview"`

---

### Task 7: Export rendering + native skip reason

**Files:**
- Modify: `src/lib/exporter/modernFrameRenderer.ts` (config interface ~98-162; webcam compositing ~2420-2523; screen/zoom draw ~2102-2130)
- Modify: `src/lib/exporter/modernVideoExporter.ts` (config pass-through ~590-612; `getNativeStaticLayoutSkipReasons` ~1498-1582)
- Test: extend the existing exporter test that covers skip reasons (grep `unsupported-annotation-overlay` in `src/lib/exporter/*.test.ts` to find it)

- [ ] **Step 1: Config plumbing.** Add `webcamLayoutRegions?: WebcamLayoutRegion[]` to `FrameRenderConfig` (modernFrameRenderer.ts) and the exporter config (modernVideoExporter.ts), passing it through where `zoomRegions`/`webcam` flow (~590-612). Import the type + `isCameraFullAtMs` + `getLetterboxRect` from `@/components/video-editor/webcamLayoutRegions`.

- [ ] **Step 2: Skip reason (TDD).** Find the existing test exercising `getNativeStaticLayoutSkipReasons` outputs (grep in `src/lib/exporter/*.test.ts` for `unsupported-annotation-overlay` or `nativeStaticLayoutSkipReasons`); add a case asserting that a config with one webcam layout region yields `"unsupported-webcam-layout-regions"`. Then implement in `getNativeStaticLayoutSkipReasons` (next to the annotation check at ~1553):

```ts
		if ((this.config.webcamLayoutRegions ?? []).length > 0) {
			reasons.push("unsupported-webcam-layout-regions");
		}
```

If no directly-callable test exists for skip reasons (the method is private), verify via the existing test pattern for that file — read how `modernVideoExporter.nativeStaticLayout.test.ts` exercises decisions and extend it; if it's genuinely untestable without large scaffolding, document that in the commit and rely on the route-decision log check in Step 4.

- [ ] **Step 3: Per-frame camera-full rendering.** Investigate the per-frame render path in modernFrameRenderer.ts (the method that applies zoom transforms ~2102-2130 and positions the webcam container/sprite). Implement: for each frame at `frameTimeMs`, if `isCameraFullAtMs(this.config.webcamLayoutRegions ?? [], frameTimeMs)`:
  - hide the screen content container for that frame (set `.visible = false` on the container that holds the screen video — identify the exact member: the renderer mirrors VideoPlayback's structure; grep `cameraContainer` / the container that gets the zoom transform);
  - position the webcam container/sprite to the letterbox rect: content aspect = cropped webcam aspect (the crop source rect is computed in `refreshWebcamFrameCache`/`getWebcamCropSourceRect` ~2491-2523), frame = output `this.config.width/height`, padding = `Math.min(width, height) * 0.04` (same constant as preview — extract it as `CAMERA_FULL_PADDING_FRACTION = 0.04` exported from `webcamLayoutRegions.ts` and use it in BOTH preview and export);
  - keep the webcam's corner-radius mask + shadow consistent with bubble mode (reuse the existing mask graphics with the new rect).
  Else restore visibility + normal webcam placement. Make the visibility/placement assignment unconditional per frame (no stateful flicker between segments).

- [ ] **Step 4: Verification.**
  - `npx vitest --run src/lib/exporter` — no new failures, new skip-reason test passes.
  - Manual: export the Task 6 test project to MP4 (default settings, macOS → confirm in the export logs/route decisions that the native static layout was rejected with `unsupported-webcam-layout-regions` and the WebCodecs/breeze path ran); play the MP4 — cuts match the preview, camera letterboxed over background, no screen content during camera-full segments, audio continuous.
  - Export the same project with the checkbox OFF — normal layout throughout, and native static layout is eligible again (no skip reason).
- [ ] **Step 5: Commit** — `git commit -m "Composite camera-full layout segments in export with native-path skip reason"`

---

### Task 8: Final verification

- [ ] **Step 1:** `npm test` (only the 1 pre-existing failure), `npx tsc --noEmit` clean, `npm run i18n:check` (no NEW failures), biome on all touched files.
- [ ] **Step 2:** End-to-end manual: record with webcam, press the HUD button twice and Alt+F10 once (three toggles), pause/resume between toggles, stop → editor opens → segments land at press points (pause-adjusted); export → MP4 matches; checkbox off → disabled everywhere; project save/reopen → regions persist.
- [ ] **Step 3:** Commit any verification fixes.
