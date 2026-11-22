import { expect, it, vi } from "vitest";
import { useTimelineNormalization } from "./useTimelineNormalization";

vi.mock("react", () => ({ useEffect: (effect: () => void) => effect() }));

it("does not expand short zoom fragments beyond the footage retained by a ripple edit", () => {
	const onZoomSpanChange = vi.fn();
	useTimelineNormalization({
		totalMs: 3000,
		safeMinDurationMs: 100,
		zoomRegions: [
			{ id: "zoom-1", startMs: 980, endMs: 1000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			{
				id: "zoom-1-part-1",
				startMs: 2000,
				endMs: 2020,
				depth: 2,
				focus: { cx: 0.5, cy: 0.5 },
			},
		],
		trimRegions: [],
		speedRegions: [],
		audioRegions: [],
		onZoomSpanChange,
	});
	expect(onZoomSpanChange).not.toHaveBeenCalled();
});

it("still clamps zoom fragments to the timeline and repairs empty spans", () => {
	const onZoomSpanChange = vi.fn();
	useTimelineNormalization({
		totalMs: 3000,
		safeMinDurationMs: 100,
		zoomRegions: [
			{ id: "past-end", startMs: 2990, endMs: 3010, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			{ id: "empty", startMs: 1000, endMs: 1000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
		],
		trimRegions: [],
		speedRegions: [],
		audioRegions: [],
		onZoomSpanChange,
	});
	expect(onZoomSpanChange.mock.calls).toEqual([
		["past-end", { start: 2980, end: 3000 }],
		["empty", { start: 1000, end: 1100 }],
	]);
});
