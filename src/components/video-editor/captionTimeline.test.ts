import { describe, expect, it } from "vitest";
import { captionSpanToSource, projectCaptionCues, retimeCaptionFragment } from "./captionTimeline";

const clips = [
	{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 3 },
	{ id: "b", startMs: 2000, endMs: 3000, sourceStartMs: 6000, speed: 3 },
];
describe("caption timeline projection", () => {
	it("omits deleted captions and splits crossing cues around gaps with distinct identities", () => {
		const fragments = projectCaptionCues(
			[
				{ id: "deleted", startMs: 3100, endMs: 5900, text: "gone" },
				{ id: "crossing", startMs: 1500, endMs: 7500, text: "kept" },
			],
			clips,
		);
		expect(
			fragments.map(({ sourceCueId, startMs, endMs }) => ({ sourceCueId, startMs, endMs })),
		).toEqual([
			{ sourceCueId: "crossing", startMs: 500, endMs: 1000 },
			{ sourceCueId: "crossing", startMs: 2000, endMs: 2500 },
		]);
		expect(new Set(fragments.map(({ id }) => id)).size).toBe(2);
	});
	it("projects reused footage at every timeline position", () => {
		const cue = { id: "cue", startMs: 0, endMs: 1500, text: "hello" };
		const fragments = projectCaptionCues([cue], [clips[0], { ...clips[1], sourceStartMs: 0 }]);
		expect(fragments.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
			[0, 500],
			[2000, 2500],
		]);
		expect(projectCaptionCues([cue], [])).toEqual([]);
	});
	it("retimes within the selected clip even at its cut boundary", () => {
		expect(captionSpanToSource(clips[0], { start: 500, end: 1000 })).toEqual({
			startMs: 1500,
			endMs: 3000,
		});
		expect(captionSpanToSource(clips[1], { start: 2000, end: 4000 })).toEqual({
			startMs: 6000,
			endMs: 9000,
		});
	});
	it("preserves the other fragment when resizing one edge of a crossing cue", () => {
		const fragments = projectCaptionCues(
			[{ id: "cue", startMs: 1500, endMs: 7500, text: "hello" }],
			clips,
		);
		expect(retimeCaptionFragment(fragments[0], { start: 600, end: 1000 })).toEqual({
			startMs: 1800,
			endMs: 7500,
		});
		expect(retimeCaptionFragment(fragments[1], { start: 2000, end: 2600 })).toEqual({
			startMs: 1500,
			endMs: 7800,
		});
	});
});
