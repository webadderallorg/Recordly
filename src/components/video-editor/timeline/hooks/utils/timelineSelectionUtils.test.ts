import { describe, expect, it } from "vitest";
import { resolveDeleteSelectionTarget } from "./timelineSelectionUtils";

describe("timelineSelectionUtils", () => {
	it("prioritizes select-all over any individual selection", () => {
		expect(
			resolveDeleteSelectionTarget({
				selectAllBlocksActive: true,
				selectedKeyframeId: "kf-1",
				selectedZoomId: "z-1",
				selectedClipId: "c-1",
				selectedAnnotationId: "a-1",
				selectedAudioId: "au-1",
			}),
		).toBe("all");
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
