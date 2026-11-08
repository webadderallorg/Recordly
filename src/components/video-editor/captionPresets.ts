import type { AutoCaptionSettings, AutoCaptionStyle } from "./types";
import {
	type CaptionRgb,
	compositeCaptionColor,
	parseCaptionColor,
	readableCaptionColor,
} from "./captionContrast";
import { CAPTION_FONT_WEIGHT, CAPTION_WORD_HIGHLIGHT } from "./captionStyle";

interface CaptionPreset {
	id: AutoCaptionStyle;
	label: string;
	fontWeight: number;
	highlightFill: string | null;
	highlightTextColor?: string;
	outlineEm: number;
	backgroundRgb?: string;
	settings: Pick<
		AutoCaptionSettings,
		"textColor" | "inactiveTextColor" | "backgroundOpacity" | "boxRadius" | "animationStyle"
	>;
}

/** Shared by DOM preview, canvas export, and the style picker. No font downloads. */
export const CAPTION_PRESETS: readonly CaptionPreset[] = [
	{
		id: "classic",
		label: "Classic",
		fontWeight: CAPTION_FONT_WEIGHT,
		highlightFill: CAPTION_WORD_HIGHLIGHT.fill,
		outlineEm: 0,
		settings: {
			textColor: "#FFFFFF",
			inactiveTextColor: "#E5E7EB",
			backgroundOpacity: 0.7,
			boxRadius: 40,
			animationStyle: "fade",
		},
	},
	{
		id: "tiktok",
		label: "TikTok",
		fontWeight: 800,
		highlightFill: null,
		outlineEm: 0.12,
		settings: {
			textColor: "#FFE600",
			inactiveTextColor: "#FFFFFF",
			backgroundOpacity: 0,
			boxRadius: 0,
			animationStyle: "pop",
		},
	},
	{
		id: "karaoke",
		label: "Karaoke",
		fontWeight: 700,
		highlightFill: "#B9FF43",
		highlightTextColor: "#142000",
		outlineEm: 0,
		settings: {
			textColor: "#FFFFFF",
			inactiveTextColor: "#FFFFFF",
			backgroundOpacity: 0.7,
			boxRadius: 12,
			animationStyle: "pop",
		},
	},
	{
		id: "minimal",
		label: "Minimal",
		fontWeight: 500,
		highlightFill: null,
		outlineEm: 0.1,
		settings: {
			textColor: "#FFFFFF",
			inactiveTextColor: "#FFFFFF",
			backgroundOpacity: 0,
			boxRadius: 0,
			animationStyle: "fade",
		},
	},
	{
		id: "neon",
		label: "Neon",
		fontWeight: 700,
		highlightFill: "#55206F",
		outlineEm: 0,
		settings: {
			textColor: "#65FFFF",
			inactiveTextColor: "#FFFFFF",
			backgroundOpacity: 0.7,
			boxRadius: 12,
			animationStyle: "rise",
		},
	},
	{
		id: "paper",
		label: "Paper",
		fontWeight: 600,
		highlightFill: "#FFE59A",
		outlineEm: 0,
		backgroundRgb: "255, 251, 235",
		settings: {
			textColor: "#1F2937",
			inactiveTextColor: "#4B5563",
			backgroundOpacity: 0.94,
			boxRadius: 12,
			animationStyle: "fade",
		},
	},
];

export function getCaptionPreset(style: unknown): CaptionPreset {
	return CAPTION_PRESETS.find((preset) => preset.id === style) ?? CAPTION_PRESETS[0];
}

export function getCaptionBackground(settings: AutoCaptionSettings) {
	return `rgba(${getCaptionPreset(settings.style).backgroundRgb ?? "0, 0, 0"}, ${settings.backgroundOpacity})`;
}

export function applyCaptionPreset(
	settings: AutoCaptionSettings,
	style: AutoCaptionStyle,
): AutoCaptionSettings {
	const preset = getCaptionPreset(style);
	return { ...settings, ...preset.settings, style: preset.id };
}

export function getCaptionWordColor(
	settings: AutoCaptionSettings,
	visual: { isHighlighted: boolean; isInactive: boolean },
) {
	const preset = getCaptionPreset(settings.style);
	const requested =
		visual.isHighlighted && preset.highlightTextColor
			? preset.highlightTextColor
			: visual.isInactive
				? settings.inactiveTextColor
				: settings.textColor;
	if (getCaptionWordOutline(settings, visual) > 0)
		return readableCaptionColor(requested, [[0, 0, 0]]);
	const rgb = (preset.backgroundRgb ?? "0, 0, 0").split(",").map(Number) as unknown as CaptionRgb;
	let backgrounds = [
		[0, 0, 0],
		[255, 255, 255],
	].map((behind) =>
		compositeCaptionColor(
			{ rgb, alpha: settings.backgroundOpacity },
			behind as unknown as CaptionRgb,
		),
	);
	const highlight = visual.isHighlighted ? parseCaptionColor(preset.highlightFill) : null;
	if (highlight)
		backgrounds = backgrounds.map((behind) => compositeCaptionColor(highlight, behind));
	return readableCaptionColor(requested, backgrounds);
}

/** A dark outline also protects text when the video is its only backdrop. */
export function getCaptionWordOutline(
	settings: AutoCaptionSettings,
	visual: { isHighlighted: boolean },
) {
	const preset = getCaptionPreset(settings.style);
	const highlight = visual.isHighlighted ? parseCaptionColor(preset.highlightFill) : null;
	return (
		preset.outlineEm || (settings.backgroundOpacity < 0.65 && highlight?.alpha !== 1 ? 0.1 : 0)
	);
}
