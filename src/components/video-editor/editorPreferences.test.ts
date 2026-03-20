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
			showCursor: false,
			loopCursor: DEFAULT_EDITOR_PREFERENCES.loopCursor,
			cursorSize: DEFAULT_EDITOR_PREFERENCES.cursorSize,
			cursorSmoothing: DEFAULT_EDITOR_PREFERENCES.cursorSmoothing,
			cursorMotionBlur: DEFAULT_EDITOR_PREFERENCES.cursorMotionBlur,
			cursorClickBounce: DEFAULT_EDITOR_PREFERENCES.cursorClickBounce,
			cursorClickBounceDuration: DEFAULT_EDITOR_PREFERENCES.cursorClickBounceDuration,
			cursorSway: DEFAULT_EDITOR_PREFERENCES.cursorSway,
			borderRadius: DEFAULT_EDITOR_PREFERENCES.borderRadius,
			padding: DEFAULT_EDITOR_PREFERENCES.padding,
			aspectRatio: "native",
			exportQuality: DEFAULT_EDITOR_PREFERENCES.exportQuality,
			exportFormat: "gif",
			gifFrameRate: 30,
			gifLoop: false,
			gifSizePreset: DEFAULT_EDITOR_PREFERENCES.gifSizePreset,
			webcam: DEFAULT_EDITOR_PREFERENCES.webcam,
			customAspectWidth: "21",
			customAspectHeight: "9",
			customWallpapers: ["data:image/jpeg;base64,abc"],
		});
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
			showCursor: DEFAULT_EDITOR_PREFERENCES.showCursor,
			loopCursor: DEFAULT_EDITOR_PREFERENCES.loopCursor,
			cursorSize: DEFAULT_EDITOR_PREFERENCES.cursorSize,
			cursorSmoothing: DEFAULT_EDITOR_PREFERENCES.cursorSmoothing,
			cursorMotionBlur: DEFAULT_EDITOR_PREFERENCES.cursorMotionBlur,
			cursorClickBounce: DEFAULT_EDITOR_PREFERENCES.cursorClickBounce,
			cursorClickBounceDuration: DEFAULT_EDITOR_PREFERENCES.cursorClickBounceDuration,
			cursorSway: DEFAULT_EDITOR_PREFERENCES.cursorSway,
			borderRadius: DEFAULT_EDITOR_PREFERENCES.borderRadius,
			padding: DEFAULT_EDITOR_PREFERENCES.padding,
			exportQuality: DEFAULT_EDITOR_PREFERENCES.exportQuality,
			exportFormat: DEFAULT_EDITOR_PREFERENCES.exportFormat,
			gifFrameRate: DEFAULT_EDITOR_PREFERENCES.gifFrameRate,
			gifLoop: DEFAULT_EDITOR_PREFERENCES.gifLoop,
			gifSizePreset: DEFAULT_EDITOR_PREFERENCES.gifSizePreset,
			webcam: DEFAULT_EDITOR_PREFERENCES.webcam,
			customAspectWidth: "21",
			customAspectHeight: "9",
			customWallpapers: DEFAULT_EDITOR_PREFERENCES.customWallpapers,
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
			showCursor: false,
			loopCursor: true,
			cursorSize: 3,
			cursorSmoothing: 1.25,
			cursorMotionBlur: 0.5,
			cursorClickBounce: 2.25,
			cursorClickBounceDuration: 350,
			cursorSway: 1.5,
			borderRadius: 18,
			padding: 30,
			aspectRatio: "4:5",
			exportQuality: "source",
			exportFormat: "gif",
			gifFrameRate: 20,
			gifLoop: false,
			gifSizePreset: "large",
			customAspectWidth: "4",
			customAspectHeight: "5",
			customWallpapers: ["data:image/jpeg;base64,abc", "data:image/jpeg;base64,abc"],
		});

		expect(loadEditorPreferences()).toEqual({
			wallpaper: "linear-gradient(to right, #000000, #ffffff)",
			shadowIntensity: 0.4,
			backgroundBlur: 1.5,
			zoomMotionBlur: 0.75,
			connectZooms: false,
			showCursor: false,
			loopCursor: true,
			cursorSize: 3,
			cursorSmoothing: 1.25,
			cursorMotionBlur: 0.5,
			cursorClickBounce: 2.25,
			cursorClickBounceDuration: 350,
			cursorSway: 1.5,
			borderRadius: 18,
			padding: 30,
			aspectRatio: "4:5",
			exportQuality: "source",
			exportFormat: "gif",
			gifFrameRate: 20,
			gifLoop: false,
			gifSizePreset: "large",
			webcam: DEFAULT_EDITOR_PREFERENCES.webcam,
			customAspectWidth: "4",
			customAspectHeight: "5",
			customWallpapers: ["data:image/jpeg;base64,abc"],
		});
	});
});
