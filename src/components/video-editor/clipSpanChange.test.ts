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
