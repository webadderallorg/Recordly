import { afterEach, describe, expect, it, vi } from "vitest";

import {
	DEFAULT_EDITOR_PREFERENCES,
	EDITOR_PREFERENCES_STORAGE_KEY,
	loadEditorPreferences,
	normalizeEditorPreferences,
	saveEditorPreferences,
} from "./editorPreferences";

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

describe("editorPreferences", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
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
		).toEqual(DEFAULT_EDITOR_PREFERENCES);
	});

	it("defaults MP4 exports to source quality", () => {
		expect(DEFAULT_EDITOR_PREFERENCES.exportQuality).toBe("source");
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
			wallpaper: "#123456",
			shadowIntensity: DEFAULT_EDITOR_PREFERENCES.shadowIntensity,
			backgroundBlur: 3.5,
			zoomMotionBlur: DEFAULT_EDITOR_PREFERENCES.zoomMotionBlur,
			connectZooms: DEFAULT_EDITOR_PREFERENCES.connectZooms,
			zoomInDurationMs: DEFAULT_EDITOR_PREFERENCES.zoomInDurationMs,
			zoomInOverlapMs: DEFAULT_EDITOR_PREFERENCES.zoomInOverlapMs,
			zoomOutDurationMs: DEFAULT_EDITOR_PREFERENCES.zoomOutDurationMs,
			connectedZoomGapMs: DEFAULT_EDITOR_PREFERENCES.connectedZoomGapMs,
			connectedZoomDurationMs: DEFAULT_EDITOR_PREFERENCES.connectedZoomDurationMs,
			zoomInEasing: DEFAULT_EDITOR_PREFERENCES.zoomInEasing,
			zoomOutEasing: DEFAULT_EDITOR_PREFERENCES.zoomOutEasing,
			connectedZoomEasing: DEFAULT_EDITOR_PREFERENCES.connectedZoomEasing,
			showCursor: false,
			loopCursor: DEFAULT_EDITOR_PREFERENCES.loopCursor,
			cursorStyle: DEFAULT_EDITOR_PREFERENCES.cursorStyle,
			cursorSize: DEFAULT_EDITOR_PREFERENCES.cursorSize,
			cursorSmoothing: DEFAULT_EDITOR_PREFERENCES.cursorSmoothing,
			cursorMotionBlur: DEFAULT_EDITOR_PREFERENCES.cursorMotionBlur,
			cursorClickBounce: DEFAULT_EDITOR_PREFERENCES.cursorClickBounce,
			cursorClickBounceDuration: DEFAULT_EDITOR_PREFERENCES.cursorClickBounceDuration,
			cursorSway: DEFAULT_EDITOR_PREFERENCES.cursorSway,
			borderRadius: DEFAULT_EDITOR_PREFERENCES.borderRadius,
			padding: DEFAULT_EDITOR_PREFERENCES.padding,
			frame: DEFAULT_EDITOR_PREFERENCES.frame,
			aspectRatio: "native",
			exportEncodingMode: DEFAULT_EDITOR_PREFERENCES.exportEncodingMode,
			exportBackendPreference: DEFAULT_EDITOR_PREFERENCES.exportBackendPreference,
			exportPipelineModel: DEFAULT_EDITOR_PREFERENCES.exportPipelineModel,
			exportQuality: DEFAULT_EDITOR_PREFERENCES.exportQuality,
			mp4FrameRate: DEFAULT_EDITOR_PREFERENCES.mp4FrameRate,
			exportFormat: "gif",
			gifFrameRate: 30,
			gifLoop: false,
			gifSizePreset: DEFAULT_EDITOR_PREFERENCES.gifSizePreset,
			gifCompressionPreset: DEFAULT_EDITOR_PREFERENCES.gifCompressionPreset,
			webcam: DEFAULT_EDITOR_PREFERENCES.webcam,
			customAspectWidth: "21",
			customAspectHeight: "9",
			customWallpapers: ["data:image/jpeg;base64,abc"],
			autoApplyFreshRecordingAutoZooms:
				DEFAULT_EDITOR_PREFERENCES.autoApplyFreshRecordingAutoZooms,
			whisperExecutablePath: DEFAULT_EDITOR_PREFERENCES.whisperExecutablePath,
			whisperModelPath: DEFAULT_EDITOR_PREFERENCES.whisperModelPath,
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
			aspectRatio: "16:9",
			wallpaper: DEFAULT_EDITOR_PREFERENCES.wallpaper,
			shadowIntensity: DEFAULT_EDITOR_PREFERENCES.shadowIntensity,
			backgroundBlur: DEFAULT_EDITOR_PREFERENCES.backgroundBlur,
			zoomMotionBlur: DEFAULT_EDITOR_PREFERENCES.zoomMotionBlur,
			connectZooms: DEFAULT_EDITOR_PREFERENCES.connectZooms,
			zoomInDurationMs: DEFAULT_EDITOR_PREFERENCES.zoomInDurationMs,
			zoomInOverlapMs: DEFAULT_EDITOR_PREFERENCES.zoomInOverlapMs,
			zoomOutDurationMs: DEFAULT_EDITOR_PREFERENCES.zoomOutDurationMs,
			connectedZoomGapMs: DEFAULT_EDITOR_PREFERENCES.connectedZoomGapMs,
			connectedZoomDurationMs: DEFAULT_EDITOR_PREFERENCES.connectedZoomDurationMs,
			zoomInEasing: DEFAULT_EDITOR_PREFERENCES.zoomInEasing,
			zoomOutEasing: DEFAULT_EDITOR_PREFERENCES.zoomOutEasing,
			connectedZoomEasing: DEFAULT_EDITOR_PREFERENCES.connectedZoomEasing,
			showCursor: DEFAULT_EDITOR_PREFERENCES.showCursor,
			loopCursor: DEFAULT_EDITOR_PREFERENCES.loopCursor,
			cursorStyle: DEFAULT_EDITOR_PREFERENCES.cursorStyle,
			cursorSize: DEFAULT_EDITOR_PREFERENCES.cursorSize,
			cursorSmoothing: DEFAULT_EDITOR_PREFERENCES.cursorSmoothing,
			cursorMotionBlur: DEFAULT_EDITOR_PREFERENCES.cursorMotionBlur,
			cursorClickBounce: DEFAULT_EDITOR_PREFERENCES.cursorClickBounce,
			cursorClickBounceDuration: DEFAULT_EDITOR_PREFERENCES.cursorClickBounceDuration,
			cursorSway: DEFAULT_EDITOR_PREFERENCES.cursorSway,
			borderRadius: DEFAULT_EDITOR_PREFERENCES.borderRadius,
			padding: DEFAULT_EDITOR_PREFERENCES.padding,
			frame: DEFAULT_EDITOR_PREFERENCES.frame,
			exportEncodingMode: DEFAULT_EDITOR_PREFERENCES.exportEncodingMode,
			exportBackendPreference: DEFAULT_EDITOR_PREFERENCES.exportBackendPreference,
			exportPipelineModel: DEFAULT_EDITOR_PREFERENCES.exportPipelineModel,
			exportQuality: DEFAULT_EDITOR_PREFERENCES.exportQuality,
			mp4FrameRate: DEFAULT_EDITOR_PREFERENCES.mp4FrameRate,
			exportFormat: DEFAULT_EDITOR_PREFERENCES.exportFormat,
			gifFrameRate: DEFAULT_EDITOR_PREFERENCES.gifFrameRate,
			gifLoop: DEFAULT_EDITOR_PREFERENCES.gifLoop,
			gifSizePreset: DEFAULT_EDITOR_PREFERENCES.gifSizePreset,
			gifCompressionPreset: DEFAULT_EDITOR_PREFERENCES.gifCompressionPreset,
			webcam: DEFAULT_EDITOR_PREFERENCES.webcam,
			customAspectWidth: "21",
			customAspectHeight: "9",
			customWallpapers: DEFAULT_EDITOR_PREFERENCES.customWallpapers,
			autoApplyFreshRecordingAutoZooms:
				DEFAULT_EDITOR_PREFERENCES.autoApplyFreshRecordingAutoZooms,
			whisperExecutablePath: DEFAULT_EDITOR_PREFERENCES.whisperExecutablePath,
			whisperModelPath: DEFAULT_EDITOR_PREFERENCES.whisperModelPath,
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
			gifCompressionPreset: "compact",
			customAspectWidth: "4",
			customAspectHeight: "5",
			customWallpapers: ["data:image/jpeg;base64,abc", "data:image/jpeg;base64,abc"],
			autoApplyFreshRecordingAutoZooms: false,
		});

		expect(loadEditorPreferences()).toEqual({
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
			gifCompressionPreset: "compact",
			webcam: DEFAULT_EDITOR_PREFERENCES.webcam,
			customAspectWidth: "4",
			customAspectHeight: "5",
			customWallpapers: ["data:image/jpeg;base64,abc"],
			autoApplyFreshRecordingAutoZooms: false,
			whisperExecutablePath: DEFAULT_EDITOR_PREFERENCES.whisperExecutablePath,
			whisperModelPath: DEFAULT_EDITOR_PREFERENCES.whisperModelPath,
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
});
