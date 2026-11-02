import { describe, expect, it } from "vitest";
import { compareEncodedColorDescription } from "./encodedColorDescription.mjs";

const TAGS = { primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "tv" };

describe("compareEncodedColorDescription", () => {
	it("verifies a stream that carries the intended description", () => {
		const result = compareEncodedColorDescription(
			{
				color_primaries: "bt709",
				color_transfer: "bt709",
				color_space: "bt709",
				color_range: "tv",
			},
			TAGS,
		);
		expect(result.verified).toBe(true);
		expect(result.reason).toBeNull();
		expect(result.actual).toEqual(TAGS);
	});

	it("reports the mislabelled HEVC SPS that produced the purple cast", () => {
		// What the union clobber actually produced: full range plus a reserved
		// (out-of-range) primaries value, while transfer/matrix survived.
		const result = compareEncodedColorDescription(
			{
				color_primaries: "reserved",
				color_transfer: "bt709",
				color_space: "bt709",
				color_range: "pc",
			},
			TAGS,
		);
		expect(result.verified).toBe(false);
		expect(result.reason).toContain("primaries=reserved (expected bt709)");
		expect(result.reason).toContain("range=pc (expected tv)");
		expect(result.reason).not.toContain("transfer");
		expect(result.reason).not.toContain("matrix");
	});

	it("treats an untagged stream as unverified rather than assuming", () => {
		const result = compareEncodedColorDescription({}, TAGS);
		expect(result.verified).toBe(false);
		expect(result.reason).toContain("primaries=unknown");
		expect(result.reason).toContain("range=unknown");
	});

	it("treats a missing video stream as unverified", () => {
		const result = compareEncodedColorDescription(null, TAGS);
		expect(result.verified).toBe(false);
		expect(result.reason).toBe("no-video-stream");
		expect(result.actual).toBeNull();
	});

	it("detects a range-only mismatch", () => {
		const result = compareEncodedColorDescription(
			{
				color_primaries: "bt709",
				color_transfer: "bt709",
				color_space: "bt709",
				color_range: "pc",
			},
			TAGS,
		);
		expect(result.verified).toBe(false);
		expect(result.reason).toBe("range=pc (expected tv)");
	});
});
