import { describe, expect, it } from "vitest";
import { getZoomIdsInRange, resolveDeleteSelectionTarget } from "./timelineSelectionUtils";

describe("timelineSelectionUtils", () => {
	it("treats zooms picked with a selection box as a zoom deletion target", () => {
		expect(
			resolveDeleteSelectionTarget({
				selectAllBlocksActive: false,
				selectedZoomIds: ["z-1", "z-2"],
				selectedKeyframeId: "kf-1",
				selectedZoomId: null,
				selectedClipId: "c-1",
			}),
		).toBe("zoom");
	});

	it("picks the zooms a selection box overlaps in either drag direction", () => {
		const zooms = [
			{ id: "a", span: { start: 0, end: 1000 } },
			{ id: "b", span: { start: 2000, end: 3000 } },
			{ id: "c", span: { start: 4000, end: 5000 } },
		];
		expect(getZoomIdsInRange(zooms, 900, 2100)).toEqual(["a", "b"]);
		expect(getZoomIdsInRange(zooms, 4500, 1500)).toEqual(["b", "c"]);
		expect(getZoomIdsInRange(zooms, 1000, 2000)).toEqual([]);
	});

	it("treats zoom select-all as a zoom deletion target", () => {
		expect(
			resolveDeleteSelectionTarget({
				selectAllBlocksActive: true,
				selectedKeyframeId: "kf-1",
				selectedZoomId: "z-1",
				selectedClipId: "c-1",
				selectedAnnotationId: "a-1",
				selectedAudioId: "au-1",
			}),
		).toBe("zoom");
	});

	it("follows selection priority order", () => {
		expect(
			resolveDeleteSelectionTarget({
				selectAllBlocksActive: false,
				selectedKeyframeId: "kf-1",
				selectedZoomId: "z-1",
			}),
		).toBe("keyframe");
		expect(
			resolveDeleteSelectionTarget({
				selectAllBlocksActive: false,
				selectedKeyframeId: null,
				selectedZoomId: "z-1",
				selectedClipId: "c-1",
			}),
		).toBe("zoom");
		expect(
			resolveDeleteSelectionTarget({
				selectAllBlocksActive: false,
				selectedKeyframeId: null,
				selectedZoomId: null,
				selectedClipId: "c-1",
				selectedAnnotationId: "a-1",
			}),
		).toBe("clip");
	});

	it("returns none when nothing is selected", () => {
		expect(
			resolveDeleteSelectionTarget({
				selectAllBlocksActive: false,
				selectedKeyframeId: null,
				selectedZoomId: null,
			}),
		).toBe("none");
	});
});
