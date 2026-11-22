import { describe, expect, it } from "vitest";
import {
	applyCaptionPreset,
	CAPTION_PRESETS,
	CAPTION_STYLE_OPTIONS,
	getCaptionWordColor,
} from "./captionPresets";
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

	it("preserves pre-style projects and uses Reveal for unknown styles without losing customizations", () => {
		for (const style of [undefined, "unknown"]) {
			const settings = { ...DEFAULT_AUTO_CAPTION_SETTINGS, style, backgroundOpacity: 0.3 };
			const result = normalizeProjectCaptions(
				JSON.parse(JSON.stringify({ autoCaptionSettings: settings })),
			);
			expect(result.normalizedAutoCaptionSettings.style).toBe(
				style === undefined ? "classic" : "reveal",
			);
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

it("offers only Reveal and Classic, with Reveal as the complete new-recording default", () => {
	expect(CAPTION_STYLE_OPTIONS.map((preset) => [preset.id, preset.label])).toEqual([
		["reveal", "Reveal"],
		["serif", "Classic"],
	]);
	expect(DEFAULT_AUTO_CAPTION_SETTINGS).toEqual(
		applyCaptionPreset(DEFAULT_AUTO_CAPTION_SETTINGS, "reveal"),
	);
	expect(normalizeProjectCaptions({}).normalizedAutoCaptionSettings).toEqual(
		DEFAULT_AUTO_CAPTION_SETTINGS,
	);
});
