import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "./projectPersistence";

describe("normalizeProjectEditor fillFrameRegions", () => {
	it("defaults to [] on legacy projects without the field", () => {
		expect(normalizeProjectEditor({}).fillFrameRegions).toEqual([]);
	});

	it("round-trips valid regions", () => {
		const fillFrameRegions = [
			{ id: "fill-frame-1000-2000", startMs: 1000, endMs: 2000 },
			{ id: "fill-frame-5000-9000", startMs: 5000, endMs: 9000 },
		];
		const normalized = normalizeProjectEditor({ fillFrameRegions });
		expect(normalized.fillFrameRegions).toEqual(fillFrameRegions);
		expect(normalizeProjectEditor(normalized).fillFrameRegions).toEqual(fillFrameRegions);
	});

	it("drops malformed regions and overlaps", () => {
		const normalized = normalizeProjectEditor({
			fillFrameRegions: [
				{ id: "b", startMs: 3000, endMs: 6000 },
				{ id: "a", startMs: 1000, endMs: 4000 },
				{ id: 9, startMs: 0, endMs: 100 },
				{ id: "c", startMs: Number.NaN, endMs: 100 },
				{ id: "d", startMs: 200, endMs: 100 },
			] as never,
		});
		expect(normalized.fillFrameRegions).toEqual([{ id: "a", startMs: 1000, endMs: 4000 }]);
	});
});

describe("normalizeProjectEditor fillFrameDefault", () => {
	it("defaults to false and round-trips true", () => {
		expect(normalizeProjectEditor({}).fillFrameDefault).toBe(false);
		expect(normalizeProjectEditor({ fillFrameDefault: true }).fillFrameDefault).toBe(true);
		expect(
			normalizeProjectEditor({ fillFrameDefault: "yes" as never }).fillFrameDefault,
		).toBe(false);
	});
});
