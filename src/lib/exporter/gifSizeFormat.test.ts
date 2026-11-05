import { describe, expect, it } from "vitest";
import { formatGifBytes } from "./gifSizeFormat";

describe("GIF sizes", () => {
	it.each([
		[0, "0 B"],
		[523, "523 B"],
		[1024, "1.0 KB"],
		[3 * 1024 ** 2, "3.0 MB"],
		[18 * 1024 ** 3, "18.0 GB"],
		[2 * 1024 ** 4, "2.0 TB"],
	] as const)("formats %i bytes", (bytes, label) => {
		expect(formatGifBytes(bytes)).toBe(label);
	});
	it("does not display invalid or negative numbers", () => {
		for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(formatGifBytes(value)).toBe("0 B");
	});
});
