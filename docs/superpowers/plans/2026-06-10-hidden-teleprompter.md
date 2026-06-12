# Hidden Teleprompter + Preview Echo Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy the Recordly screen recorder into `Mini Tools/RECORDLY`, add a capture-hidden teleprompter window with auto-scroll and global hotkeys, and fix the double-echo voice bug in the editor preview.

**Architecture:** Recordly is an Electron + React/Vite/TS app. Each window is created by a `createXWindow()` function in `electron/windows.ts` and the renderer routes on a `?windowType=...` query param in `src/App.tsx`. The teleprompter is one more window type, hidden from capture via `BrowserWindow.setContentProtection(true)` (already used for the HUD overlay). Global hotkeys use Electron's `globalShortcut` (first use in this repo). The echo bug is a one-line logic fix in the preview audio routing engine plus a regression test.

**Tech Stack:** Electron, React 18, TypeScript, Vite, Tailwind, Biome (tabs, lint), vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-hidden-teleprompter-design.md`

**Conventions to follow:**
- Indent with TABS (Biome-enforced). Run `npx biome check --write <files>` on every file you touch.
- All commits go to the `Mini Tools` git repo (repo root is `/Users/justmaiko/PROJECTS/Mini Tools`, the project lives in the `RECORDLY/` subdirectory).
- All `npm` commands run from `/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY`.

---

### Task 1: Copy the repo and establish a baseline

**Files:**
- Create: entire `RECORDLY/` tree (copied from the existing local clone)

- [ ] **Step 1: Copy the existing clone (without git history)**

The user already has a clone of `https://github.com/webadderallorg/Recordly` at `_external/Recordly`. Copy it without `.git` (note: trailing slashes matter; `docs/superpowers/` already exists in the destination and must be preserved — rsync without `--delete` merges, which is what we want):

```bash
rsync -a --exclude=".git" --exclude=".DS_Store" \
  "/Users/justmaiko/PROJECTS/_external/Recordly/" \
  "/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY/"
```

- [ ] **Step 2: Install dependencies**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY" && npm install
```

Expected: completes successfully. The `postinstall` script rebuilds `uiohook-napi` and may build native helpers — this can take a few minutes. If a native helper build fails (e.g. missing Xcode component), note the error and continue: dev mode and tests do not require all packaged helpers.

- [ ] **Step 3: Run the test suite to establish a baseline**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY" && npm test
```

Expected: PASS. If any tests fail, record exactly which ones — they are pre-existing failures on this machine and must still fail/pass identically after our changes (no new failures).

- [ ] **Step 4: Commit**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools" && git add RECORDLY && git commit -m "Vendor Recordly v1.3.3 from webadderallorg/Recordly (no upstream history)"
```

---

### Task 2: Fix the editor preview double-echo (mic played twice)

**Root cause (verified):** On macOS, when recording with microphone but **no system audio**, the native helper (`electron/native/ScreenCaptureKitRecorder.swift:344`) writes mic audio **both** into the video's inline audio track and into a `.mic.m4a` sidecar. For that recording shape, `getCompanionAudioFallbackInfo` (`electron/ipc/recording/diagnostics.ts:528`) returns `paths = [micPath]` (video path NOT included). The routing engine (`src/lib/exporter/audioRoutingEngine.ts:124`) then computes `muteEmbeddedPreview: false`, so during preview the `<video>` element plays the inline mic AND a separate `Audio` element plays the mic sidecar → offset double voice (echo). Export is unaffected because `audioEncoder.ts` special-cases this shape (`requiresLegacyMacMicSidecarMix`).

**Fix:** mute the embedded preview whenever dedicated sidecar tracks exist but the video path itself was not listed as a distinct audio source (`hasEmbeddedSourceAudio === false`). Export behavior (`includeEmbeddedInExport`) is intentionally left unchanged.

**Files:**
- Modify: `src/lib/exporter/audioRoutingEngine.ts:124`
- Test: `src/lib/exporter/sourceTrackRoutingPolicy.test.ts`

- [ ] **Step 1: Write the failing regression test**

Append to the `describe` block in `src/lib/exporter/sourceTrackRoutingPolicy.test.ts`:

```ts
	it("mutes embedded preview when only a mic sidecar exists without an embedded source entry", () => {
		// macOS mic-only recordings duplicate the mic into the video's inline track
		// and into the .mic sidecar; playing both echoes the voice in preview.
		const policy = resolveSourceTrackRoutingPolicy("/tmp/recording.mp4", [
			"/tmp/recording.mic.m4a",
		]);

		expect(policy.playbackPaths).toEqual(["/tmp/recording.mic.m4a"]);
		expect(policy.muteEmbeddedPreview).toBe(true);
		expect(policy.includeEmbeddedInExport).toBe(true);
	});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest --run src/lib/exporter/sourceTrackRoutingPolicy.test.ts
```

Expected: FAIL — `muteEmbeddedPreview` expected `true`, received `false`.

- [ ] **Step 3: Implement the fix**

In `src/lib/exporter/audioRoutingEngine.ts`, change line 124 from:

```ts
		muteEmbeddedPreview: hasDedicatedTracks && !includeEmbeddedInExport,
```

to:

```ts
		// Mute embedded preview when sidecars exist but the video itself was not
		// listed as a distinct audio source: on macOS mic-only recordings the
		// inline track duplicates the .mic sidecar, and playing both echoes.
		muteEmbeddedPreview:
			hasDedicatedTracks && (!includeEmbeddedInExport || !hasEmbeddedSourceAudio),
```

- [ ] **Step 4: Run the full routing/audio tests**

```bash
npx vitest --run src/lib/exporter/sourceTrackRoutingPolicy.test.ts src/lib/exporter/audioEncoder.test.ts src/components/video-editor/audio.test.ts
```

Expected: PASS (all existing cases unchanged — the existing test "keeps embedded audio when only mic sidecar is present" covers the `[videoPath, micPath]` shape where `hasEmbeddedSourceAudio` is `true`, and still expects `muteEmbeddedPreview: false`).

- [ ] **Step 5: Commit**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools" && git add RECORDLY/src/lib/exporter && git commit -m "Fix double-echo voice in editor preview for mac mic-only recordings"
```

---

### Task 3: Teleprompter default bounds (main process, TDD)

**Files:**
- Create: `electron/teleprompterBounds.ts`
- Test: `electron/teleprompterBounds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `electron/teleprompterBounds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	getTeleprompterDefaultBounds,
	TELEPROMPTER_DEFAULT_HEIGHT,
	TELEPROMPTER_DEFAULT_WIDTH,
	TELEPROMPTER_TOP_MARGIN,
} from "./teleprompterBounds";

describe("getTeleprompterDefaultBounds", () => {
	it("centers horizontally at the top of the work area", () => {
		const bounds = getTeleprompterDefaultBounds({ x: 0, y: 25, width: 1440, height: 875 });

		expect(bounds.width).toBe(TELEPROMPTER_DEFAULT_WIDTH);
		expect(bounds.height).toBe(TELEPROMPTER_DEFAULT_HEIGHT);
		expect(bounds.x).toBe(Math.round((1440 - TELEPROMPTER_DEFAULT_WIDTH) / 2));
		expect(bounds.y).toBe(25 + TELEPROMPTER_TOP_MARGIN);
	});

	it("respects work area offsets on secondary displays", () => {
		const bounds = getTeleprompterDefaultBounds({ x: 1440, y: 100, width: 1920, height: 1080 });

		expect(bounds.x).toBe(1440 + Math.round((1920 - TELEPROMPTER_DEFAULT_WIDTH) / 2));
		expect(bounds.y).toBe(100 + TELEPROMPTER_TOP_MARGIN);
	});

	it("clamps to small work areas", () => {
		const bounds = getTeleprompterDefaultBounds({ x: 0, y: 0, width: 400, height: 300 });

		expect(bounds.width).toBe(400);
		expect(bounds.height).toBe(300);
		expect(bounds.x).toBe(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest --run electron/teleprompterBounds.test.ts
```

Expected: FAIL — module `./teleprompterBounds` not found.

- [ ] **Step 3: Implement**

Create `electron/teleprompterBounds.ts`:

```ts
export interface TeleprompterBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const TELEPROMPTER_DEFAULT_WIDTH = 520;
export const TELEPROMPTER_DEFAULT_HEIGHT = 360;
export const TELEPROMPTER_TOP_MARGIN = 12;

interface WorkArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Default placement: horizontally centered at the very top of the primary
 * display, so the window sits as close to the camera as possible.
 */
export function getTeleprompterDefaultBounds(workArea: WorkArea): TeleprompterBounds {
	const width = Math.min(TELEPROMPTER_DEFAULT_WIDTH, workArea.width);
	const height = Math.min(TELEPROMPTER_DEFAULT_HEIGHT, workArea.height);

	return {
		x: workArea.x + Math.round((workArea.width - width) / 2),
		y: workArea.y + Math.min(TELEPROMPTER_TOP_MARGIN, Math.max(0, workArea.height - height)),
		width,
		height,
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest --run electron/teleprompterBounds.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools" && git add RECORDLY/electron/teleprompterBounds.ts RECORDLY/electron/teleprompterBounds.test.ts && git commit -m "Add teleprompter default bounds calculation"
```

---

### Task 4: Teleprompter window, global shortcuts, and IPC (main process)

**Files:**
- Create: `electron/teleprompterShortcuts.ts`
- Modify: `electron/windows.ts` (imports near line 8; window state near line 33; new functions + IPC after `createCountdownWindow`, around line 1016)
- Modify: `electron/main.ts` (register the Alt+T toggle in the `app.whenReady()` block at line 877; unregister on quit)

- [ ] **Step 1: Create the global shortcut module**

Create `electron/teleprompterShortcuts.ts`:

```ts
import { globalShortcut } from "electron";

export type TeleprompterCommand = "toggle-play" | "speed-down" | "speed-up";

const SCROLL_SHORTCUTS: Array<[string, TeleprompterCommand]> = [
	["Alt+F8", "toggle-play"],
	["Alt+F7", "speed-down"],
	["Alt+F9", "speed-up"],
];

const TOGGLE_SHORTCUT = "Alt+T";

/** Registered only while the teleprompter window exists. */
export function registerTeleprompterScrollShortcuts(
	send: (command: TeleprompterCommand) => void,
): void {
	for (const [accelerator, command] of SCROLL_SHORTCUTS) {
		try {
			const registered = globalShortcut.register(accelerator, () => send(command));
			if (!registered) {
				console.warn(`[teleprompter] Could not register global shortcut ${accelerator}`);
			}
		} catch (error) {
			console.warn(`[teleprompter] Could not register global shortcut ${accelerator}:`, error);
		}
	}
}

export function unregisterTeleprompterScrollShortcuts(): void {
	for (const [accelerator] of SCROLL_SHORTCUTS) {
		try {
			globalShortcut.unregister(accelerator);
		} catch {
			// Best effort - shortcut may not have been registered.
		}
	}
}

/** Registered for the app lifetime so Alt+T can summon the window. */
export function registerTeleprompterToggleShortcut(toggle: () => void): void {
	try {
		const registered = globalShortcut.register(TOGGLE_SHORTCUT, toggle);
		if (!registered) {
			console.warn(`[teleprompter] Could not register global shortcut ${TOGGLE_SHORTCUT}`);
		}
	} catch (error) {
		console.warn(`[teleprompter] Could not register global shortcut ${TOGGLE_SHORTCUT}:`, error);
	}
}
```

- [ ] **Step 2: Add the window to `electron/windows.ts`**

Add imports (after the `import { getHudOverlayWindowBounds, ... }` line at the top):

```ts
import { getTeleprompterDefaultBounds } from "./teleprompterBounds";
import {
	registerTeleprompterScrollShortcuts,
	unregisterTeleprompterScrollShortcuts,
} from "./teleprompterShortcuts";
```

Add window state (next to `let countdownWindow: BrowserWindow | null = null;` near line 33):

```ts
let teleprompterWindow: BrowserWindow | null = null;
```

Add the following after `createCountdownWindow` and its helpers (after line ~1026, end of file is fine). Note: `getScreen()` is an existing local helper in this file (line 174), and `isHudOverlayCaptureProtectionSupported()` is the existing local helper at line 112 — reuse both:

```ts
export function createTeleprompterWindow(): BrowserWindow {
	if (teleprompterWindow && !teleprompterWindow.isDestroyed()) {
		teleprompterWindow.show();
		teleprompterWindow.moveTop();
		return teleprompterWindow;
	}

	const bounds = getTeleprompterDefaultBounds(getScreen().getPrimaryDisplay().workArea);

	const win = new BrowserWindow({
		...bounds,
		minWidth: 280,
		minHeight: 180,
		frame: false,
		backgroundColor: "#161616",
		resizable: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		show: false,
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	// Hide from screen capture so recordings never show the script.
	if (isHudOverlayCaptureProtectionSupported()) {
		win.setContentProtection(true);
	}

	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

	win.once("ready-to-show", () => {
		if (!win.isDestroyed()) {
			win.show();
		}
	});

	registerTeleprompterScrollShortcuts((command) => {
		if (!win.isDestroyed()) {
			win.webContents.send("teleprompter-command", command);
		}
	});

	win.on("closed", () => {
		unregisterTeleprompterScrollShortcuts();
		if (teleprompterWindow === win) {
			teleprompterWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=teleprompter");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "teleprompter" },
		});
	}

	teleprompterWindow = win;
	return win;
}

export function getTeleprompterWindow(): BrowserWindow | null {
	return teleprompterWindow && !teleprompterWindow.isDestroyed() ? teleprompterWindow : null;
}

export function toggleTeleprompterWindow(): void {
	const existing = getTeleprompterWindow();
	if (existing) {
		existing.close();
	} else {
		createTeleprompterWindow();
	}
}

ipcMain.on("teleprompter-toggle", () => {
	toggleTeleprompterWindow();
});

ipcMain.on("teleprompter-close", () => {
	getTeleprompterWindow()?.close();
});
```

- [ ] **Step 3: Wire the app-lifetime Alt+T shortcut in `electron/main.ts`**

Add to the imports from `"./windows"` (the import block that includes `createHudOverlayWindow` at line 46):

```ts
	toggleTeleprompterWindow,
```

Add a new import:

```ts
import { registerTeleprompterToggleShortcut } from "./teleprompterShortcuts";
```

Inside the `app.whenReady().then(async () => {` block (line 877), after the permission handlers are set up (e.g. right after the `setDevicePermissionHandler` line):

```ts
	registerTeleprompterToggleShortcut(toggleTeleprompterWindow);
```

Add a new `app.on("will-quit", ...)` handler next to the existing `app.on("before-quit", ...)` handler (line 853), and import `globalShortcut` from `"electron"` in the existing electron import at the top of main.ts. (Correction during review: `will-quit`, NOT `before-quit` — a quit can be canceled by the editor's unsaved-changes dialog, and shortcuts unregistered in `before-quit` would stay dead for the rest of the session.)

```ts
app.on("will-quit", () => {
	globalShortcut.unregisterAll();
});
```

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit && npx biome check electron/teleprompterShortcuts.ts electron/windows.ts electron/main.ts
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools" && git add RECORDLY/electron && git commit -m "Add teleprompter window with capture protection, IPC, and global hotkeys"
```

---

### Task 5: Preload bridge and renderer types

**Files:**
- Modify: `electron/preload.ts` (inside the `contextBridge.exposeInMainWorld("electronAPI", {` object, line 166 — add next to the `hudOverlay*` methods)
- Modify: `electron/electron-env.d.ts` (the `electronAPI` interface, next to the `hudOverlay*` declarations at line 206)

- [ ] **Step 1: Add preload methods**

In `electron/preload.ts`, inside the `electronAPI` object (after `hudOverlayRendererReady`, around line 184):

```ts
	teleprompterToggle: () => {
		ipcRenderer.send("teleprompter-toggle");
	},
	teleprompterClose: () => {
		ipcRenderer.send("teleprompter-close");
	},
	onTeleprompterCommand: (callback: (command: string) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, command: string) => {
			callback(command);
		};
		ipcRenderer.on("teleprompter-command", listener);
		return () => {
			ipcRenderer.removeListener("teleprompter-command", listener);
		};
	},
```

- [ ] **Step 2: Add type declarations**

In `electron/electron-env.d.ts`, after `hudOverlayRendererReady: () => void;` (line ~211):

```ts
		teleprompterToggle: () => void;
		teleprompterClose: () => void;
		onTeleprompterCommand: (callback: (command: string) => void) => () => void;
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit && npx biome check electron/preload.ts electron/electron-env.d.ts
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools" && git add RECORDLY/electron/preload.ts RECORDLY/electron/electron-env.d.ts && git commit -m "Expose teleprompter IPC through preload bridge"
```

---

### Task 6: Scroll engine pure functions (renderer, TDD)

**Files:**
- Create: `src/components/teleprompter/teleprompterScroll.ts`
- Test: `src/components/teleprompter/teleprompterScroll.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/teleprompter/teleprompterScroll.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	advanceScrollTop,
	DEFAULT_FONT_SIZE_INDEX,
	DEFAULT_SPEED_INDEX,
	FONT_SIZES,
	SPEED_LEVELS,
	stepIndex,
} from "./teleprompterScroll";

describe("advanceScrollTop", () => {
	it("advances proportionally to elapsed time and speed", () => {
		expect(advanceScrollTop(100, 60, 1000)).toBeCloseTo(160);
		expect(advanceScrollTop(100, 60, 500)).toBeCloseTo(130);
		expect(advanceScrollTop(0, 30, 16.7)).toBeCloseTo(0.501, 3);
	});

	it("ignores invalid elapsed time", () => {
		expect(advanceScrollTop(100, 60, 0)).toBe(100);
		expect(advanceScrollTop(100, 60, -5)).toBe(100);
		expect(advanceScrollTop(100, 60, Number.NaN)).toBe(100);
	});
});

describe("stepIndex", () => {
	it("steps within bounds", () => {
		expect(stepIndex(3, 1, SPEED_LEVELS.length)).toBe(4);
		expect(stepIndex(3, -1, SPEED_LEVELS.length)).toBe(2);
	});

	it("clamps at the ends", () => {
		expect(stepIndex(0, -1, SPEED_LEVELS.length)).toBe(0);
		expect(stepIndex(SPEED_LEVELS.length - 1, 1, SPEED_LEVELS.length)).toBe(
			SPEED_LEVELS.length - 1,
		);
	});
});

describe("level tables", () => {
	it("has strictly increasing speeds and sane defaults", () => {
		for (let i = 1; i < SPEED_LEVELS.length; i++) {
			expect(SPEED_LEVELS[i]).toBeGreaterThan(SPEED_LEVELS[i - 1]);
		}
		expect(DEFAULT_SPEED_INDEX).toBeGreaterThanOrEqual(0);
		expect(DEFAULT_SPEED_INDEX).toBeLessThan(SPEED_LEVELS.length);
		expect(DEFAULT_FONT_SIZE_INDEX).toBeGreaterThanOrEqual(0);
		expect(DEFAULT_FONT_SIZE_INDEX).toBeLessThan(FONT_SIZES.length);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest --run src/components/teleprompter/teleprompterScroll.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/teleprompter/teleprompterScroll.ts`:

```ts
/** Auto-scroll speeds in CSS pixels per second. */
export const SPEED_LEVELS = [10, 20, 30, 45, 60, 80, 105, 135, 170, 210] as const;
export const DEFAULT_SPEED_INDEX = 3;

/** Reading font sizes in CSS pixels. */
export const FONT_SIZES = [20, 24, 28, 32, 40, 48, 56, 64] as const;
export const DEFAULT_FONT_SIZE_INDEX = 3;

/** Clamp-stepped index into a level table. */
export function stepIndex(current: number, delta: number, length: number): number {
	return Math.max(0, Math.min(length - 1, current + delta));
}

/**
 * Advance a fractional scroll position. Kept as a float by the caller so slow
 * speeds (< 1px/frame) still accumulate instead of stalling on integer rounding.
 */
export function advanceScrollTop(
	scrollTop: number,
	speedPxPerSecond: number,
	elapsedMs: number,
): number {
	if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
		return scrollTop;
	}
	return scrollTop + (speedPxPerSecond * elapsedMs) / 1000;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest --run src/components/teleprompter/teleprompterScroll.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools" && git add RECORDLY/src/components/teleprompter && git commit -m "Add teleprompter scroll engine primitives"
```

---

### Task 7: Teleprompter component, App routing, and i18n strings

**Files:**
- Create: `src/components/teleprompter/Teleprompter.tsx`
- Modify: `src/App.tsx` (add `case "teleprompter"` to the switch at line 59)
- Modify: `src/i18n/locales/{en,es,fr,it,ko,nl,pt-BR,ru,zh-CN,zh-TW}/launch.json` (add a top-level `"teleprompter"` section to each)

- [ ] **Step 1: Create the component**

Create `src/components/teleprompter/Teleprompter.tsx`:

```tsx
import {
	CaretDownIcon,
	CaretUpIcon,
	MinusIcon,
	PauseIcon,
	PencilSimpleIcon,
	PlayIcon,
	PlusIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import {
	advanceScrollTop,
	DEFAULT_FONT_SIZE_INDEX,
	DEFAULT_SPEED_INDEX,
	FONT_SIZES,
	SPEED_LEVELS,
	stepIndex,
} from "./teleprompterScroll";

const SCRIPT_STORAGE_KEY = "recordly-teleprompter-script";
const SPEED_STORAGE_KEY = "recordly-teleprompter-speed-index";
const FONT_STORAGE_KEY = "recordly-teleprompter-font-index";

const dragRegion = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDragRegion = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

function loadStoredIndex(key: string, fallback: number, length: number): number {
	const raw = Number.parseInt(window.localStorage.getItem(key) ?? "", 10);
	if (!Number.isFinite(raw) || raw < 0 || raw >= length) {
		return fallback;
	}
	return raw;
}

export function Teleprompter() {
	const t = useScopedT("launch");
	const [script, setScript] = useState(
		() => window.localStorage.getItem(SCRIPT_STORAGE_KEY) ?? "",
	);
	const [editing, setEditing] = useState(
		() => (window.localStorage.getItem(SCRIPT_STORAGE_KEY) ?? "").trim().length === 0,
	);
	const [playing, setPlaying] = useState(false);
	const [speedIndex, setSpeedIndex] = useState(() =>
		loadStoredIndex(SPEED_STORAGE_KEY, DEFAULT_SPEED_INDEX, SPEED_LEVELS.length),
	);
	const [fontIndex, setFontIndex] = useState(() =>
		loadStoredIndex(FONT_STORAGE_KEY, DEFAULT_FONT_SIZE_INDEX, FONT_SIZES.length),
	);

	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const scrollPositionRef = useRef(0);
	const speedIndexRef = useRef(speedIndex);
	const editingRef = useRef(editing);
	const autoScrollingRef = useRef(false);

	useEffect(() => {
		window.localStorage.setItem(SCRIPT_STORAGE_KEY, script);
	}, [script]);

	useEffect(() => {
		window.localStorage.setItem(SPEED_STORAGE_KEY, String(speedIndex));
		speedIndexRef.current = speedIndex;
	}, [speedIndex]);

	useEffect(() => {
		window.localStorage.setItem(FONT_STORAGE_KEY, String(fontIndex));
	}, [fontIndex]);

	useEffect(() => {
		editingRef.current = editing;
	}, [editing]);

	// Auto-scroll loop. Fractional position lives in scrollPositionRef so slow
	// speeds accumulate sub-pixel movement instead of stalling.
	useEffect(() => {
		if (!playing || editing) {
			return;
		}
		let frame = 0;
		let lastTime: number | null = null;
		const tick = (time: number) => {
			const container = scrollContainerRef.current;
			if (container && lastTime !== null) {
				const next = advanceScrollTop(
					scrollPositionRef.current,
					SPEED_LEVELS[speedIndexRef.current],
					time - lastTime,
				);
				const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
				scrollPositionRef.current = Math.min(next, maxScroll);
				autoScrollingRef.current = true;
				container.scrollTop = scrollPositionRef.current;
				autoScrollingRef.current = false;
				if (scrollPositionRef.current >= maxScroll) {
					setPlaying(false);
					return;
				}
			}
			lastTime = time;
			frame = window.requestAnimationFrame(tick);
		};
		frame = window.requestAnimationFrame(tick);
		return () => window.cancelAnimationFrame(frame);
	}, [playing, editing]);

	const togglePlay = useCallback(() => {
		if (editingRef.current) {
			setEditing(false);
			setPlaying(true);
			return;
		}
		setPlaying((was) => !was);
	}, []);

	// Global hotkeys relayed from the main process.
	useEffect(() => {
		const unsubscribe = window.electronAPI?.onTeleprompterCommand?.((command) => {
			if (command === "toggle-play") {
				togglePlay();
			} else if (command === "speed-down") {
				setSpeedIndex((index) => stepIndex(index, -1, SPEED_LEVELS.length));
			} else if (command === "speed-up") {
				setSpeedIndex((index) => stepIndex(index, 1, SPEED_LEVELS.length));
			}
		});
		return unsubscribe;
	}, [togglePlay]);

	// Manual scrolling always works and pauses auto-scroll.
	const handleWheel = useCallback(() => {
		setPlaying(false);
	}, []);

	const handleScroll = useCallback(() => {
		const container = scrollContainerRef.current;
		if (container && !autoScrollingRef.current) {
			scrollPositionRef.current = container.scrollTop;
		}
	}, []);

	const startReading = useCallback(() => {
		setEditing(false);
	}, []);

	const backToEdit = useCallback(() => {
		setPlaying(false);
		setEditing(true);
	}, []);

	return (
		<div className="flex h-screen w-screen flex-col overflow-hidden bg-[#161616] text-neutral-100">
			<header
				className="flex h-9 shrink-0 items-center gap-2 border-b border-white/10 px-3"
				style={dragRegion}
			>
				<span className="select-none text-xs font-medium text-neutral-400">
					{t("teleprompter.menuLabel", "Teleprompter")}
				</span>
				<span className="select-none truncate text-[10px] text-neutral-600">
					{t("teleprompter.hotkeyHint", "⌥F8 play/pause · ⌥F7/⌥F9 speed · ⌥T show/hide")}
				</span>
				<div className="ml-auto flex items-center gap-1" style={noDragRegion}>
					{!editing && (
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-neutral-400 hover:text-neutral-100"
							onClick={backToEdit}
							title={t("teleprompter.edit", "Edit")}
							aria-label={t("teleprompter.edit", "Edit")}
						>
							<PencilSimpleIcon size={13} weight="bold" />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 text-neutral-400 hover:text-neutral-100"
						onClick={() => window.electronAPI?.teleprompterClose?.()}
						title={t("teleprompter.close", "Close")}
						aria-label={t("teleprompter.close", "Close")}
					>
						<XIcon size={13} weight="bold" />
					</Button>
				</div>
			</header>

			{editing ? (
				<div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
					<textarea
						className="min-h-0 flex-1 resize-none rounded-md border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/25"
						value={script}
						onChange={(event) => setScript(event.target.value)}
						placeholder={t("teleprompter.scriptPlaceholder", "Paste or type your script here…")}
						autoFocus
					/>
					<Button
						className="shrink-0"
						onClick={startReading}
						disabled={script.trim().length === 0}
					>
						{t("teleprompter.startReading", "Start reading")}
					</Button>
				</div>
			) : (
				<>
					<div
						ref={scrollContainerRef}
						className="min-h-0 flex-1 overflow-y-auto px-5"
						onWheel={handleWheel}
						onScroll={handleScroll}
					>
						<div
							className="whitespace-pre-wrap pt-6 pb-[70vh] font-medium leading-relaxed"
							style={{ fontSize: FONT_SIZES[fontIndex] }}
						>
							{script}
						</div>
					</div>
					<footer className="flex h-10 shrink-0 items-center justify-center gap-1 border-t border-white/10 px-2">
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-neutral-300"
							onClick={() => setSpeedIndex((index) => stepIndex(index, -1, SPEED_LEVELS.length))}
							title={t("teleprompter.slower", "Slower")}
							aria-label={t("teleprompter.slower", "Slower")}
						>
							<CaretDownIcon size={14} weight="bold" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-neutral-100"
							onClick={togglePlay}
							title={playing ? t("teleprompter.pause", "Pause") : t("teleprompter.play", "Play")}
							aria-label={
								playing ? t("teleprompter.pause", "Pause") : t("teleprompter.play", "Play")
							}
						>
							{playing ? (
								<PauseIcon size={16} weight="fill" />
							) : (
								<PlayIcon size={16} weight="fill" />
							)}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-neutral-300"
							onClick={() => setSpeedIndex((index) => stepIndex(index, 1, SPEED_LEVELS.length))}
							title={t("teleprompter.faster", "Faster")}
							aria-label={t("teleprompter.faster", "Faster")}
						>
							<CaretUpIcon size={14} weight="bold" />
						</Button>
						<span className="w-10 select-none text-center text-[10px] tabular-nums text-neutral-500">
							{SPEED_LEVELS[speedIndex]}px/s
						</span>
						<div className="mx-1 h-5 w-px bg-white/10" />
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-neutral-300"
							onClick={() => setFontIndex((index) => stepIndex(index, -1, FONT_SIZES.length))}
							title={t("teleprompter.smallerText", "Smaller text")}
							aria-label={t("teleprompter.smallerText", "Smaller text")}
						>
							<MinusIcon size={14} weight="bold" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-neutral-300"
							onClick={() => setFontIndex((index) => stepIndex(index, 1, FONT_SIZES.length))}
							title={t("teleprompter.biggerText", "Bigger text")}
							aria-label={t("teleprompter.biggerText", "Bigger text")}
						>
							<PlusIcon size={14} weight="bold" />
						</Button>
					</footer>
				</>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Route the window type in `src/App.tsx`**

Add the import (with the other component imports at the top):

```tsx
import { Teleprompter } from "./components/teleprompter/Teleprompter";
```

Add a case to the `switch (windowType)` (line 59), before `case "editor"`:

```tsx
		case "teleprompter":
			return <Teleprompter />;
```

- [ ] **Step 3: Add i18n strings to all 10 locales**

Add a top-level `"teleprompter"` object to each `src/i18n/locales/<locale>/launch.json` (sibling of the existing `"recording"` key — place it after, mind the comma).

`en/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "Teleprompter",
		"scriptPlaceholder": "Paste or type your script here…",
		"startReading": "Start reading",
		"edit": "Edit",
		"play": "Play",
		"pause": "Pause",
		"slower": "Slower",
		"faster": "Faster",
		"smallerText": "Smaller text",
		"biggerText": "Bigger text",
		"close": "Close",
		"hotkeyHint": "⌥F8 play/pause · ⌥F7/⌥F9 speed · ⌥T show/hide"
	}
```

`es/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "Teleprompter",
		"scriptPlaceholder": "Pega o escribe tu guion aquí…",
		"startReading": "Empezar a leer",
		"edit": "Editar",
		"play": "Reproducir",
		"pause": "Pausar",
		"slower": "Más lento",
		"faster": "Más rápido",
		"smallerText": "Texto más pequeño",
		"biggerText": "Texto más grande",
		"close": "Cerrar",
		"hotkeyHint": "⌥F8 reproducir/pausar · ⌥F7/⌥F9 velocidad · ⌥T mostrar/ocultar"
	}
```

`fr/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "Téléprompteur",
		"scriptPlaceholder": "Collez ou tapez votre script ici…",
		"startReading": "Commencer la lecture",
		"edit": "Modifier",
		"play": "Lecture",
		"pause": "Pause",
		"slower": "Plus lent",
		"faster": "Plus rapide",
		"smallerText": "Texte plus petit",
		"biggerText": "Texte plus grand",
		"close": "Fermer",
		"hotkeyHint": "⌥F8 lecture/pause · ⌥F7/⌥F9 vitesse · ⌥T afficher/masquer"
	}
```

`it/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "Teleprompter",
		"scriptPlaceholder": "Incolla o scrivi qui il tuo copione…",
		"startReading": "Inizia a leggere",
		"edit": "Modifica",
		"play": "Riproduci",
		"pause": "Pausa",
		"slower": "Più lento",
		"faster": "Più veloce",
		"smallerText": "Testo più piccolo",
		"biggerText": "Testo più grande",
		"close": "Chiudi",
		"hotkeyHint": "⌥F8 riproduci/pausa · ⌥F7/⌥F9 velocità · ⌥T mostra/nascondi"
	}
```

`ko/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "텔레프롬프터",
		"scriptPlaceholder": "여기에 대본을 붙여넣거나 입력하세요…",
		"startReading": "읽기 시작",
		"edit": "편집",
		"play": "재생",
		"pause": "일시정지",
		"slower": "느리게",
		"faster": "빠르게",
		"smallerText": "글자 작게",
		"biggerText": "글자 크게",
		"close": "닫기",
		"hotkeyHint": "⌥F8 재생/일시정지 · ⌥F7/⌥F9 속도 · ⌥T 표시/숨기기"
	}
```

`nl/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "Teleprompter",
		"scriptPlaceholder": "Plak of typ hier je script…",
		"startReading": "Beginnen met lezen",
		"edit": "Bewerken",
		"play": "Afspelen",
		"pause": "Pauzeren",
		"slower": "Langzamer",
		"faster": "Sneller",
		"smallerText": "Kleinere tekst",
		"biggerText": "Grotere tekst",
		"close": "Sluiten",
		"hotkeyHint": "⌥F8 afspelen/pauzeren · ⌥F7/⌥F9 snelheid · ⌥T tonen/verbergen"
	}
```

`pt-BR/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "Teleprompter",
		"scriptPlaceholder": "Cole ou digite seu roteiro aqui…",
		"startReading": "Começar a ler",
		"edit": "Editar",
		"play": "Reproduzir",
		"pause": "Pausar",
		"slower": "Mais devagar",
		"faster": "Mais rápido",
		"smallerText": "Texto menor",
		"biggerText": "Texto maior",
		"close": "Fechar",
		"hotkeyHint": "⌥F8 reproduzir/pausar · ⌥F7/⌥F9 velocidade · ⌥T mostrar/ocultar"
	}
```

`ru/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "Телесуфлёр",
		"scriptPlaceholder": "Вставьте или введите текст сценария…",
		"startReading": "Начать чтение",
		"edit": "Редактировать",
		"play": "Воспроизвести",
		"pause": "Пауза",
		"slower": "Медленнее",
		"faster": "Быстрее",
		"smallerText": "Мельче текст",
		"biggerText": "Крупнее текст",
		"close": "Закрыть",
		"hotkeyHint": "⌥F8 воспроизведение/пауза · ⌥F7/⌥F9 скорость · ⌥T показать/скрыть"
	}
```

`zh-CN/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "提词器",
		"scriptPlaceholder": "在此粘贴或输入您的文稿…",
		"startReading": "开始阅读",
		"edit": "编辑",
		"play": "播放",
		"pause": "暂停",
		"slower": "减速",
		"faster": "加速",
		"smallerText": "缩小文字",
		"biggerText": "放大文字",
		"close": "关闭",
		"hotkeyHint": "⌥F8 播放/暂停 · ⌥F7/⌥F9 速度 · ⌥T 显示/隐藏"
	}
```

`zh-TW/launch.json`:

```json
	"teleprompter": {
		"menuLabel": "提詞器",
		"scriptPlaceholder": "在此貼上或輸入您的文稿…",
		"startReading": "開始閱讀",
		"edit": "編輯",
		"play": "播放",
		"pause": "暫停",
		"slower": "減速",
		"faster": "加速",
		"smallerText": "縮小文字",
		"biggerText": "放大文字",
		"close": "關閉",
		"hotkeyHint": "⌥F8 播放/暫停 · ⌥F7/⌥F9 速度 · ⌥T 顯示/隱藏"
	}
```

- [ ] **Step 4: Verify i18n, types, and lint**

```bash
npm run i18n:check && npx tsc --noEmit && npx biome check src/components/teleprompter src/App.tsx src/i18n
```

Expected: all pass. If `i18n:check` complains about key ordering or unused keys, follow its output exactly.

- [ ] **Step 5: Commit**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools" && git add RECORDLY/src && git commit -m "Add teleprompter renderer window with auto-scroll and hotkey commands"
```

---

### Task 8: Launch surface — menu item in the HUD "More" popover

**Files:**
- Modify: `src/components/launch/popovers/MorePopover.tsx`

- [ ] **Step 1: Add the menu item**

Add `ArticleIcon` to the existing `@phosphor-icons/react` import at the top of `MorePopover.tsx`:

```ts
import {
	ArticleIcon,
	EyeIcon,
	...
```

Then add a `DropdownItem` right after the "Open project" item (the `DropdownItem` whose label is `t("recording.openProject")`, around line 109-115):

```tsx
			<DropdownItem
				icon={<ArticleIcon size={15} weight="bold" />}
				onClick={() => {
					window.electronAPI.teleprompterToggle();
				}}
			>
				{t("teleprompter.menuLabel", "Teleprompter")}
			</DropdownItem>
```

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit && npx biome check src/components/launch/popovers/MorePopover.tsx
```

Expected: no errors. (If `ArticleIcon` does not exist in this @phosphor-icons/react version, use `NotepadIcon` instead — verify with `grep -r "ArticleIcon" node_modules/@phosphor-icons/react/dist/index.d.ts`.)

- [ ] **Step 3: Commit**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools" && git add RECORDLY/src/components/launch && git commit -m "Add teleprompter toggle to HUD more menu"
```

---

### Task 9: Final verification (automated + manual)

- [ ] **Step 1: Full automated check**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY" && npm test && npm run i18n:check && npx tsc --noEmit && npx biome check electron/teleprompterBounds.ts electron/teleprompterShortcuts.ts electron/windows.ts electron/main.ts electron/preload.ts electron/electron-env.d.ts src/components/teleprompter src/App.tsx src/components/launch/popovers/MorePopover.tsx src/lib/exporter/audioRoutingEngine.ts
```

Expected: everything passes; no new test failures versus the Task 1 baseline.

- [ ] **Step 2: Manual verification in dev mode (requires the user or a screen)**

```bash
npm run dev
```

Checklist to verify (report results to the user; the capture-exclusion check needs an actual recording):

1. HUD appears → More menu (⋯) shows "Teleprompter"; clicking opens the window top-center.
2. Type a script → "Start reading" shows the large scrolling view.
3. ⌥F8 starts/stops auto-scroll while another app is focused; ⌥F7/⌥F9 change speed; ⌥T hides/shows the window.
4. Manual trackpad scroll works and pauses auto-scroll.
5. Record the screen with Recordly while the teleprompter is visible → the exported/previewed recording must NOT contain the teleprompter window.
6. Echo check: record screen+mic (system audio off), open in editor, press play → voice plays once (no echo).
7. Close/reopen teleprompter → script text persists.

- [ ] **Step 3: Final commit (if any fixes were needed during verification)**

```bash
cd "/Users/justmaiko/PROJECTS/Mini Tools" && git add RECORDLY && git commit -m "Teleprompter: verification fixes"
```
