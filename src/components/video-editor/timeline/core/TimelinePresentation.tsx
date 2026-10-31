import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useTimelineContext } from "dnd-timeline";
import { CLIP_ROW_ID } from "./constants";
import { getClipDisplaySpan, type ClipPresentation } from "./clipPresentation";
import type { DndEngineConfig } from "../dnd/engine";
import type { TimelineRegionSpan } from "./timelineTypes";

type PreviewConfig = Pick<
	DndEngineConfig,
	"totalMs" | "minItemDurationMs" | "allRegionSpans" | "hasOverlap"
>;
const Context = createContext<{
	clips: ClipPresentation[];
	regions: TimelineRegionSpan[];
	previewConfig: PreviewConfig;
}>({
	clips: [],
	regions: [],
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
}: { regions: TimelineRegionSpan[]; children: ReactNode } & Omit<PreviewConfig, "allRegionSpans">) {
	const { pixelsToValue } = useTimelineContext();
	const value = useMemo(() => {
		const spans = regions
			.filter((region) => region.rowId === CLIP_ROW_ID)
			.map(({ start, end }) => ({ start, end }));
		return {
			regions,
			previewConfig: { totalMs, minItemDurationMs, hasOverlap, allRegionSpans: regions },
			clips: spans.map((span) => ({
				span,
				displaySpan: getClipDisplaySpan(span, spans, pixelsToValue(1)),
			})),
		};
	}, [regions, pixelsToValue, totalMs, minItemDurationMs, hasOverlap]);
	return <Context.Provider value={value}>{children}</Context.Provider>;
}
