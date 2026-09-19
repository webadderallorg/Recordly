import { describe, expect, it } from "vitest";
import {
	resolveDeleteSelectionTarget,
	resolveDuplicateSelectionTarget,
} from "./timelineSelectionUtils";

describe("timelineSelectionUtils", () => {
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

	it("resolves duplicate targets for zoom, annotation, and audio", () => {
		expect(
			resolveDuplicateSelectionTarget({
				selectedZoomId: "z-1",
				selectedAnnotationId: "a-1",
				selectedAudioId: "au-1",
			}),
		).toBe("zoom");
		expect(
			resolveDuplicateSelectionTarget({
				selectedZoomId: null,
				selectedAnnotationId: "a-1",
				selectedAudioId: "au-1",
			}),
		).toBe("annotation");
		expect(
			resolveDuplicateSelectionTarget({
				selectedZoomId: null,
				selectedAnnotationId: null,
				selectedAudioId: "au-1",
			}),
		).toBe("audio");
		expect(
			resolveDuplicateSelectionTarget({
				selectedZoomId: null,
				selectedAnnotationId: null,
				selectedAudioId: null,
			}),
		).toBe("none");
	});
});
