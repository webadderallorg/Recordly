import {
	type CaptionRgb,
	compositeCaptionColor,
	parseCaptionColor,
	readableCaptionColor,
} from "./captionContrast";
import { CAPTION_FONT_WEIGHT, CAPTION_WORD_HIGHLIGHT } from "./captionStyle";
import type { AutoCaptionSettings, AutoCaptionStyle } from "./types";

interface CaptionPreset {
	id: AutoCaptionStyle;
	label: string;
	fontWeight: number;
	uppercase?: boolean;
	revealWords?: boolean;
	fontFamily?: string;
	borderEm?: number;
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
		id: "reveal",
		label: "Reveal",
		fontWeight: 400,
		revealWords: true,
		highlightFill: null,
		outlineEm: 0,
		settings: {
			textColor: "#FFFFFF",
			inactiveTextColor: "#FFFFFF",
			backgroundOpacity: 1,
			boxRadius: 8,
			animationStyle: "none",
		},
	},
	{
		// A distinct ID preserves the former Classic rendering in saved projects.
		id: "serif",
		label: "Classic",
		fontWeight: 400,
		revealWords: true,
		fontFamily: '"Times New Roman", Times, serif',
		borderEm: 0.1,
		highlightFill: null,
		outlineEm: 0,
		backgroundRgb: "255, 255, 255",
		settings: {
			textColor: "#181818",
			inactiveTextColor: "#181818",
			backgroundOpacity: 1,
			boxRadius: 8,
			animationStyle: "none",
		},
	},
	{
		id: "tiktok",
		label: "TikTok",
		fontWeight: 800,
		uppercase: true,
		highlightFill: "#FFE600",
		highlightTextColor: "#161616",
		outlineEm: 0.14,
		settings: {
			textColor: "#FFFFFF",
			inactiveTextColor: "#FFFFFF",
			backgroundOpacity: 0.78,
			boxRadius: 12,
			animationStyle: "none",
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
	return (
		CAPTION_PRESETS.find((preset) => preset.id === style) ??
		CAPTION_PRESETS.find((preset) => preset.id === "reveal")!
	);
}

/** Only these styles are offered for new captions; saved legacy styles still render. */
export const CAPTION_STYLE_OPTIONS = [getCaptionPreset("reveal"), getCaptionPreset("serif")];

/** Apply display casing before measuring and drawing, preserving editable source text. */
export function getCaptionDisplayText(text: string, style: unknown) {
	return getCaptionPreset(style).uppercase ? text.toUpperCase() : text;
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
	// An opaque highlight provides its own contrast; keep its dark lettering crisp.
	if (highlight?.alpha === 1) return 0;
	return (
		preset.outlineEm || (settings.backgroundOpacity < 0.65 && highlight?.alpha !== 1 ? 0.1 : 0)
	);
}

export function drawCaptionBoxBorder(
	ctx: CanvasRenderingContext2D,
	style: unknown,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
	fontSize: number,
) {
	const border = (getCaptionPreset(style).borderEm ?? 0) * fontSize;
	if (!border) return;
	ctx.save();
	ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
	ctx.lineWidth = border;
	ctx.beginPath();
	ctx.roundRect(
		x + border / 2,
		y + border / 2,
		Math.max(0, width - border),
		Math.max(0, height - border),
		Math.max(0, radius - border / 2),
	);
	ctx.stroke();
	ctx.restore();
}
