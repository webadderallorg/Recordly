import { describe, expect, it } from "vitest";
import {
	DEFAULT_EDITOR_PREFERENCES,
	normalizeEditorPreferences,
	serializeEditorPresetSnapshot,
} from "./editorPreferences";
import { normalizeProjectEditor } from "./projectPersistence";
import { DEFAULT_AUTO_CAPTION_SETTINGS, DEFAULT_CROP_REGION } from "./types";
import { DEFAULT_CURSOR_IDLE_HIDE } from "./videoPlayback/cursorIdleVisibility";

const customized = {
	enabled: false,
	idleThresholdMs: 3500,
	fadeDelayMs: 750,
	fadeDurationMs: 500,
	movementTolerancePx: 4,
};

describe("cursor idle settings persistence", () => {
	it("enables idle hiding for new preferences and older projects without the setting", () => {
		expect(DEFAULT_EDITOR_PREFERENCES.cursorIdleHide).toEqual(DEFAULT_CURSOR_IDLE_HIDE);
		expect(normalizeProjectEditor({}).cursorIdleHide).toEqual(DEFAULT_CURSOR_IDLE_HIDE);
		expect(
			normalizeProjectEditor({ cursorIdleHide: { enabled: false, fadeDurationMs: 450 } })
				.cursorIdleHide,
		).toMatchObject({ enabled: false, fadeDelayMs: 500, fadeDurationMs: 450 });
		expect(normalizeEditorPreferences({}).cursorIdleHide.enabled).toBe(true);
	});

	it("preserves a disabled toggle and custom timing through project and preference reloads", () => {
		const project = normalizeProjectEditor({ cursorIdleHide: customized });
		expect(normalizeProjectEditor(JSON.parse(JSON.stringify(project))).cursorIdleHide).toEqual(
			customized,
		);
		const preferences = normalizeEditorPreferences({ cursorIdleHide: customized });
		expect(
			normalizeEditorPreferences(JSON.parse(JSON.stringify(preferences))).cursorIdleHide,
		).toEqual(customized);
	});

	it("sanitizes stored timing and tolerance without discarding an explicit false", () => {
		const raw = {
			enabled: false,
			idleThresholdMs: -10,
			fadeDurationMs: 20000,
			movementTolerancePx: Number.NaN,
		};
		expect(normalizeProjectEditor({ cursorIdleHide: raw }).cursorIdleHide).toEqual({
			enabled: false,
			idleThresholdMs: 500,
			fadeDelayMs: 500,
			fadeDurationMs: 1000,
			movementTolerancePx: 2,
		});
	});

	it("includes the cursor setting in reusable preset snapshots", () => {
		const serialized = serializeEditorPresetSnapshot({
			...DEFAULT_EDITOR_PREFERENCES,
			cursorIdleHide: customized,
			cropRegion: DEFAULT_CROP_REGION,
			autoCaptionSettings: DEFAULT_AUTO_CAPTION_SETTINGS,
		});
		expect(JSON.parse(serialized).cursorIdleHide).toEqual(customized);
	});
});
