import {
	type AutoCaptionAnimation,
	type AutoCaptionSettings,
	type CaptionAccentRule,
	type CaptionHighlightMode,
	type CaptionHorizontalAlign,
	type CaptionVerticalPosition,
	DEFAULT_AUTO_CAPTION_SETTINGS as DEFAULTS,
} from "@/components/video-editor/types";
import { isCaptionFontId } from "./captionFonts";

const ANIMATIONS: readonly AutoCaptionAnimation[] = ["none", "fade", "rise", "pop"];
const VERTICAL_POSITIONS: readonly CaptionVerticalPosition[] = ["top", "middle", "bottom"];
const HORIZONTAL_ALIGNS: readonly CaptionHorizontalAlign[] = ["left", "center", "right"];
const HIGHLIGHT_MODES: readonly CaptionHighlightMode[] = ["none", "color", "pill", "pop"];
const ACCENT_RULES: readonly CaptionAccentRule[] = ["none", "first-word", "longest-word"];

type RawSettings = Partial<Record<keyof AutoCaptionSettings, unknown>>;

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(range.max, Math.max(range.min, value));
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function pickNonEmptyString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeTypography(raw: RawSettings) {
	return {
		fontId: isCaptionFontId(raw.fontId) ? raw.fontId : DEFAULTS.fontId,
		fontWeight: Math.round(
			clampNumber(raw.fontWeight, { min: 100, max: 900 }, DEFAULTS.fontWeight),
		),
		fontSize: clampNumber(raw.fontSize, { min: 16, max: 72 }, DEFAULTS.fontSize),
		uppercase: pickBoolean(raw.uppercase, DEFAULTS.uppercase),
		textColor: pickNonEmptyString(raw.textColor, DEFAULTS.textColor),
		outlineWidth: clampNumber(raw.outlineWidth, { min: 0, max: 12 }, DEFAULTS.outlineWidth),
		outlineColor: pickNonEmptyString(raw.outlineColor, DEFAULTS.outlineColor),
		shadowOpacity: clampNumber(raw.shadowOpacity, { min: 0, max: 1 }, DEFAULTS.shadowOpacity),
	};
}

function normalizeLayout(raw: RawSettings) {
	return {
		verticalPosition: pickEnum(
			raw.verticalPosition,
			VERTICAL_POSITIONS,
			DEFAULTS.verticalPosition,
		),
		horizontalAlign: pickEnum(raw.horizontalAlign, HORIZONTAL_ALIGNS, DEFAULTS.horizontalAlign),
		bottomOffset: clampNumber(raw.bottomOffset, { min: 0, max: 30 }, DEFAULTS.bottomOffset),
		maxWidth: clampNumber(raw.maxWidth, { min: 40, max: 95 }, DEFAULTS.maxWidth),
		maxRows: Math.round(clampNumber(raw.maxRows, { min: 1, max: 4 }, DEFAULTS.maxRows)),
		boxRadius: clampNumber(raw.boxRadius, { min: 0, max: 40 }, DEFAULTS.boxRadius),
		backgroundOpacity: clampNumber(
			raw.backgroundOpacity,
			{ min: 0, max: 1 },
			DEFAULTS.backgroundOpacity,
		),
	};
}

/** Validates caption settings read from projects or presets, filling gaps with defaults. */
export function normalizeAutoCaptionSettings(value: unknown): AutoCaptionSettings {
	const raw: RawSettings = value && typeof value === "object" ? (value as RawSettings) : {};

	return {
		enabled: pickBoolean(raw.enabled, DEFAULTS.enabled),
		timelineQuickAdd: pickBoolean(raw.timelineQuickAdd, DEFAULTS.timelineQuickAdd),
		language: pickNonEmptyString(raw.language, DEFAULTS.language),
		...normalizeTypography(raw),
		...normalizeLayout(raw),
		animationStyle: pickEnum(raw.animationStyle, ANIMATIONS, DEFAULTS.animationStyle),
		highlightMode: pickEnum(raw.highlightMode, HIGHLIGHT_MODES, DEFAULTS.highlightMode),
		highlightColor: pickNonEmptyString(raw.highlightColor, DEFAULTS.highlightColor),
		emphasisColor: pickNonEmptyString(raw.emphasisColor, DEFAULTS.emphasisColor),
		accentRule: pickEnum(raw.accentRule, ACCENT_RULES, DEFAULTS.accentRule),
	};
}
