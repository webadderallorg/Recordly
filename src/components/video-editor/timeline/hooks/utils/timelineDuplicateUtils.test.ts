import { expect, it } from "vitest";
import { placeSpanAfter } from "./timelineDuplicateUtils";

const source = { startMs: 500, endMs: 1500 };

it("places a full-length copy immediately after the original when the lane is free", () => {
	expect(placeSpanAfter(source, 4500)).toEqual({ startMs: 1500, endMs: 2500 });
});

it("finds the first gap that fits without shifting or shortening other items", () => {
	expect(
		placeSpanAfter(source, 6000, [
			{ startMs: 3200, endMs: 4240 },
			source,
			{ startMs: 1700, endMs: 2700 },
		]),
	).toEqual({ startMs: 4240, endMs: 5240 });
});

it("leaves the timeline untouched when the full copy cannot fit", () => {
	expect(placeSpanAfter(source, 2300)).toBeNull();
	expect(placeSpanAfter({ startMs: 500, endMs: 500 }, 4500)).toBeNull();
});
