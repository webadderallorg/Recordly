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
import { DEFAULT_AUTO_CAPTION_SETTINGS, DEFAULT_CROP_REGION } from "./types";

describe("border radius preferences", () => {
	it("migrates legacy pixels once and marks the stored unit", () => {
		expect(normalizeEditorPreferences({ borderRadius: 54 })).toMatchObject({
			borderRadius: 5,
			borderRadiusUnit: "percent",
		});
		expect(
			normalizeEditorPreferences({ borderRadius: 8, borderRadiusUnit: "percent" }),
		).toMatchObject({ borderRadius: 8, borderRadiusUnit: "percent" });
	});

	it("only replaces a legacy zero radius on macOS", () => {
		try {
			vi.stubGlobal("navigator", { platform: "Win32" });
			expect(normalizeEditorPreferences({ borderRadius: 0 }).borderRadius).toBe(0);
			vi.stubGlobal("navigator", { platform: "MacIntel" });
			expect(normalizeEditorPreferences({ borderRadius: 0 }).borderRadius).toBe(8);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

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

	it("drops the retired automatic zoom preference from stored settings", () => {
		vi.stubGlobal(
			"localStorage",
			createStorageMock({
				[EDITOR_PREFERENCES_STORAGE_KEY]: JSON.stringify({
					autoApplyFreshRecordingAutoZooms: true,
				}),
			}),
		);
		expect(loadEditorPreferences()).not.toHaveProperty("autoApplyFreshRecordingAutoZooms");
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

	it("saves webcam controls independently and retains a zero shadow after reload", () => {
		vi.stubGlobal("localStorage", createStorageMock());
		stubElectronSettings();
		saveEditorPreferences({
			webcam: { shadow: 0.2, width: 55, roundness: 69 },
		});
		saveEditorPreferences({ webcam: { width: 60 } });
		expect(loadEditorPreferences().webcam).toMatchObject({
			shadow: 0.2,
			width: 60,
			roundness: 69,
		});
		saveEditorPreferences({ webcam: { shadow: 0 } });
		saveEditorPreferences({ shadowIntensity: 0.67 });
		expect(loadEditorPreferences().webcam.shadow).toBe(0);
	});

	it("defaults MP4 exports to FHD with advanced settings collapsed", () => {
		expect(DEFAULT_EDITOR_PREFERENCES.exportQuality).toBe("medium");
		expect(DEFAULT_EDITOR_PREFERENCES.advancedExportSettings).toBe(false);
		expect(DEFAULT_EDITOR_PREFERENCES.exportEncodingMode).toBe("balanced");
	});

	it("defaults fresh editor preferences to a 50% shadow", () => {
		vi.stubGlobal("localStorage", createStorageMock());
		stubElectronSettings();
		expect(DEFAULT_EDITOR_PREFERENCES.shadowIntensity).toBe(0.5);
		expect(loadEditorPreferences().shadowIntensity).toBe(0.5);
	});

	it("keeps encoding mode when Advanced collapses and reopens after a restart", () => {
		vi.stubGlobal("localStorage", createStorageMock());
		saveEditorPreferences({
			advancedExportSettings: true,
			exportQuality: "medium",
			exportEncodingMode: "quality",
		});
		saveEditorPreferences({ advancedExportSettings: false });
		expect(loadEditorPreferences()).toMatchObject({
			advancedExportSettings: false,
			exportQuality: "medium",
			exportEncodingMode: "quality",
		});
	});

	it("restores valid advanced custom resolution preferences and rejects invalid sizes", () => {
		expect(
			normalizeEditorPreferences({
				exportQuality: "custom",
				advancedExportSettings: true,
				customExportResolution: { width: 2400, height: 1350 },
			}),
		).toMatchObject({
			exportQuality: "custom",
			advancedExportSettings: true,
			customExportResolution: { width: 2400, height: 1350 },
		});
		expect(
			normalizeEditorPreferences({ customExportResolution: { width: 8193, height: 1080 } })
				.customExportResolution,
		).toEqual({ width: 1920, height: 1080 });
		expect(normalizeEditorPreferences({ exportQuality: "hd" }).exportQuality).toBe("hd");
	});

	it("defaults cursor preferences to Tahoe at 2.5x with gentler sway", () => {
		expect(DEFAULT_EDITOR_PREFERENCES.cursorStyle).toBe("tahoe");
		expect(DEFAULT_EDITOR_PREFERENCES.cursorSize).toBe(2.5);
		expect(DEFAULT_EDITOR_PREFERENCES.cursorSway).toBe(0.4);
	});

	it("defaults MP4 exports to the Lightning pipeline", () => {
		expect(DEFAULT_EDITOR_PREFERENCES.exportPipelineModel).toBe("modern");
	});

	it("migrates hidden legacy pipeline preferences to Lightning", () => {
		expect(normalizeEditorPreferences({ exportPipelineModel: "legacy" })).toMatchObject({
			exportPipelineModel: "modern",
		});
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

		expect(loaded.zoomMotionBlurTuning).toEqual(
			DEFAULT_EDITOR_PREFERENCES.zoomMotionBlurTuning,
		);
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
						cropRegion: DEFAULT_CROP_REGION,
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
						cropRegion: DEFAULT_CROP_REGION,
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

	it("does not let localStorage failures mask Electron preset persistence", () => {
		const settingsStore = stubElectronSettings();
		const localStorage = createStorageMock();
		localStorage.setItem = () => {
			throw new Error("localStorage unavailable");
		};
		vi.stubGlobal("localStorage", localStorage);

		expect(
			saveEditorPresets([
				{
					id: "preset-1",
					name: "Demo Preset",
					createdAt: "2026-05-01T00:00:00.000Z",
					updatedAt: "2026-05-02T00:00:00.000Z",
					snapshot: {
						...DEFAULT_EDITOR_PREFERENCES,
						cropRegion: DEFAULT_CROP_REGION,
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

	it("preserves crop region in editor preset snapshots", () => {
		const localStorage = createStorageMock();
		vi.stubGlobal("localStorage", localStorage);

		expect(
			saveEditorPresets([
				{
					id: "preset-1",
					name: "Cropped Demo",
					createdAt: "2026-05-01T00:00:00.000Z",
					updatedAt: "2026-05-01T00:00:00.000Z",
					snapshot: {
						...DEFAULT_EDITOR_PREFERENCES,
						cropRegion: { x: 0.08, y: 0.12, width: 0.8, height: 0.7 },
						autoCaptionSettings: DEFAULT_AUTO_CAPTION_SETTINGS,
					},
				},
			]),
		).toBe(true);

		expect(loadEditorPresets()[0]?.snapshot.cropRegion).toEqual({
			x: 0.08,
			y: 0.12,
			width: 0.8,
			height: 0.7,
		});
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

describe("source-specific webcam metadata", () => {
	it("does not copy imported source ranges into a reusable style preset", () => {
		vi.stubGlobal("localStorage", createStorageMock());
		saveEditorPresets([
			{
				id: "webcam",
				name: "Webcam",
				createdAt: "2026-09-20T00:00:00Z",
				updatedAt: "2026-09-20T00:00:00Z",
				snapshot: {
					...DEFAULT_EDITOR_PREFERENCES,
					cropRegion: DEFAULT_CROP_REGION,
					autoCaptionSettings: DEFAULT_AUTO_CAPTION_SETTINGS,
					webcam: {
						...DEFAULT_EDITOR_PREFERENCES.webcam,
						sourcePath: "/imported-webcam.mp4",
						visibleRanges: [{ startMs: 1000, endMs: 2000 }],
					},
				} as never,
			},
		]);
		expect(loadEditorPresets()[0].snapshot.webcam).not.toHaveProperty("visibleRanges");
		expect(loadEditorPresets()[0].snapshot.webcam).not.toHaveProperty("sourcePath");
	});
});

describe("user preferences stay independent from projects and presets", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("defaults Publish to Link and persists Local and export settings across reloads", () => {
		vi.stubGlobal("localStorage", createStorageMock());
		expect(loadEditorPreferences().publishDestination).toBe("link");
		expect(loadEditorPreferences().mp4FrameRate).toBe(30);
		expect(normalizeEditorPreferences({ mp4FrameRate: 25 as never }).mp4FrameRate).toBe(30);
		saveEditorPreferences({
			publishDestination: "local",
			exportQuality: "high",
			mp4FrameRate: 60,
			includeCaptionSidecar: true,
		});
		expect(loadEditorPreferences()).toMatchObject({
			publishDestination: "local",
			exportQuality: "high",
			mp4FrameRate: 60,
			includeCaptionSidecar: true,
		});
		saveEditorPreferences({ wallpaper: "#123456" });
		expect(loadEditorPreferences().publishDestination).toBe("local");
		expect(normalizeEditorPreferences({ publishDestination: null }).publishDestination).toBe(
			"link",
		);
	});
	it("drops export settings and machine paths from legacy presets", () => {
		vi.stubGlobal("localStorage", createStorageMock());
		const snapshot = {
			...DEFAULT_EDITOR_PREFERENCES,
			cropRegion: DEFAULT_CROP_REGION,
			autoCaptionSettings: DEFAULT_AUTO_CAPTION_SETTINGS,
			whisperModelPath: "/machine/model.bin",
		};
		saveEditorPresets([
			{
				id: "legacy",
				name: "Legacy",
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01",
				snapshot,
			},
		]);
		const loaded = loadEditorPresets()[0].snapshot;
		expect(loaded.wallpaper).toBe(snapshot.wallpaper);
		for (const key of [
			"exportQuality",
			"mp4FrameRate",
			"publishDestination",
			"whisperExecutablePath",
			"whisperModelPath",
		])
			expect(loaded).not.toHaveProperty(key);
	});
});

describe("camera shape preferences", () => {
	it("adopts circle for new recordings and retains explicit shape choices", () => {
		expect(normalizeEditorPreferences({}).webcam.shape).toBe("circle");
		expect(
			normalizeEditorPreferences({ webcam: { size: 60, roundness: 69 } as never }).webcam,
		).toMatchObject({ shape: "circle", width: 60, height: 60, roundness: 69 });
		expect(
			normalizeEditorPreferences({ webcam: { shape: "squircle" } as never }).webcam.shape,
		).toBe("squircle");
		expect(
			normalizeEditorPreferences({ webcam: { shape: "rectangle", roundness: 0 } as never })
				.webcam,
		).toMatchObject({ shape: "rectangle", roundness: 0 });
	});
});
