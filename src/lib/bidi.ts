// ---------------------------------------------------------------------------
// Bi-directional (BiDi) & RTL Text Utilities
// ---------------------------------------------------------------------------

/**
 * Regular expression matching Right-to-Left script characters:
 * - Arabic (\u0600-\u06FF, \u0750-\u077F, \u08A0-\u08FF, \uFB50-\uFDFF, \uFE70-\uFEFF)
 * - Hebrew (\u0590-\u05FF, \uFB1D-\uFB4F)
 * - Syriac, Thaana, Samaritan, Mandaic, etc.
 */
const RTL_REGEX =
	/[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;

/**
 * Determines whether the given text contains primary RTL characters.
 */
export function isRtlText(text: string): boolean {
	return RTL_REGEX.test(text);
}

/**
 * Determines the text direction for a given block or phrase: "rtl" or "ltr".
 */
export function detectTextDirection(text: string): "rtl" | "ltr" {
	return isRtlText(text) ? "rtl" : "ltr";
}
