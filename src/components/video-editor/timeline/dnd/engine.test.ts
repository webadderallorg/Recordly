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
		expect(
			clampSpanToBounds({ start: -100, end: 20 }, { totalMs: 5000, minItemDurationMs: 100 }),
		).toEqual({ start: 0, end: 120 });
		expect(
			clampSpanToBounds(
				{ start: 4900, end: 7000 },
				{ totalMs: 5000, minItemDurationMs: 100 },
			),
		).toEqual({ start: 2900, end: 5000 });
	});

	it("handles zero-duration timelines in span clamping", () => {
		expect(
			clampSpanToBounds({ start: -10, end: -5 }, { totalMs: 0, minItemDurationMs: 100 }),
		).toEqual({ start: 0, end: 100 });
		expect(
			clampSpanToBounds({ start: 50, end: 60 }, { totalMs: 0, minItemDurationMs: 1 }),
		).toEqual({ start: 50, end: 60 });
	});

	it("clamps visible range for bounded and unbounded timelines", () => {
		expect(
			clampRange({ start: 4900, end: 5200 }, { totalMs: 5000, minVisibleRangeMs: 300 }),
		).toEqual({ start: 4700, end: 5000 });
		expect(clampRange({ start: -20, end: 50 }, { totalMs: 0, minVisibleRangeMs: 300 })).toEqual(
			{ start: 0, end: 300 },
		);
	});

	it("resolves siblings by row and active item", () => {
		expect(getSiblingSpans("b", undefined, BASE_SPANS).map((s) => s.id)).toEqual(["a", "c"]);
		expect(getSiblingSpans("missing", "row-clip", BASE_SPANS).map((s) => s.id)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(getSiblingSpans("missing", undefined, BASE_SPANS)).toEqual([]);
	});

	it("clamps resize against nearest neighbours and min duration", () => {
		const resizedRight = clampResizedSpanToNeighbours({ start: 900, end: 2000 }, "a", {
			allRegionSpans: BASE_SPANS,
			minItemDurationMs: 100,
			totalMs: 5000,
		});
		expect(resizedRight.end).toBe(1500);

		const resizedLeft = clampResizedSpanToNeighbours({ start: 900, end: 2500 }, "b", {
			allRegionSpans: BASE_SPANS,
			minItemDurationMs: 100,
			totalMs: 5000,
		});
		expect(resizedLeft.start).toBe(1000);
	});

	it("inserts into a compact sequence even when legacy positions contain gaps", () => {
		expect(
			clampDraggedSpanToNeighbours({ start: 1400, end: 2400 }, "b", "row-clip", {
				allRegionSpans: BASE_SPANS,
				minItemDurationMs: 100,
				totalMs: 5000,
			}),
		).toEqual({ start: 1000, end: 2000, sequenceIndex: 1 });
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
		const result = resolveResizeEnd(
			"aud-1",
			{ start: 100, end: 2200 },
			{
				totalMs: 5000,
				minItemDurationMs: 100,
				allRegionSpans: [
					...BASE_SPANS,
					{ id: "aud-2", rowId: "row-audio-0", start: 1500, end: 2500 },
				],
				hasOverlap: (span) => span.end > 1500,
			},
		);
		expect(result).toEqual({ start: 100, end: 1500 });
	});

	it("returns null when resize still overlaps after neighbour clamp", () => {
		const result = resolveResizeEnd(
			"aud-1",
			{ start: 100, end: 2200 },
			{
				totalMs: 5000,
				minItemDurationMs: 100,
				allRegionSpans: BASE_SPANS,
				hasOverlap: () => true,
			},
		);
		expect(result).toBeNull();
	});

	const sequence = [
		{ id: "a", start: 0, end: 1000, rowId: "row-clip" },
		{ id: "b", start: 1000, end: 2000, rowId: "row-clip" },
		{ id: "c", start: 2000, end: 3000, rowId: "row-clip" },
	];
	const sequenceConfig = {
		allRegionSpans: sequence,
		totalMs: 3000,
		minItemDurationMs: 100,
		hasOverlap: () => true,
	};

	it("inserts A after B without jumping over C", () => {
		const result = resolveDragEnd("a", { start: 1100, end: 2100 }, "row-clip", sequenceConfig);
		expect(result).toEqual({
			rowId: "row-clip",
			span: { start: 1000, end: 2000, sequenceIndex: 1 },
		});
	});

	it("inserts B before A at the start of the sequence", () => {
		const result = resolveDragEnd("b", { start: 0, end: 1000 }, "row-clip", sequenceConfig);
		expect(result).toEqual({
			rowId: "row-clip",
			span: { start: 0, end: 1000, sequenceIndex: 0 },
		});
	});

	it("keeps the final clip in the sequence when dragged beyond its end", () => {
		const result = resolveDragEnd("c", { start: 5200, end: 5800 }, "row-clip", sequenceConfig);
		expect(result).toEqual({
			rowId: "row-clip",
			span: { start: 2000, end: 3000, sequenceIndex: 2 },
		});
	});

	it("inserts a middle clip after the final clip without adding empty time", () => {
		const result = resolveDragEnd("b", { start: 4200, end: 5200 }, "row-clip", sequenceConfig);
		expect(result).toEqual({
			rowId: "row-clip",
			span: { start: 2000, end: 3000, sequenceIndex: 2 },
		});
	});

	it("uses the resolved target row for primary sequence insertion", () => {
		const result = resolveDragEnd(
			"a",
			{ start: 1100, end: 2100 },
			"row-audio-0",
			sequenceConfig,
			() => "row-clip",
		);
		expect(result?.span.sequenceIndex).toBe(1);
	});

	it("allows restoring a trimmed clip into its adjacent clip's old time", () => {
		expect(resolveResizeEnd("a", { start: 0, end: 1500 }, sequenceConfig)).toEqual({
			start: 0,
			end: 1500,
		});
	});

	it("allows restoring the final clip beyond the current sequence end", () => {
		expect(resolveResizeEnd("c", { start: 2000, end: 4000 }, sequenceConfig)).toEqual({
			start: 2000,
			end: 4000,
		});
	});

	it("allows restoring a trimmed first clip before time zero for source-aware repacking", () => {
		expect(resolveResizeEnd("a", { start: -500, end: 1000 }, sequenceConfig)).toEqual({
			start: -500,
			end: 1000,
		});
	});

	it("preserves the stationary edge when a clip trim crosses its minimum duration", () => {
		expect(resolveResizeEnd("b", { start: 1990, end: 2000 }, sequenceConfig)).toEqual({
			start: 1900,
			end: 2000,
		});
		expect(resolveResizeEnd("b", { start: 1000, end: 1010 }, sequenceConfig)).toEqual({
			start: 1000,
			end: 1100,
		});
	});

	it("rejects non-finite clip resize positions", () => {
		expect(resolveResizeEnd("a", { start: NaN, end: 1000 }, sequenceConfig)).toBeNull();
	});

	it("keeps non-clip drags bounded by the current timeline duration", () => {
		const result = resolveDragEnd("aud-1", { start: 5200, end: 5600 }, "row-audio-0", {
			allRegionSpans: BASE_SPANS,
			totalMs: 5000,
			minItemDurationMs: 100,
			hasOverlap: () => false,
		});
		expect(result).toEqual({ rowId: "row-audio-0", span: { start: 4600, end: 5000 } });
	});

	it("returns null when drag still overlaps after neighbour clamp", () => {
		const result = resolveDragEnd("aud-1", { start: 1200, end: 1800 }, "row-audio-0", {
			allRegionSpans: BASE_SPANS,
			totalMs: 5000,
			minItemDurationMs: 100,
			hasOverlap: () => true,
		});
		expect(result).toBeNull();
	});

	it("keeps proposed row when no target row resolver is provided", () => {
		const result = resolveDragEnd("aud-1", { start: 700, end: 1000 }, "row-audio-2", {
			allRegionSpans: BASE_SPANS,
			totalMs: 5000,
			minItemDurationMs: 100,
			hasOverlap: () => false,
		});
		expect(result?.rowId).toBe("row-audio-2");
	});
});
