import type { AutoCaptionSettings } from "@/components/video-editor/types";

/** Visual fields a preset controls; language, timing and layout limits stay the user's. */
export type CaptionStyleFields = Pick<
	AutoCaptionSettings,
	| "fontId"
	| "fontWeight"
	| "uppercase"
	| "textColor"
	| "outlineWidth"
	| "outlineColor"
	| "shadowOpacity"
	| "backgroundOpacity"
	| "boxRadius"
	| "highlightMode"
	| "highlightColor"
	| "emphasisColor"
	| "accentRule"
	| "animationStyle"
>;

export const CAPTION_PRESET_IDS = [
	"classic",
	"karaoke-pop",
	"karaoke-pill",
	"bold-outline",
	"headline",
	"minimal",
] as const;

export type CaptionPresetId = (typeof CAPTION_PRESET_IDS)[number];

export interface CaptionStylePreset {
	id: CaptionPresetId;
	label: string;
	style: CaptionStyleFields;
}

const NO_OUTLINE = { outlineWidth: 0, outlineColor: "#000000" } as const;

export const CAPTION_STYLE_PRESETS: Record<CaptionPresetId, CaptionStylePreset> = {
	classic: {
		id: "classic",
		label: "Classic",
		style: {
			fontId: "inter",
			fontWeight: 600,
			uppercase: false,
			textColor: "#FFFFFF",
			...NO_OUTLINE,
			shadowOpacity: 0,
			backgroundOpacity: 0.9,
			boxRadius: 17.5,
			highlightMode: "color",
			highlightColor: "#FACC15",
			emphasisColor: "#FB923C",
			accentRule: "none",
			animationStyle: "fade",
		},
	},
	"karaoke-pop": {
		id: "karaoke-pop",
		label: "Karaoke pop",
		style: {
			fontId: "league-spartan",
			fontWeight: 900,
			uppercase: false,
			textColor: "#FFFFFF",
			outlineWidth: 3,
			outlineColor: "#000000",
			shadowOpacity: 0.55,
			backgroundOpacity: 0,
			boxRadius: 0,
			highlightMode: "pop",
			highlightColor: "#FFD400",
			emphasisColor: "#FFD400",
			accentRule: "none",
			animationStyle: "pop",
		},
	},
	"karaoke-pill": {
		id: "karaoke-pill",
		label: "Karaoke pill",
		style: {
			fontId: "inter",
			fontWeight: 800,
			uppercase: false,
			textColor: "#FFFFFF",
			outlineWidth: 2,
			outlineColor: "#000000",
			shadowOpacity: 0.3,
			backgroundOpacity: 0,
			boxRadius: 0,
			highlightMode: "pill",
			highlightColor: "#22C55E",
			emphasisColor: "#86EFAC",
			accentRule: "none",
			animationStyle: "fade",
		},
	},
	"bold-outline": {
		id: "bold-outline",
		label: "Bold outline",
		style: {
			fontId: "montserrat",
			fontWeight: 800,
			uppercase: true,
			textColor: "#FFFFFF",
			outlineWidth: 4,
			outlineColor: "#000000",
			shadowOpacity: 0.6,
			backgroundOpacity: 0,
			boxRadius: 0,
			highlightMode: "none",
			highlightColor: "#FACC15",
			emphasisColor: "#FACC15",
			accentRule: "longest-word",
			animationStyle: "rise",
		},
	},
	headline: {
		id: "headline",
		label: "Headline",
		style: {
			fontId: "anton",
			fontWeight: 400,
			uppercase: true,
			textColor: "#FFFFFF",
			outlineWidth: 2,
			outlineColor: "#000000",
			shadowOpacity: 0.8,
			backgroundOpacity: 0,
			boxRadius: 0,
			highlightMode: "color",
			highlightColor: "#FACC15",
			emphasisColor: "#F87171",
			accentRule: "first-word",
			animationStyle: "pop",
		},
	},
	minimal: {
		id: "minimal",
		label: "Minimal",
		style: {
			fontId: "inter",
			fontWeight: 500,
			uppercase: false,
			textColor: "#FFFFFF",
			...NO_OUTLINE,
			shadowOpacity: 0.7,
			backgroundOpacity: 0,
			boxRadius: 0,
			highlightMode: "none",
			highlightColor: "#FACC15",
			emphasisColor: "#FACC15",
			accentRule: "none",
			animationStyle: "fade",
		},
	},
};

export function applyCaptionPreset(
	settings: AutoCaptionSettings,
	presetId: CaptionPresetId,
): AutoCaptionSettings {
	return { ...settings, ...CAPTION_STYLE_PRESETS[presetId].style };
}

/** The preset whose visual fields all match the settings, if any. */
export function findMatchingCaptionPreset(settings: AutoCaptionSettings): CaptionPresetId | null {
	const match = CAPTION_PRESET_IDS.find((id) =>
		Object.entries(CAPTION_STYLE_PRESETS[id].style).every(
			([key, value]) => settings[key as keyof CaptionStyleFields] === value,
		),
	);
	return match ?? null;
}
