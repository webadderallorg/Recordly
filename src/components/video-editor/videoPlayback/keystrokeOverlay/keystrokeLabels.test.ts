import { describe, expect, it } from "vitest";
import { keystrokeLabels } from "./keystrokeLabels";

describe("keystrokeLabels", () => {
	it("renders meta+c as command glyph then C", () => {
		expect(keystrokeLabels("c", ["meta"])).toEqual(["⌘", "C"]);
	});

	it("renders ctrl+c as Ctrl then C", () => {
		expect(keystrokeLabels("c", ["ctrl"])).toEqual(["Ctrl", "C"]);
	});

	it("renders enter as Enter", () => {
		expect(keystrokeLabels("enter", [])).toEqual(["Enter"]);
	});

	it("renders named punctuation as a glyph", () => {
		expect(keystrokeLabels("period", [])).toEqual(["."]);
	});
});
