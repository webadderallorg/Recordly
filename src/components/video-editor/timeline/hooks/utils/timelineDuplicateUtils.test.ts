import { describe, expect, it } from "vitest";
import { placeSpanAfter } from "./timelineDuplicateUtils";

describe("placeSpanAfter", () => {
	it("places a copy immediately after the source span", () => {
		expect(placeSpanAfter({ startMs: 1000, endMs: 2000 }, 10_000)).toEqual({
			startMs: 2000,
			endMs: 3000,
		});
	});

	it("clamps to the timeline end when space is partial", () => {
		expect(placeSpanAfter({ startMs: 8000, endMs: 9500 }, 10_000)).toEqual({
			startMs: 9500,
			endMs: 10_000,
		});
	});

	it("returns null when there is no room after the source", () => {
		expect(placeSpanAfter({ startMs: 9000, endMs: 10_000 }, 10_000)).toBeNull();
		expect(placeSpanAfter({ startMs: 0, endMs: 0 }, 10_000)).toBeNull();
		expect(placeSpanAfter({ startMs: 0, endMs: 1000 }, 0)).toBeNull();
	});
});
