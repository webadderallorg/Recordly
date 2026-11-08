import tikTokSansUrl from "@/assets/fonts/tiktok-sans/TikTokSans-Variable.ttf?url";
import { type AutoCaptionSettings, getDefaultCaptionFontFamily } from "./types";

type CaptionFontSettings = Pick<AutoCaptionSettings, "style" | "fontFamily">;

export const TIKTOK_CAPTION_FONT_NAME = "TikTok Sans";

export function getCaptionFontFamily(
	settings?: CaptionFontSettings,
	fallback = getDefaultCaptionFontFamily(),
) {
	// Older TikTok presets saved the system font in fontFamily. The selected style
	// still owns its typeface, so those projects also receive the real bundled font.
	return settings?.style === "tiktok"
		? `"${TIKTOK_CAPTION_FONT_NAME}", ${fallback}`
		: settings?.fontFamily || fallback;
}

let tikTokFontReady: Promise<void> | undefined;

/** Await before measuring/rasterizing TikTok captions; no runtime network font request. */
export function ensureCaptionFontLoaded(settings?: CaptionFontSettings): Promise<void> {
	if (settings?.style !== "tiktok") return Promise.resolve();
	if (tikTokFontReady) return tikTokFontReady;
	if (typeof document === "undefined" || typeof FontFace === "undefined" || !document.fonts) {
		return Promise.reject(new Error("TikTok Sans requires browser font loading support"));
	}
	const fonts = document.fonts;
	tikTokFontReady = (async () => {
		const face = new FontFace(TIKTOK_CAPTION_FONT_NAME, `url("${tikTokSansUrl}")`, {
			style: "normal",
			weight: "300 900",
		});
		const loaded = await face.load();
		fonts.add(loaded);
		// FontFace.load resolves only once the bundled font has decoded; adding that
		// loaded face makes it available to DOM and both canvas export renderers.
	})().catch((error: unknown) => {
		// A temporary asset-loading failure must be retryable on the next attempt.
		tikTokFontReady = undefined;
		throw error;
	});
	return tikTokFontReady;
}
