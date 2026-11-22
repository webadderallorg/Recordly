import { describe, expect, it } from "vitest";
import { changeClipSpan } from "./clipSpanChange";

describe("clip span changes", () => {
	const clip = { id: "clip", startMs: 1000, endMs: 4000, sourceStartMs: 3000, speed: 3 };
	it("moves footage without changing its source window", () => {
		expect(changeClipSpan(clip, 2000, 5000, 12000)).toEqual({
			...clip,
			startMs: 2000,
			endMs: 5000,
		});
	});
	it("advances the source in-point by the trimmed duration times speed", () => {
		expect(changeClipSpan(clip, 2000, 4000, 12000)).toEqual({
			...clip,
			startMs: 2000,
			sourceStartMs: 6000,
		});
	});
	it("does not extend beyond source EOF after a move", () => {
		const moved = changeClipSpan(clip, 2000, 5000, 12000);
		expect(changeClipSpan(moved, 2000, 6000, 12000)).toEqual(moved);
	});
	it("does not extend a moved clip before its source starts", () => {
		const moved = { ...clip, startMs: 2000, endMs: 6000, sourceStartMs: 0 };
		expect(changeClipSpan(moved, 1000, 6000, 12000)).toEqual(moved);
	});
});

it("does not reveal a neighboring recording when extending an imported clip", () => {
	const clip = {
		id: "imported",
		startMs: 0,
		endMs: 2000,
		sourceStartMs: 10000,
		sourceMinMs: 10000,
		sourceMaxMs: 12000,
		speed: 1,
	};
	expect(changeClipSpan(clip, -500, 2000, 20000)).toEqual(clip);
	expect(changeClipSpan(clip, 0, 2500, 20000)).toEqual(clip);
});

it.each([0, -1, NaN, Infinity])("uses normal speed when resizing corrupt speed %s", (speed) => {
	const result = changeClipSpan(
		{ id: "bad", startMs: 0, endMs: 3000, sourceStartMs: 0, speed },
		1000,
		3000,
		5000,
	);
	expect(result).toMatchObject({ startMs: 1000, endMs: 3000, sourceStartMs: 1000 });
});
