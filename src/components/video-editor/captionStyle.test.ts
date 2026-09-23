import { describe, expect, it } from "vitest";
import { getCaptionAnchorPosition, getCaptionScaledFontSize } from "./captionStyle";

describe("getCaptionAnchorPosition", () => {
	it("maps caption percentages to frame coordinates", () => {
		expect(getCaptionAnchorPosition({ positionX: 25, positionY: 75 }, 1920, 1080, 100)).toEqual(
			{ x: 480, y: 760 },
		);
	});
});

describe("getCaptionScaledFontSize", () => {
	it("scales proportionally between a compact preview and full-size export", () => {
		const preview = getCaptionScaledFontSize(30, 270, 62);
		const exported = getCaptionScaledFontSize(30, 1080, 62);

		expect(exported / preview).toBe(4);
	});

	it("keeps font size independent from the caption max-width control", () => {
		expect(getCaptionScaledFontSize(30, 1080, 40)).toBe(getCaptionScaledFontSize(30, 1080, 95));
	});
});
