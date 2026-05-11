import { describe, expect, it } from "vitest";
import {
	clampDraggedSpanToNeighbours,
	clampRange,
	clampResizedSpanToNeighbours,
	clampSpanToBounds,
	getSiblingSpans,
	resolveDragEnd,
	resolveResizeEnd,
} from "./engine";

const BASE_SPANS = [
	{ id: "a", start: 0, end: 1000, rowId: "row-clip" },
	{ id: "b", start: 1500, end: 2500, rowId: "row-clip" },
	{ id: "c", start: 3000, end: 3600, rowId: "row-clip" },
	{ id: "aud-1", start: 100, end: 500, rowId: "row-audio-0" },
];

describe("timeline dnd engine", () => {
	it("clamps item span to timeline bounds and min duration", () => {
		expect(clampSpanToBounds({ start: -100, end: 20 }, { totalMs: 5000, minItemDurationMs: 100 })).toEqual({ start: 0, end: 120 });
		expect(clampSpanToBounds({ start: 4900, end: 7000 }, { totalMs: 5000, minItemDurationMs: 100 })).toEqual({ start: 2900, end: 5000 });
	});

	it("handles zero-duration timelines in span clamping", () => {
		expect(clampSpanToBounds({ start: -10, end: -5 }, { totalMs: 0, minItemDurationMs: 100 })).toEqual({ start: 0, end: 100 });
		expect(clampSpanToBounds({ start: 50, end: 60 }, { totalMs: 0, minItemDurationMs: 1 })).toEqual({ start: 50, end: 60 });
	});

	it("clamps visible range for bounded and unbounded timelines", () => {
		expect(clampRange({ start: 4900, end: 5200 }, { totalMs: 5000, minVisibleRangeMs: 300 })).toEqual({ start: 4700, end: 5000 });
		expect(clampRange({ start: -20, end: 50 }, { totalMs: 0, minVisibleRangeMs: 300 })).toEqual({ start: 0, end: 300 });
	});

	it("resolves siblings by row and active item", () => {
		expect(getSiblingSpans("b", undefined, BASE_SPANS).map((s) => s.id)).toEqual(["a", "c"]);
		expect(getSiblingSpans("missing", "row-clip", BASE_SPANS).map((s) => s.id)).toEqual(["a", "b", "c"]);
		expect(getSiblingSpans("missing", undefined, BASE_SPANS)).toEqual([]);
	});

	it("clamps resize against nearest neighbours and min duration", () => {
		const resizedRight = clampResizedSpanToNeighbours(
			{ start: 900, end: 2000 },
			"a",
			{ allRegionSpans: BASE_SPANS, minItemDurationMs: 100, totalMs: 5000 },
		);
		expect(resizedRight.end).toBe(1500);

		const resizedLeft = clampResizedSpanToNeighbours(
			{ start: 900, end: 2500 },
			"b",
			{ allRegionSpans: BASE_SPANS, minItemDurationMs: 100, totalMs: 5000 },
		);
		expect(resizedLeft.start).toBe(1000);
	});

	it("keeps drag unchanged when already inside valid neighbour gap", () => {
		const dragged = clampDraggedSpanToNeighbours(
			{ start: 1400, end: 2400 },
			"b",
			"row-clip",
			{ allRegionSpans: BASE_SPANS, minItemDurationMs: 100, totalMs: 5000 },
		);
		expect(dragged).toEqual({ start: 1400, end: 2400 });
	});

	it("clamps drag to previous or next neighbour bounds", () => {
		const toLeftBoundary = clampDraggedSpanToNeighbours(
			{ start: -500, end: 500 },
			"b",
			"row-clip",
			{ allRegionSpans: BASE_SPANS, minItemDurationMs: 100, totalMs: 5000 },
		);
		expect(toLeftBoundary).toEqual({ start: 1000, end: 2000 });

		const toRightBoundary = clampDraggedSpanToNeighbours(
			{ start: 3500, end: 4500 },
			"b",
			"row-clip",
			{ allRegionSpans: BASE_SPANS, minItemDurationMs: 100, totalMs: 5000 },
		);
		expect(toRightBoundary).toEqual({ start: 2000, end: 3000 });
	});

	it("falls back to generic clamping when active drag item is unknown", () => {
		const dragged = clampDraggedSpanToNeighbours(
			{ start: -10, end: 20 },
			"missing",
			"row-clip",
			{ allRegionSpans: BASE_SPANS, minItemDurationMs: 100, totalMs: 5000 },
		);
		expect(dragged).toEqual({ start: 0, end: 100 });
	});

	it("resolves resize end with overlap fallback semantics", () => {
		const result = resolveResizeEnd("a", { start: 900, end: 2200 }, {
			totalMs: 5000,
			minItemDurationMs: 100,
			allRegionSpans: BASE_SPANS,
			hasOverlap: (span, id) => id === "a" && span.end > 1500,
		});
		expect(result).toEqual({ start: 900, end: 1500 });
	});

	it("returns null when resize still overlaps after neighbour clamp", () => {
		const result = resolveResizeEnd("a", { start: 900, end: 2200 }, {
			totalMs: 5000,
			minItemDurationMs: 100,
			allRegionSpans: BASE_SPANS,
			hasOverlap: () => true,
		});
		expect(result).toBeNull();
	});

	it("resolves drag end with row resolver while preserving duration", () => {
		const result = resolveDragEnd(
			"b",
			{ start: 1200, end: 1800 },
			"row-clip",
			{
				allRegionSpans: BASE_SPANS,
				totalMs: 5000,
				minItemDurationMs: 100,
				hasOverlap: () => false,
			},
			(id, rowId) => (id === "b" ? rowId : rowId),
		);
		expect(result).toEqual({ rowId: "row-clip", span: { start: 1200, end: 2200 } });
	});

	it("returns null when drag still overlaps after neighbour clamp", () => {
		const result = resolveDragEnd(
			"b",
			{ start: 1200, end: 1800 },
			"row-clip",
			{
				allRegionSpans: BASE_SPANS,
				totalMs: 5000,
				minItemDurationMs: 100,
				hasOverlap: () => true,
			},
		);
		expect(result).toBeNull();
	});

	it("keeps proposed row when no target row resolver is provided", () => {
		const result = resolveDragEnd(
			"aud-1",
			{ start: 700, end: 1000 },
			"row-audio-2",
			{
				allRegionSpans: BASE_SPANS,
				totalMs: 5000,
				minItemDurationMs: 100,
				hasOverlap: () => false,
			},
		);
		expect(result?.rowId).toBe("row-audio-2");
	});
});
