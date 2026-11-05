import type { Application } from "pixi.js";
import { type RefObject, useLayoutEffect, useRef } from "react";
import type { PlaybackProps } from "./playbackProps";

const EMPTY_ANNOTATIONS: PlaybackProps["annotationRegions"] = [];

/** Live annotation inputs; crop coordinates come from the applied scene layout. */
export function usePreviewRedactionState(
	{ annotationRegions: regions }: Pick<PlaybackProps, "annotationRegions">,
	appRef: RefObject<Application | null>,
) {
	// Fresh empty defaults are not output edits and must not redraw every frame.
	const annotationRegions = regions.length > 0 ? regions : EMPTY_ANNOTATIONS;
	const sourceRedactionRef = useRef({ annotationRegions });
	const updatePreviewTextureRef = useRef<(() => void) | null>(null);
	useLayoutEffect(() => {
		sourceRedactionRef.current = { annotationRegions };
		// Privacy edits change pixels, never the composed camera pose. This also
		// redraws a paused/suspended preview without advancing any motion springs.
		if (updatePreviewTextureRef.current) {
			updatePreviewTextureRef.current();
			appRef.current?.render();
		}
	}, [annotationRegions, appRef]);
	return { sourceRedactionRef, updatePreviewTextureRef };
}
