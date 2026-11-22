import { describe, expect, it } from "vitest";
import { ENCODED_H264_COLOR_SPACE_FALLBACK, EXPORT_CANVAS_COLOR_SPACE } from "./videoColorSpace";

describe("export colour metadata", () => {
	it("does not confuse full-range RGB input with encoded YUV output", () => {
		expect(EXPORT_CANVAS_COLOR_SPACE).toMatchObject({ matrix: "rgb", fullRange: true });
		expect(ENCODED_H264_COLOR_SPACE_FALLBACK).toMatchObject({
			matrix: "bt709",
			transfer: "bt709",
			fullRange: false,
		});
	});
});
