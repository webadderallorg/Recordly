import { useEffect, useState } from "react";
import { ensureCaptionFontLoaded, getCaptionFontFamily } from "./captionFonts";
import type { AutoCaptionSettings } from "./types";

export function useCaptionFont(settings?: Pick<AutoCaptionSettings, "style" | "fontFamily">) {
	const fontFamily = getCaptionFontFamily(settings);
	const needsBundledFont = settings?.style === "tiktok";
	const [readyFamily, setReadyFamily] = useState<string | null>(null);
	useEffect(() => {
		if (!needsBundledFont) return;
		let active = true;
		void ensureCaptionFontLoaded({ style: "tiktok", fontFamily })
			.then(() => {
				if (active) setReadyFamily(fontFamily);
			})
			.catch((error: unknown) => console.warn("Unable to load bundled caption font", error));
		return () => {
			active = false;
		};
	}, [fontFamily, needsBundledFont]);
	return { fontFamily, ready: !needsBundledFont || readyFamily === fontFamily };
}
