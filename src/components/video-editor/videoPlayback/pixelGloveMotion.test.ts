import { describe, expect, it } from "vitest";
import { resolvePixelGlovePose } from "./pixelGloveMotion";

describe("pixel glove click poses", () => {
	it("curls on click and returns to pointing after the press", () => {
		expect(resolvePixelGlovePose("pixel-hand", "arrow", 40, 350, 1)).toBe("closed-hand");
		expect(resolvePixelGlovePose("pixel-hand", "pointer", 120, 350, 1)).toBe("pointer");
		expect(resolvePixelGlovePose("pixel-hand", "arrow", -1, 350, 1)).toBe("arrow");
	});
	it("respects bounce off and leaves other cursor styles alone", () => {
		expect(resolvePixelGlovePose("pixel-hand", "pointer", 40, 350, 0)).toBe("pointer");
		expect(resolvePixelGlovePose("tahoe", "arrow", 40, 350, 1)).toBe("arrow");
	});
	it("preserves text, resize and drag poses while clicking", () => {
		for (const type of ["text", "resize-ew", "open-hand", "closed-hand"] as const) {
			expect(resolvePixelGlovePose("pixel-hand", type, 40, 350, 1)).toBe(type);
		}
	});
});
