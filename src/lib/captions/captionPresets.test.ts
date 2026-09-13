import { describe, expect, it } from "vitest";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "@/components/video-editor/types";
import {
	applyCaptionPreset,
	CAPTION_PRESET_IDS,
	findMatchingCaptionPreset,
} from "./captionPresets";
import { normalizeAutoCaptionSettings } from "./captionSettings";

describe("caption style presets", () => {
	it.each(CAPTION_PRESET_IDS)("%s survives settings normalization unchanged", (presetId) => {
		const applied = applyCaptionPreset(DEFAULT_AUTO_CAPTION_SETTINGS, presetId);

		expect(normalizeAutoCaptionSettings(applied)).toEqual(applied);
	});

	it("keeps language, size and placement when applying a preset", () => {
		const settings = {
			...DEFAULT_AUTO_CAPTION_SETTINGS,
			language: "es",
			fontSize: 48,
			verticalPosition: "top" as const,
		};

		const applied = applyCaptionPreset(settings, "karaoke-pop");

		expect(applied).toMatchObject({ language: "es", fontSize: 48, verticalPosition: "top" });
		expect(applied.highlightMode).toBe("pop");
	});

	it("recognizes the preset a style came from and stops matching after a manual tweak", () => {
		const applied = applyCaptionPreset(DEFAULT_AUTO_CAPTION_SETTINGS, "headline");

		expect(findMatchingCaptionPreset(applied)).toBe("headline");
		expect(findMatchingCaptionPreset({ ...applied, outlineWidth: 7 })).toBeNull();
	});

	it("matches the default settings to the classic preset", () => {
		expect(findMatchingCaptionPreset(DEFAULT_AUTO_CAPTION_SETTINGS)).toBe("classic");
	});
});
