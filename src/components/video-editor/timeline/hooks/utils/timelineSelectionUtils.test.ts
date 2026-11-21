import { describe, expect, it } from "vitest";
import { resolveDeleteSelectionTarget } from "./timelineSelectionUtils";

describe("timelineSelectionUtils", () => {
	it("treats zoom select-all as a zoom deletion target", () => {
		expect(
			resolveDeleteSelectionTarget({
				hasZoomGroupSelection: true,
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
				hasZoomGroupSelection: false,
				selectedKeyframeId: "kf-1",
				selectedZoomId: "z-1",
			}),
		).toBe("keyframe");
		expect(
			resolveDeleteSelectionTarget({
				hasZoomGroupSelection: false,
				selectedKeyframeId: null,
				selectedZoomId: "z-1",
				selectedClipId: "c-1",
			}),
		).toBe("zoom");
		expect(
			resolveDeleteSelectionTarget({
				hasZoomGroupSelection: false,
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
				hasZoomGroupSelection: false,
				selectedKeyframeId: null,
				selectedZoomId: null,
			}),
		).toBe("none");
	});
});
