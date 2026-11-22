import { useTimelineContext } from "dnd-timeline";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { DndEngineConfig } from "../dnd/engine";
import { type ClipPresentation, getClipDisplaySpan } from "./clipPresentation";
import { CLIP_ROW_ID } from "./constants";
import type { TimelineRegionSpan } from "./timelineTypes";
import { getZoomPresentationTiming, type ZoomPresentationTiming } from "./zoomPresentation";

type PreviewConfig = Pick<
	DndEngineConfig,
	"totalMs" | "minItemDurationMs" | "allRegionSpans" | "hasOverlap"
>;
const Context = createContext<{
	clips: ClipPresentation[];
	regions: TimelineRegionSpan[];
	previewConfig: PreviewConfig;
	zoomTiming: ZoomPresentationTiming;
}>({
	clips: [],
	regions: [],
	zoomTiming: getZoomPresentationTiming(),
	previewConfig: {
		totalMs: 0,
		minItemDurationMs: 1,
		allRegionSpans: [],
		hasOverlap: () => false,
	},
});
export const useTimelinePresentation = () => useContext(Context);
export function TimelinePresentation({
	regions,
	children,
	totalMs,
	minItemDurationMs,
	hasOverlap,
	zoomTiming,
}: {
	regions: TimelineRegionSpan[];
	children: ReactNode;
	zoomTiming: ZoomPresentationTiming;
} & Omit<PreviewConfig, "allRegionSpans">) {
	const { pixelsToValue } = useTimelineContext();
	const value = useMemo(() => {
		const spans = regions
			.filter((region) => region.rowId === CLIP_ROW_ID)
			.map(({ start, end }) => ({ start, end }));
		return {
			regions,
			zoomTiming,
			previewConfig: { totalMs, minItemDurationMs, hasOverlap, allRegionSpans: regions },
			clips: spans.map((span) => ({
				span,
				displaySpan: getClipDisplaySpan(span, spans, pixelsToValue(1)),
			})),
		};
	}, [regions, pixelsToValue, totalMs, minItemDurationMs, hasOverlap, zoomTiming]);
	return <Context.Provider value={value}>{children}</Context.Provider>;
}
