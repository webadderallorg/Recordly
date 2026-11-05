import { describe, expect, it } from "vitest";
import { applyCaptionPreset, CAPTION_PRESETS, getCaptionWordColor } from "./captionPresets";
import { normalizeProjectCaptions } from "./projectCaptionsNormalization";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

describe("caption styles", () => {
	it("preserves every style and its customizations when reopening a project", () => {
		for (const preset of CAPTION_PRESETS) {
			const settings = {
				...applyCaptionPreset(DEFAULT_AUTO_CAPTION_SETTINGS, preset.id),
				fontSize: 42,
				bottomOffset: 9,
				maxWidth: 75,
				maxRows: 2,
				backgroundOpacity: 0.4,
				textColor: "#FFAA22",
				enabled: true,
			};
			const editor = JSON.parse(JSON.stringify({ autoCaptionSettings: settings }));
			expect(normalizeProjectCaptions(editor).normalizedAutoCaptionSettings).toEqual(
				settings,
			);
		}
	});

	it("uses Classic for old projects and unknown styles without losing their settings", () => {
		for (const style of [undefined, "unknown"]) {
			const settings = { ...DEFAULT_AUTO_CAPTION_SETTINGS, style, backgroundOpacity: 0.3 };
			const result = normalizeProjectCaptions(
				JSON.parse(JSON.stringify({ autoCaptionSettings: settings })),
			);
			expect(result.normalizedAutoCaptionSettings.style).toBe("classic");
			expect(result.normalizedAutoCaptionSettings.backgroundOpacity).toBe(0.3);
		}
	});

	it("keeps generation, sizing and positioning when applying another style", () => {
		const settings = {
			...DEFAULT_AUTO_CAPTION_SETTINGS,
			enabled: true,
			language: "fr",
			timelineQuickAdd: false,
			fontSize: 45,
			maxWidth: 80,
			maxRows: 3,
			bottomOffset: 8,
		};
		for (const preset of CAPTION_PRESETS) {
			const result = applyCaptionPreset(settings, preset.id);
			for (const key of [
				"enabled",
				"language",
				"timelineQuickAdd",
				"fontSize",
				"maxWidth",
				"maxRows",
				"bottomOffset",
			] as const)
				expect(result[key]).toEqual(settings[key]);
		}
	});

	it("uses readable Karaoke text when there are no acoustic word timings", () => {
		const settings = applyCaptionPreset(DEFAULT_AUTO_CAPTION_SETTINGS, "karaoke");
		expect(getCaptionWordColor(settings, { isHighlighted: false, isInactive: false })).toBe(
			"#FFFFFF",
		);
		expect(getCaptionWordColor(settings, { isHighlighted: true, isInactive: false })).toBe(
			"#142000",
		);
	});
});
