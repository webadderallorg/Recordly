import type { Application } from "pixi.js";
import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import type { PlaybackProps } from "./playbackProps";

const EMPTY_ANNOTATIONS: PlaybackProps["annotationRegions"] = [];

/** Live annotation inputs; crop coordinates come from the applied scene layout. */
export function usePreviewRedactionState(
	{ annotationRegions: regions }: Pick<PlaybackProps, "annotationRegions">,
	appRef: RefObject<Application | null>,
) {
	// Fresh empty defaults are not output edits and must not redraw every frame.
	const annotationRegions = regions.length > 0 ? regions : EMPTY_ANNOTATIONS;
	// Text/image edits and fresh copies of unchanged annotations do not alter
	// private source pixels. Only invalidate a retained decoded frame for masks.
	const privacyKey = useMemo(
		() =>
			JSON.stringify(
				annotationRegions
					.filter((region) => region.type === "blur")
					.map(
						({ startMs, endMs, position, size, zIndex, blurIntensity, blurColor }) => ({
							startMs,
							endMs,
							position: { x: position.x, y: position.y },
							size: { width: size.width, height: size.height },
							zIndex,
							blurIntensity,
							blurColor,
						}),
					),
			),
		[annotationRegions],
	);
	const sourceRedactionRef = useRef({ annotationRegions, privacyKey });
	const updatePreviewTextureRef = useRef<(() => void) | null>(null);
	useLayoutEffect(() => {
		const changed = sourceRedactionRef.current.privacyKey !== privacyKey;
		sourceRedactionRef.current = { annotationRegions, privacyKey };
		// Privacy edits change pixels, never the composed camera pose. This also
		// redraws a paused/suspended preview without advancing any motion springs.
		if (changed && updatePreviewTextureRef.current) {
			updatePreviewTextureRef.current();
			appRef.current?.render();
		}
	}, [annotationRegions, privacyKey, appRef]);
	return { sourceRedactionRef, updatePreviewTextureRef };
}
