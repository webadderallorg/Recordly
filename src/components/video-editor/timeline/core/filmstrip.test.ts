import { describe, expect, it } from "vitest";
import { filmstripSampleTimes } from "./filmstrip";

describe("filmstrip source sampling", () => {
	it("samples a trimmed and sped-up clip in its original source", () => {
		expect(
			filmstripSampleTimes(
				{ start: 2000, end: 4000 },
				{ start: 10000, end: 14000 },
				{ start: 0, end: 6000 },
				2,
			),
		).toEqual([11000, 13000]);
	});
	it("only decodes the visible portion when zoomed or scrolled", () => {
		expect(
			filmstripSampleTimes(
				{ start: 2000, end: 4000 },
				{ start: 10000, end: 14000 },
				{ start: 3000, end: 4000 },
				2,
			),
		).toEqual([12500, 13500]);
	});
	it("does not sample offscreen or zero-duration clips", () => {
		expect(
			filmstripSampleTimes(
				{ start: 0, end: 1000 },
				{ start: 0, end: 1000 },
				{ start: 2000, end: 3000 },
				10,
			),
		).toEqual([]);
		expect(
			filmstripSampleTimes(
				{ start: 0, end: 0 },
				{ start: 0, end: 1000 },
				{ start: 0, end: 1000 },
				10,
			),
		).toEqual([]);
	});
});
