import { describe, expect, it } from "vitest";
import {
	buildMarqueeRect,
	exceedsMarqueeThreshold,
	isMarqueeSelectableKind,
	rectsIntersect,
	resolveMarqueeSelection,
} from "./timelineMarqueeUtils";

describe("timelineMarqueeUtils", () => {
	describe("exceedsMarqueeThreshold", () => {
		it("treats movement within the threshold as a plain click", () => {
			expect(exceedsMarqueeThreshold({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false);
			expect(exceedsMarqueeThreshold({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(false);
		});

		it("treats movement past the threshold as a marquee drag", () => {
			expect(exceedsMarqueeThreshold({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(true);
			expect(exceedsMarqueeThreshold({ x: 10, y: 10 }, { x: 14, y: 14 })).toBe(true);
		});
	});

	describe("buildMarqueeRect", () => {
		it("normalizes a drag in any direction to a positive rect", () => {
			expect(buildMarqueeRect({ x: 30, y: 40 }, { x: 10, y: 20 })).toEqual({
				left: 10,
				top: 20,
				width: 20,
				height: 20,
			});
			expect(buildMarqueeRect({ x: 10, y: 20 }, { x: 30, y: 40 })).toEqual({
				left: 10,
				top: 20,
				width: 20,
				height: 20,
			});
		});
	});

	describe("rectsIntersect", () => {
		const marquee = { left: 10, top: 10, width: 20, height: 20 };

		it("detects overlapping rects", () => {
			expect(rectsIntersect({ left: 25, top: 25, width: 20, height: 20 }, marquee)).toBe(
				true,
			);
			expect(rectsIntersect({ left: 0, top: 0, width: 15, height: 15 }, marquee)).toBe(true);
		});

		it("rejects rects that only touch edges or are disjoint", () => {
			expect(rectsIntersect({ left: 30, top: 10, width: 10, height: 10 }, marquee)).toBe(
				false,
			);
			expect(rectsIntersect({ left: 100, top: 100, width: 5, height: 5 }, marquee)).toBe(
				false,
			);
		});
	});

	describe("isMarqueeSelectableKind", () => {
		it("allows zoom, camera, fillFrame, annotation and speed chips", () => {
			expect(isMarqueeSelectableKind("zoom")).toBe(true);
			expect(isMarqueeSelectableKind("camera")).toBe(true);
			expect(isMarqueeSelectableKind("fillFrame")).toBe(true);
			expect(isMarqueeSelectableKind("annotation")).toBe(true);
			expect(isMarqueeSelectableKind("speed")).toBe(true);
		});

		it("excludes the main clip track and audio waveforms", () => {
			expect(isMarqueeSelectableKind("clip")).toBe(false);
			expect(isMarqueeSelectableKind("audio")).toBe(false);
			expect(isMarqueeSelectableKind("trim")).toBe(false);
			expect(isMarqueeSelectableKind("")).toBe(false);
		});
	});

	describe("resolveMarqueeSelection", () => {
		const marquee = { left: 0, top: 0, width: 100, height: 100 };

		it("selects every selectable chip intersecting the marquee", () => {
			const candidates = [
				{ id: "z-1", kind: "zoom", rect: { left: 10, top: 10, width: 20, height: 10 } },
				{ id: "cam-1", kind: "camera", rect: { left: 50, top: 30, width: 20, height: 10 } },
				{
					id: "ff-1",
					kind: "fillFrame",
					rect: { left: 90, top: 90, width: 20, height: 10 },
				},
				{
					id: "an-1",
					kind: "annotation",
					rect: { left: 200, top: 10, width: 20, height: 10 },
				},
			];
			expect(resolveMarqueeSelection(candidates, marquee)).toEqual([
				{ kind: "zoom", id: "z-1" },
				{ kind: "camera", id: "cam-1" },
				{ kind: "fillFrame", id: "ff-1" },
			]);
		});

		it("filters out clip and audio chips even when they intersect", () => {
			const candidates = [
				{ id: "c-1", kind: "clip", rect: { left: 10, top: 10, width: 20, height: 10 } },
				{ id: "au-1", kind: "audio", rect: { left: 10, top: 30, width: 20, height: 10 } },
				{ id: "z-1", kind: "zoom", rect: { left: 10, top: 50, width: 20, height: 10 } },
			];
			expect(resolveMarqueeSelection(candidates, marquee)).toEqual([
				{ kind: "zoom", id: "z-1" },
			]);
		});

		it("ignores empty and duplicate ids", () => {
			const candidates = [
				{ id: "", kind: "zoom", rect: { left: 10, top: 10, width: 20, height: 10 } },
				{ id: "z-1", kind: "zoom", rect: { left: 10, top: 30, width: 20, height: 10 } },
				{ id: "z-1", kind: "zoom", rect: { left: 10, top: 50, width: 20, height: 10 } },
			];
			expect(resolveMarqueeSelection(candidates, marquee)).toEqual([
				{ kind: "zoom", id: "z-1" },
			]);
		});

		it("returns an empty selection when nothing intersects", () => {
			const candidates = [
				{ id: "z-1", kind: "zoom", rect: { left: 200, top: 200, width: 20, height: 10 } },
			];
			expect(resolveMarqueeSelection(candidates, marquee)).toEqual([]);
		});
	});
});
