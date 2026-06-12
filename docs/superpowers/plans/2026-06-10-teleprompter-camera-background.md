# Teleprompter Camera Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the live recording camera, mirrored and faded behind the teleprompter text, with a header toggle and an opacity slider.

**Architecture:** The HUD pushes the selected `webcamDeviceId` to the main process (cached in module state); the teleprompter window queries it on toggle and opens its own `getUserMedia` stream rendered as a mirrored cover `<video>` behind the scroll content with a dark scrim. Stream runs only in read mode with the toggle on. The window's existing `setContentProtection(true)` keeps it out of recordings.

**Tech Stack:** Electron IPC, React/TS, Radix Slider (`@/components/ui/slider`), vitest, Biome (TABS).

**Spec:** `docs/superpowers/specs/2026-06-10-teleprompter-camera-background-design.md`

**Conventions:** npm commands from `/Users/justmaiko/PROJECTS/Mini Tools/RECORDLY`; git commits from `/Users/justmaiko/PROJECTS/Mini Tools`. Baseline: exactly ONE pre-existing test failure (`electron/ipc/paths/binaries.test.ts`); tsc clean. i18n: any new `t()` key must be added to ALL 10 `src/i18n/locales/*/launch.json` files (run `npm run i18n:check` — it has pre-existing settings.json failures; the rule is NO NEW failures and none mentioning launch.json).

---

### Task 1: Pure helpers (TDD)

**Files:**
- Create: `src/components/teleprompter/teleprompterCamera.ts`
- Test: `src/components/teleprompter/teleprompterCamera.test.ts`

- [ ] **Step 1: Failing test** — create `teleprompterCamera.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	CAMERA_OPACITY_DEFAULT,
	CAMERA_OPACITY_MAX,
	CAMERA_OPACITY_MIN,
	clampCameraOpacity,
	parseStoredCameraOpacity,
} from "./teleprompterCamera";

describe("clampCameraOpacity", () => {
	it("clamps into [min, max]", () => {
		expect(clampCameraOpacity(0)).toBe(CAMERA_OPACITY_MIN);
		expect(clampCameraOpacity(1)).toBe(CAMERA_OPACITY_MAX);
		expect(clampCameraOpacity(0.35)).toBe(0.35);
	});
});

describe("parseStoredCameraOpacity", () => {
	it("parses valid stored values and falls back otherwise", () => {
		expect(parseStoredCameraOpacity("0.5")).toBe(0.5);
		expect(parseStoredCameraOpacity("2")).toBe(CAMERA_OPACITY_MAX);
		expect(parseStoredCameraOpacity("junk")).toBe(CAMERA_OPACITY_DEFAULT);
		expect(parseStoredCameraOpacity(null)).toBe(CAMERA_OPACITY_DEFAULT);
	});
});
```

- [ ] **Step 2: Run to verify FAIL** (module not found).
- [ ] **Step 3: Implement** — `teleprompterCamera.ts`:

```ts
export const CAMERA_OPACITY_MIN = 0.05;
export const CAMERA_OPACITY_MAX = 0.8;
export const CAMERA_OPACITY_DEFAULT = 0.35;

export function clampCameraOpacity(value: number): number {
	if (!Number.isFinite(value)) return CAMERA_OPACITY_DEFAULT;
	return Math.max(CAMERA_OPACITY_MIN, Math.min(CAMERA_OPACITY_MAX, value));
}

export function parseStoredCameraOpacity(raw: string | null): number {
	if (raw === null) return CAMERA_OPACITY_DEFAULT;
	const parsed = Number.parseFloat(raw);
	if (!Number.isFinite(parsed)) return CAMERA_OPACITY_DEFAULT;
	return clampCameraOpacity(parsed);
}
```

- [ ] **Step 4: Run to verify PASS**; lint.
- [ ] **Step 5: Commit** — `git commit -m "Add teleprompter camera opacity helpers"`

---

### Task 2: Webcam-device relay (main + preload + HUD)

**Files:**
- Modify: `electron/windows.ts` (module state + IPC, next to the teleprompter IPC handlers at the end of file, ~lines 1113-1119)
- Modify: `electron/preload.ts` (next to teleprompter methods, lines 185-199)
- Modify: `electron/electron-env.d.ts` (next to teleprompter types, lines 212-214)
- Modify: `src/components/launch/LaunchWindow.tsx` (`webcamDeviceId` already destructured at line 76)

- [ ] **Step 1: Main process** — in `electron/windows.ts`, after the existing `ipcMain.on("teleprompter-close", ...)` handler:

```ts
let selectedWebcamDeviceId: string | null = null;

ipcMain.on("webcam-device-changed", (_event, deviceId: string | null) => {
	selectedWebcamDeviceId = typeof deviceId === "string" && deviceId.length > 0 ? deviceId : null;
});

ipcMain.handle("get-selected-webcam-device", () => {
	return selectedWebcamDeviceId;
});
```

- [ ] **Step 2: Preload** — in `electron/preload.ts` after `onTeleprompterCommand`:

```ts
	webcamDeviceChanged: (deviceId: string | null) => {
		ipcRenderer.send("webcam-device-changed", deviceId);
	},
	getSelectedWebcamDevice: () => {
		return ipcRenderer.invoke("get-selected-webcam-device") as Promise<string | null>;
	},
```

- [ ] **Step 3: Types** — in `electron/electron-env.d.ts` after `onTeleprompterCommand`:

```ts
		webcamDeviceChanged: (deviceId: string | null) => void;
		getSelectedWebcamDevice: () => Promise<string | null>;
```

- [ ] **Step 4: HUD push** — in `LaunchWindow.tsx`, add near the other effects (it already destructures `webcamDeviceId` from `useScreenRecorder()` at line 76):

```ts
	useEffect(() => {
		window.electronAPI?.webcamDeviceChanged?.(webcamDeviceId ?? null);
	}, [webcamDeviceId]);
```

(Ensure `useEffect` is already imported — it is, LaunchWindow uses effects.)

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (only pre-existing error... it should now be CLEAN since dead code was removed earlier — expect zero errors), `npx biome check electron/windows.ts electron/preload.ts electron/electron-env.d.ts src/components/launch/LaunchWindow.tsx`.
- [ ] **Step 6: Commit** — `git commit -m "Relay selected webcam device to main process for teleprompter"`

---

### Task 3: Camera layer in the Teleprompter component

**Files:**
- Modify: `src/components/teleprompter/Teleprompter.tsx`
- Modify: all 10 `src/i18n/locales/*/launch.json` (new keys under the existing `teleprompter` object)

- [ ] **Step 1: Add state, storage, and stream lifecycle.** In `Teleprompter.tsx`:

Add imports:

```tsx
import { VideoCameraIcon, VideoCameraSlashIcon } from "@phosphor-icons/react";
import { Slider } from "@/components/ui/slider";
import {
	CAMERA_OPACITY_MAX,
	CAMERA_OPACITY_MIN,
	clampCameraOpacity,
	parseStoredCameraOpacity,
} from "./teleprompterCamera";
```

(merge the icon imports into the existing `@phosphor-icons/react` import, alphabetically sorted for Biome).

Add storage keys next to the existing ones:

```ts
const CAMERA_ON_STORAGE_KEY = "recordly-teleprompter-camera-on";
const CAMERA_OPACITY_STORAGE_KEY = "recordly-teleprompter-camera-opacity";
```

Add state + refs inside the component:

```ts
	const [cameraOn, setCameraOn] = useState(
		() => window.localStorage.getItem(CAMERA_ON_STORAGE_KEY) === "true",
	);
	const [cameraOpacity, setCameraOpacity] = useState(() =>
		parseStoredCameraOpacity(window.localStorage.getItem(CAMERA_OPACITY_STORAGE_KEY)),
	);
	const [cameraError, setCameraError] = useState(false);
	const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
	const cameraStreamRef = useRef<MediaStream | null>(null);
```

Persistence effects (next to the existing ones):

```ts
	useEffect(() => {
		window.localStorage.setItem(CAMERA_ON_STORAGE_KEY, String(cameraOn));
	}, [cameraOn]);

	useEffect(() => {
		window.localStorage.setItem(CAMERA_OPACITY_STORAGE_KEY, String(cameraOpacity));
	}, [cameraOpacity]);
```

Stream lifecycle effect — stream runs ONLY when `cameraOn && !editing`:

```ts
	useEffect(() => {
		if (!cameraOn || editing) {
			return;
		}
		let cancelled = false;

		const stopStream = () => {
			for (const track of cameraStreamRef.current?.getTracks() ?? []) {
				track.stop();
			}
			cameraStreamRef.current = null;
			if (cameraVideoRef.current) {
				cameraVideoRef.current.srcObject = null;
			}
		};

		void (async () => {
			setCameraError(false);
			const deviceId = await window.electronAPI?.getSelectedWebcamDevice?.().catch(() => null);
			const constraintsList: MediaStreamConstraints[] = deviceId
				? [{ video: { deviceId: { exact: deviceId } } }, { video: true }]
				: [{ video: true }];
			for (const constraints of constraintsList) {
				try {
					const stream = await navigator.mediaDevices.getUserMedia(constraints);
					if (cancelled) {
						for (const track of stream.getTracks()) {
							track.stop();
						}
						return;
					}
					cameraStreamRef.current = stream;
					if (cameraVideoRef.current) {
						cameraVideoRef.current.srcObject = stream;
					}
					return;
				} catch {
					// Try the next (less strict) constraints.
				}
			}
			if (!cancelled) {
				setCameraError(true);
				setCameraOn(false);
			}
		})();

		return () => {
			cancelled = true;
			stopStream();
		};
	}, [cameraOn, editing]);
```

- [ ] **Step 2: Render the camera layer.** In the read-mode branch, make the scroll container's parent relatively positioned and add the video behind the scroll content. Replace the read-mode fragment opening (`<>` ... scroll div) with:

```tsx
			<>
				<div className="relative min-h-0 flex-1">
					{cameraOn && (
						<video
							ref={cameraVideoRef}
							autoPlay
							muted
							playsInline
							className="pointer-events-none absolute inset-0 h-full w-full object-cover"
							style={{ transform: "scaleX(-1)", opacity: cameraOpacity }}
						/>
					)}
					<div
						ref={scrollContainerRef}
						className="absolute inset-0 overflow-y-auto px-5"
						onWheel={handleWheel}
						onScroll={handleScroll}
					>
						<div
							className="whitespace-pre-wrap pt-6 pb-[70vh] font-medium leading-relaxed"
							style={{
								fontSize: FONT_SIZES[fontIndex],
								textShadow: cameraOn ? "0 1px 6px rgba(0, 0, 0, 0.9)" : undefined,
							}}
						>
							{script}
						</div>
					</div>
				</div>
```

(the footer stays as-is below; close the wrapper div correctly. The dark scrim is the window's own `bg-[#161616]` showing through the faded video — no extra element needed.)

- [ ] **Step 3: Header toggle + footer slider.** In the header's button group (before the Edit button):

```tsx
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 text-neutral-400 hover:text-neutral-100"
						onClick={() => setCameraOn((was) => !was)}
						title={
							cameraOn
								? t("teleprompter.cameraOff", "Hide camera")
								: t("teleprompter.cameraOn", "Show camera")
						}
						aria-label={
							cameraOn
								? t("teleprompter.cameraOff", "Hide camera")
								: t("teleprompter.cameraOn", "Show camera")
						}
					>
						{cameraOn ? (
							<VideoCameraIcon size={13} weight="bold" />
						) : (
							<VideoCameraSlashIcon size={13} weight="bold" />
						)}
					</Button>
```

In the footer, after the font-size buttons (only when `cameraOn`):

```tsx
						{cameraOn && (
							<>
								<div className="mx-1 h-5 w-px bg-white/10" />
								<Slider
									value={[cameraOpacity]}
									onValueChange={([value]) => setCameraOpacity(clampCameraOpacity(value))}
									min={CAMERA_OPACITY_MIN}
									max={CAMERA_OPACITY_MAX}
									step={0.05}
									className="w-20"
									aria-label={t("teleprompter.cameraFade", "Camera fade")}
								/>
							</>
						)}
```

If `cameraError`, render a small note in the header (next to the hint):

```tsx
				{cameraError && (
					<span className="select-none text-[10px] text-red-400">
						{t("teleprompter.cameraError", "Camera unavailable")}
					</span>
				)}
```

- [ ] **Step 4: i18n** — add to the `teleprompter` object in ALL 10 locale `launch.json` files:

en: `"cameraOn": "Show camera", "cameraOff": "Hide camera", "cameraFade": "Camera fade", "cameraError": "Camera unavailable"`
es: `"cameraOn": "Mostrar cámara", "cameraOff": "Ocultar cámara", "cameraFade": "Atenuación de cámara", "cameraError": "Cámara no disponible"`
fr: `"cameraOn": "Afficher la caméra", "cameraOff": "Masquer la caméra", "cameraFade": "Fondu de la caméra", "cameraError": "Caméra indisponible"`
it: `"cameraOn": "Mostra fotocamera", "cameraOff": "Nascondi fotocamera", "cameraFade": "Dissolvenza fotocamera", "cameraError": "Fotocamera non disponibile"`
ko: `"cameraOn": "카메라 표시", "cameraOff": "카메라 숨기기", "cameraFade": "카메라 페이드", "cameraError": "카메라를 사용할 수 없음"`
nl: `"cameraOn": "Camera tonen", "cameraOff": "Camera verbergen", "cameraFade": "Camera vervagen", "cameraError": "Camera niet beschikbaar"`
pt-BR: `"cameraOn": "Mostrar câmera", "cameraOff": "Ocultar câmera", "cameraFade": "Esmaecimento da câmera", "cameraError": "Câmera indisponível"`
ru: `"cameraOn": "Показать камеру", "cameraOff": "Скрыть камеру", "cameraFade": "Затемнение камеры", "cameraError": "Камера недоступна"`
zh-CN: `"cameraOn": "显示摄像头", "cameraOff": "隐藏摄像头", "cameraFade": "摄像头淡化", "cameraError": "摄像头不可用"`
zh-TW: `"cameraOn": "顯示攝影機", "cameraOff": "隱藏攝影機", "cameraFade": "攝影機淡化", "cameraError": "攝影機無法使用"`

- [ ] **Step 5: Verify** — `npm run i18n:check` (no NEW failures, none mentioning launch.json), `npx tsc --noEmit` (clean), `npx biome check src/components/teleprompter src/i18n`, `npx vitest --run src/components/teleprompter` (all pass).
- [ ] **Step 6: Commit** — `git commit -m "Add faded live camera background to teleprompter"`

---

### Task 4: Final verification

- [ ] **Step 1:** `npm test` (only the 1 pre-existing failure), `npx tsc --noEmit`, biome on touched files.
- [ ] **Step 2:** Manual in dev: open teleprompter → read mode → toggle camera → mirrored faded feed appears behind text; slider changes fade; toggle off / switch to edit → camera light goes off; with multiple cameras, HUD webcam selection is the one shown. Record a clip with the teleprompter+camera visible → not in the recording.
- [ ] **Step 3:** Commit any verification fixes.
