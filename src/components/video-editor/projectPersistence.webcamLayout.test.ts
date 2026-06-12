import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "./projectPersistence";

describe("normalizeProjectEditor magnetEnabled", () => {
	it("defaults to true when absent", () => {
		expect(normalizeProjectEditor({}).magnetEnabled).toBe(true);
	});

	it("round-trips false", () => {
		expect(normalizeProjectEditor({ magnetEnabled: false }).magnetEnabled).toBe(false);
	});

	it("round-trips true", () => {
		expect(normalizeProjectEditor({ magnetEnabled: true }).magnetEnabled).toBe(true);
	});

	it("coerces non-boolean to true", () => {
		expect(normalizeProjectEditor({ magnetEnabled: "yes" as never }).magnetEnabled).toBe(true);
	});
});

describe("normalizeProjectEditor webcam layout regions", () => {
	it("normalizes webcam layout regions with defaults", () => {
		const normalized = normalizeProjectEditor({});
		expect(normalized.webcamLayoutRegions).toEqual([]);
		expect(normalized.webcamLayoutRegionsEnabled).toBe(true);

		const withRegions = normalizeProjectEditor({
			webcamLayoutRegions: [
				{ id: "a", startMs: 1000, endMs: 2000 },
				{ id: "bad", startMs: 5, endMs: 5 },
			],
			webcamLayoutRegionsEnabled: false,
		});
		expect(withRegions.webcamLayoutRegions).toEqual([{ id: "a", startMs: 1000, endMs: 2000 }]);
		expect(withRegions.webcamLayoutRegionsEnabled).toBe(false);
	});

	it("normalizes webcam layout style", () => {
		expect(normalizeProjectEditor({}).webcamLayoutStyle).toBe("fit");
		expect(normalizeProjectEditor({ webcamLayoutStyle: "fill" }).webcamLayoutStyle).toBe(
			"fill",
		);
		expect(
			normalizeProjectEditor({ webcamLayoutStyle: "junk" as never }).webcamLayoutStyle,
		).toBe("fit");
	});
});
