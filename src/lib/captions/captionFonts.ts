export const CAPTION_FONT_IDS = [
	"inter",
	"montserrat",
	"poppins",
	"roboto",
	"league-spartan",
	"oswald",
	"bebas-neue",
	"anton",
] as const;

export type CaptionFontId = (typeof CAPTION_FONT_IDS)[number];

export interface CaptionFontDefinition {
	id: CaptionFontId;
	label: string;
	/** CSS family stack; the first family is bundled via `captionFontFaces.ts`. */
	cssFamily: string;
	/** Weights the bundled files provide; others would be synthesized by the browser. */
	weights: readonly number[];
}

const VARIABLE_WEIGHTS = [400, 500, 600, 700, 800, 900] as const;
const FALLBACK_STACK = "Arial, Helvetica, sans-serif";

export const CAPTION_FONTS: Record<CaptionFontId, CaptionFontDefinition> = {
	inter: {
		id: "inter",
		label: "Inter",
		cssFamily: `"Inter Variable", ${FALLBACK_STACK}`,
		weights: VARIABLE_WEIGHTS,
	},
	montserrat: {
		id: "montserrat",
		label: "Montserrat",
		cssFamily: `"Montserrat Variable", ${FALLBACK_STACK}`,
		weights: VARIABLE_WEIGHTS,
	},
	poppins: {
		id: "poppins",
		label: "Poppins",
		cssFamily: `"Poppins", ${FALLBACK_STACK}`,
		weights: [400, 600, 700, 800, 900],
	},
	roboto: {
		id: "roboto",
		label: "Roboto",
		cssFamily: `"Roboto Variable", ${FALLBACK_STACK}`,
		weights: VARIABLE_WEIGHTS,
	},
	"league-spartan": {
		id: "league-spartan",
		label: "League Spartan",
		cssFamily: `"League Spartan Variable", ${FALLBACK_STACK}`,
		weights: VARIABLE_WEIGHTS,
	},
	oswald: {
		id: "oswald",
		label: "Oswald",
		cssFamily: `"Oswald Variable", ${FALLBACK_STACK}`,
		weights: [400, 500, 600, 700],
	},
	"bebas-neue": {
		id: "bebas-neue",
		label: "Bebas Neue",
		cssFamily: `"Bebas Neue", ${FALLBACK_STACK}`,
		weights: [400],
	},
	anton: {
		id: "anton",
		label: "Anton",
		cssFamily: `"Anton", ${FALLBACK_STACK}`,
		weights: [400],
	},
};

export const DEFAULT_CAPTION_FONT_ID: CaptionFontId = "inter";

export function isCaptionFontId(value: unknown): value is CaptionFontId {
	return typeof value === "string" && (CAPTION_FONT_IDS as readonly string[]).includes(value);
}

/** Closest weight the font actually ships, so canvas and CSS never synthesize bold. */
export function resolveCaptionFontWeight(fontId: CaptionFontId, requestedWeight: number): number {
	const { weights } = CAPTION_FONTS[fontId];
	return weights.reduce((best, weight) =>
		Math.abs(weight - requestedWeight) < Math.abs(best - requestedWeight) ? weight : best,
	);
}

export function buildCaptionFontString(options: {
	fontId: CaptionFontId;
	weight: number;
	fontSizePx: number;
}): string {
	const weight = resolveCaptionFontWeight(options.fontId, options.weight);
	return `${weight} ${options.fontSizePx}px ${CAPTION_FONTS[options.fontId].cssFamily}`;
}

/**
 * Canvas text silently falls back to another face when a web font has not loaded yet,
 * so renderers await this before measuring or drawing captions.
 */
export async function ensureCaptionFontLoaded(fontString: string): Promise<void> {
	if (typeof document === "undefined" || !document.fonts?.load) {
		return;
	}
	try {
		await document.fonts.load(fontString);
	} catch (error) {
		console.warn(`[captionFonts] Failed to load caption font "${fontString}":`, error);
	}
}
