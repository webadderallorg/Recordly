import { afterEach, describe, expect, it, vi } from "vitest";

import {
	DEFAULT_EDITOR_PREFERENCES,
	EDITOR_PREFERENCES_STORAGE_KEY,
	EDITOR_PRESETS_STORAGE_KEY,
	loadEditorPreferences,
	loadEditorPresets,
	normalizeEditorPreferences,
	saveEditorPreferences,
	saveEditorPresets,
} from "./editorPreferences";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

function createStorageMock(initialValues: Record<string, string> = {}): Storage {
	const store = new Map(Object.entries(initialValues));

	return {
		get length() {
			return store.size;
		},
		clear() {
			store.clear();
		},
		getItem(key) {
			return store.get(key) ?? null;
		},
		key(index) {
			return Array.from(store.keys())[index] ?? null;
		},
		removeItem(key) {
			store.delete(key);
		},
		setItem(key, value) {
			store.set(key, value);
		},
	};
}

function stubElectronSettings(initialValues: Record<string, unknown> = {}) {
	const store = new Map(Object.entries(initialValues));

	Object.defineProperty(globalThis, "electronAPI", {
		configurable: true,
		value: {
			getAppSetting: (key: string) => (store.has(key) ? store.get(key) : null),
			setAppSetting: (key: string, value: unknown) => {
				store.set(key, value);
				return true;
			},
		} as Pick<Window["electronAPI"], "getAppSetting" | "setAppSetting">,
	});

	return store;
}

describe("editorPreferences", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		Reflect.deleteProperty(globalThis, "electronAPI");
	});

	it("normalizes invalid values back to safe defaults", () => {
		expect(
			normalizeEditorPreferences({
				wallpaper: 123,
				showCursor: "yes",
				cropRegion: { x: 2, width: -1 },
				aspectRatio: "bad-value",
				customAspectWidth: "0",
				customAspectHeight: "",
				customWallpapers: "not-an-array",
			}),
		).toMatchObject({
			wallpaper: DEFAULT_EDITOR_PREFERENCES.wallpaper,
			showCursor: DEFAULT_EDITOR_PREFERENCES.showCursor,
			aspectRatio: DEFAULT_EDITOR_PREFERENCES.aspectRatio,
			cursorStyle: DEFAULT_EDITOR_PREFERENCES.cursorStyle,
			cursorSize: DEFAULT_EDITOR_PREFERENCES.cursorSize,
			customAspectWidth: DEFAULT_EDITOR_PREFERENCES.customAspectWidth,
			customAspectHeight: DEFAULT_EDITOR_PREFERENCES.customAspectHeight,
			customWallpapers: DEFAULT_EDITOR_PREFERENCES.customWallpapers,
		});
	});

	it("defaults MP4 exports to source quality", () => {
		expect(DEFAULT_EDITOR_PREFERENCES.exportQuality).toBe("source");
	});

	it("defaults cursor preferences to macOS at 2.5x with gentler sway", () => {
		expect(DEFAULT_EDITOR_PREFERENCES.cursorStyle).toBe("macos");
		expect(DEFAULT_EDITOR_PREFERENCES.cursorSize).toBe(2.5);
		expect(DEFAULT_EDITOR_PREFERENCES.cursorSway).toBe(0.4);
	});

	it("defaults MP4 exports to the Lightning pipeline", () => {
		expect(DEFAULT_EDITOR_PREFERENCES.exportPipelineModel).toBe("modern");
	});

	it("bakes in the stronger split motion blur defaults", () => {
		expect(DEFAULT_EDITOR_PREFERENCES.zoomMotionBlurTuning).toMatchObject({
			panVelocityThreshold: 0,
			zoomVelocityThreshold: 0,
			maxDirectionalBlurPx: 41.8,
			maxRadialBlurStrength: 1,
		});
	});

	it("ignores legacy persisted dev-only motion blur overrides", () => {
		vi.stubGlobal(
			"localStorage",
			createStorageMock({
				[EDITOR_PREFERENCES_STORAGE_KEY]: JSON.stringify({
					zoomMotionBlurTuning: {
						panVelocityThreshold: 40,
						zoomVelocityThreshold: 0.2,
						maxDirectionalBlurPx: 96,
						maxRadialBlurStrength: 1.5,
						panResponsePerSecond: 22,
						zoomResponsePerSecond: 18,
						zoomSafeZoneRadiusPx: 40,
					},
				}),
			}),
		);

		const loaded = loadEditorPreferences();

		expect(loaded.zoomMotionBlurTuning).toEqual(DEFAULT_EDITOR_PREFERENCES.zoomMotionBlurTuning);
	});

	it("does not save dev-only split blur tuning overrides to editor preferences", () => {
		const localStorage = createStorageMock();
		vi.stubGlobal("localStorage", localStorage);

		saveEditorPreferences({
			zoomMotionBlurTuning: {
				...DEFAULT_EDITOR_PREFERENCES.zoomMotionBlurTuning,
				maxDirectionalBlurPx: 96,
				maxRadialBlurStrength: 1.5,
			},
		});

		const stored = JSON.parse(
			localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY) ?? "{}",
		) as Record<string, unknown>;

		expect(stored).not.toHaveProperty("zoomMotionBlurTuning");
	});

	it("loads stored editor control preferences", () => {
		vi.stubGlobal(
			"localStorage",
			createStorageMock({
				[EDITOR_PREFERENCES_STORAGE_KEY]: JSON.stringify({
					wallpaper: "#123456",
					backgroundBlur: 3.5,
					showCursor: false,
					cropRegion: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
					aspectRatio: "native",
					exportFormat: "gif",
					gifFrameRate: 30,
					gifLoop: false,
					customAspectWidth: "21",
					customAspectHeight: "9",
					customWallpapers: ["data:image/jpeg;base64,abc"],
				}),
			}),
		);

		expect(loadEditorPreferences()).toEqual({
			...DEFAULT_EDITOR_PREFERENCES,
			wallpaper: "#123456",
			backgroundBlur: 3.5,
			showCursor: false,
			aspectRatio: "native",
			zoomInOverlapMs: 200,
			exportFormat: "gif",
			gifFrameRate: 30,
			gifLoop: false,
			customAspectWidth: "21",
			customAspectHeight: "9",
			customWallpapers: ["data:image/jpeg;base64,abc"],
		});
	});

	it("preserves a stored wallpaper choice on startup", () => {
		vi.stubGlobal(
			"localStorage",
			createStorageMock({
				[EDITOR_PREFERENCES_STORAGE_KEY]: JSON.stringify({
					wallpaper: "/wallpapers/wallpaper1.jpg",
				}),
			}),
		);

		expect(loadEditorPreferences().wallpaper).toBe("/wallpapers/wallpaper1.jpg");
	});

	it("preserves the last valid custom aspect inputs while typing", () => {
		const localStorage = createStorageMock({
			[EDITOR_PREFERENCES_STORAGE_KEY]: JSON.stringify({
				aspectRatio: "16:9",
				customAspectWidth: "21",
				customAspectHeight: "9",
			}),
		});
		vi.stubGlobal("localStorage", localStorage);

		saveEditorPreferences({ customAspectWidth: "", customAspectHeight: "abc" });

		expect(loadEditorPreferences()).toEqual({
			...DEFAULT_EDITOR_PREFERENCES,
			aspectRatio: "16:9",
			zoomInOverlapMs: 200,
			customAspectWidth: "21",
			customAspectHeight: "9",
		});
	});

	it("preserves custom Whisper paths from stored preferences", () => {
		vi.stubGlobal(
			"localStorage",
			createStorageMock({
				[EDITOR_PREFERENCES_STORAGE_KEY]: JSON.stringify({
					whisperExecutablePath: "/usr/local/bin/whisper-cli",
					whisperModelPath: "/Users/test/models/ggml-base.bin",
				}),
			}),
		);

		expect(loadEditorPreferences()).toMatchObject({
			whisperExecutablePath: "/usr/local/bin/whisper-cli",
			whisperModelPath: "/Users/test/models/ggml-base.bin",
		});
	});

	it("saves all editor controls with normalization", () => {
		const localStorage = createStorageMock();
		vi.stubGlobal("localStorage", localStorage);

		saveEditorPreferences({
			wallpaper: "linear-gradient(to right, #000000, #ffffff)",
			shadowIntensity: 0.4,
			backgroundBlur: 1.5,
			zoomMotionBlur: 0.75,
			connectZooms: false,
			zoomInDurationMs: DEFAULT_EDITOR_PREFERENCES.zoomInDurationMs,
			zoomInOverlapMs: DEFAULT_EDITOR_PREFERENCES.zoomInOverlapMs,
			zoomOutDurationMs: DEFAULT_EDITOR_PREFERENCES.zoomOutDurationMs,
			connectedZoomGapMs: DEFAULT_EDITOR_PREFERENCES.connectedZoomGapMs,
			connectedZoomDurationMs: DEFAULT_EDITOR_PREFERENCES.connectedZoomDurationMs,
			zoomInEasing: DEFAULT_EDITOR_PREFERENCES.zoomInEasing,
			zoomOutEasing: DEFAULT_EDITOR_PREFERENCES.zoomOutEasing,
			connectedZoomEasing: DEFAULT_EDITOR_PREFERENCES.connectedZoomEasing,
			showCursor: false,
			loopCursor: true,
			cursorStyle: "figma",
			cursorSize: 3,
			cursorSmoothing: 1.25,
			cursorMotionBlur: 0.5,
			cursorClickBounce: 2.25,
			cursorClickBounceDuration: 350,
			cursorSway: 1.5,
			borderRadius: 18,
			padding: { top: 30, right: 30, bottom: 30, left: 30, linked: true },
			frame: DEFAULT_EDITOR_PREFERENCES.frame,
			aspectRatio: "4:5",
			exportEncodingMode: "quality",
			exportBackendPreference: DEFAULT_EDITOR_PREFERENCES.exportBackendPreference,
			exportPipelineModel: DEFAULT_EDITOR_PREFERENCES.exportPipelineModel,
			exportQuality: "source",
			mp4FrameRate: DEFAULT_EDITOR_PREFERENCES.mp4FrameRate,
			exportFormat: "gif",
			gifFrameRate: 20,
			gifLoop: false,
			gifSizePreset: "large",
			customAspectWidth: "4",
			customAspectHeight: "5",
			customWallpapers: ["data:image/jpeg;base64,abc", "data:image/jpeg;base64,abc"],
			autoApplyFreshRecordingAutoZooms: false,
		});

		expect(loadEditorPreferences()).toMatchObject({
			wallpaper: "linear-gradient(to right, #000000, #ffffff)",
			shadowIntensity: 0.4,
			backgroundBlur: 1.5,
			zoomMotionBlur: 0.75,
			connectZooms: false,
			zoomInOverlapMs: 200,
			showCursor: false,
			loopCursor: true,
			cursorStyle: "figma",
			cursorSize: DEFAULT_EDITOR_PREFERENCES.cursorSize,
			cursorSmoothing: DEFAULT_EDITOR_PREFERENCES.cursorSmoothing,
			cursorMotionBlur: DEFAULT_EDITOR_PREFERENCES.cursorMotionBlur,
			cursorClickBounce: DEFAULT_EDITOR_PREFERENCES.cursorClickBounce,
			cursorClickBounceDuration: DEFAULT_EDITOR_PREFERENCES.cursorClickBounceDuration,
			cursorSway: 1.5,
			borderRadius: 18,
			padding: { top: 30, right: 30, bottom: 30, left: 30, linked: true },
			aspectRatio: "4:5",
			exportEncodingMode: "quality",
			exportFormat: "gif",
			gifFrameRate: 20,
			gifLoop: false,
			gifSizePreset: "large",
			customAspectWidth: "4",
			customAspectHeight: "5",
			customWallpapers: ["data:image/jpeg;base64,abc"],
			autoApplyFreshRecordingAutoZooms: false,
		});
	});

	it("saves custom Whisper paths", () => {
		const localStorage = createStorageMock();
		vi.stubGlobal("localStorage", localStorage);

		saveEditorPreferences({
			whisperExecutablePath: "/opt/homebrew/bin/whisper-cli",
			whisperModelPath: "/Users/test/models/ggml-small.bin",
		});

		expect(loadEditorPreferences()).toMatchObject({
			whisperExecutablePath: "/opt/homebrew/bin/whisper-cli",
			whisperModelPath: "/Users/test/models/ggml-small.bin",
		});
	});

	it("loads editor preferences from Electron app settings when available", () => {
		stubElectronSettings({
			[EDITOR_PREFERENCES_STORAGE_KEY]: {
				wallpaper: "#0f172a",
				showCursor: false,
				customAspectWidth: "3",
				customAspectHeight: "2",
			},
		});

		expect(loadEditorPreferences()).toMatchObject({
			wallpaper: "#0f172a",
			showCursor: false,
			customAspectWidth: "3",
			customAspectHeight: "2",
		});
	});

	it("saves editor presets and reports success", () => {
		const localStorage = createStorageMock();
		vi.stubGlobal("localStorage", localStorage);

		expect(
			saveEditorPresets([
				{
					id: "preset-1",
					name: " Demo Preset ",
					createdAt: "2026-05-01T00:00:00.000Z",
					updatedAt: "2026-05-01T00:00:00.000Z",
					snapshot: {
						...DEFAULT_EDITOR_PREFERENCES,
						autoCaptionSettings: DEFAULT_AUTO_CAPTION_SETTINGS,
					},
				},
			]),
		).toBe(true);

		expect(localStorage.getItem(EDITOR_PRESETS_STORAGE_KEY)).not.toBeNull();
		expect(loadEditorPresets()).toMatchObject([
			{
				id: "preset-1",
				name: "Demo Preset",
			},
		]);
	});

	it("saves editor presets to Electron app settings when available", () => {
		const settingsStore = stubElectronSettings();

		expect(
			saveEditorPresets([
				{
					id: "preset-1",
					name: "Demo Preset",
					createdAt: "2026-05-01T00:00:00.000Z",
					updatedAt: "2026-05-02T00:00:00.000Z",
					snapshot: {
						...DEFAULT_EDITOR_PREFERENCES,
						autoCaptionSettings: DEFAULT_AUTO_CAPTION_SETTINGS,
					},
				},
			]),
		).toBe(true);

		expect(settingsStore.get(EDITOR_PRESETS_STORAGE_KEY)).toMatchObject([
			{
				id: "preset-1",
				name: "Demo Preset",
			},
		]);
	});

	it("returns false when preset persistence fails", () => {
		const localStorage = createStorageMock();
		localStorage.setItem = () => {
			throw new Error("quota exceeded");
		};
		vi.stubGlobal("localStorage", localStorage);

		expect(saveEditorPresets([])).toBe(false);
	});
});
