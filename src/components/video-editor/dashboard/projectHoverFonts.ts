import type { AnnotationRegion } from "../types";

/** Load every text face used during the five-second hover, including later overlays. */
export async function preloadProjectHoverFonts(
	annotations: readonly AnnotationRegion[],
	fonts: Pick<FontFaceSet, "load"> | undefined,
) {
	if (!fonts) return;
	const textByFont = new Map<string, string>();
	for (const annotation of annotations) {
		if (annotation.type !== "text" || annotation.startMs >= 5000 || annotation.endMs <= 0)
			continue;
		const { fontStyle, fontWeight, fontFamily } = annotation.style;
		const descriptor = `${fontStyle} ${fontWeight} 16px ${fontFamily}`;
		textByFont.set(descriptor, `${textByFont.get(descriptor) ?? ""}${annotation.content}`);
	}
	await Promise.all(
		Array.from(textByFont, ([descriptor, text]) => fonts.load(descriptor, text || " ")),
	);
}
