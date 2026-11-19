import { describe, expect, it } from "vitest";
import {
	type CaptionRgb,
	captionContrastRatio,
	compositeCaptionColor,
	parseCaptionColor,
} from "./captionContrast";
import {
	applyCaptionPreset,
	CAPTION_PRESETS,
	getCaptionWordColor,
	getCaptionWordOutline,
} from "./captionPresets";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

describe("caption contrast", () => {
	it("uses linear-light relative luminance", () => {
		expect(captionContrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
		expect(captionContrastRatio([100, 100, 100], [100, 100, 100])).toBe(1);
	});

	it.each(
		CAPTION_PRESETS,
	)("keeps $label foreground readable on bright, dark and colored footage", (preset) => {
		const settings = applyCaptionPreset(DEFAULT_AUTO_CAPTION_SETTINGS, preset.id);
		for (const state of [
			{ isHighlighted: true, isInactive: false },
			{ isHighlighted: false, isInactive: true },
			{ isHighlighted: false, isInactive: false },
		]) {
			const text = parseCaptionColor(getCaptionWordColor(settings, state))!;
			for (const footage of [
				[0, 0, 0],
				[255, 255, 255],
				[255, 0, 0],
				[0, 255, 0],
				[0, 0, 255],
			] as CaptionRgb[]) {
				const rgb = (preset.backgroundRgb ?? "0, 0, 0")
					.split(",")
					.map(Number) as unknown as CaptionRgb;
				let surface = compositeCaptionColor(
					{ rgb, alpha: settings.backgroundOpacity },
					footage,
				);
				const highlight = state.isHighlighted
					? parseCaptionColor(preset.highlightFill)
					: null;
				if (highlight) surface = compositeCaptionColor(highlight, surface);
				if (getCaptionWordOutline(settings, state)) surface = [0, 0, 0];
				expect(
					captionContrastRatio(text.rgb, surface),
					`${preset.id} ${JSON.stringify(state)}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("repairs low contrast colors in existing projects and protects transparent backgrounds", () => {
		const classic = {
			...applyCaptionPreset(DEFAULT_AUTO_CAPTION_SETTINGS, "classic"),
			inactiveTextColor: "#A3A3A3",
		};
		expect(getCaptionWordColor(classic, { isHighlighted: false, isInactive: true })).toBe(
			"#FFFFFF",
		);
		const paper = { ...applyCaptionPreset(classic, "paper"), textColor: "#FFFFFF" };
		expect(getCaptionWordColor(paper, { isHighlighted: false, isInactive: false })).toBe(
			"#000000",
		);
		const transparent = { ...classic, backgroundOpacity: 0, textColor: "#000000" };
		expect(getCaptionWordColor(transparent, { isHighlighted: false, isInactive: false })).toBe(
			"#FFFFFF",
		);
		expect(getCaptionWordOutline(transparent, { isHighlighted: false })).toBeGreaterThan(0);
	});
});
