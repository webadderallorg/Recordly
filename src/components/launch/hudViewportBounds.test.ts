import { describe, expect, it } from "vitest";

import { clampHudOffsetToViewport } from "./hudViewportBounds";

describe("clampHudOffsetToViewport", () => {
	it("moves a dragged HUD back onscreen after the recording window becomes compact", () => {
		expect(
			clampHudOffsetToViewport(
				{ x: -463, y: -710 },
				{ left: -244, top: -656, right: 179, bottom: -586 },
				{ width: 860, height: 160 },
			),
		).toEqual({ x: -219, y: -54 });
	});

	it("leaves an already visible HUD unchanged", () => {
		expect(
			clampHudOffsetToViewport(
				{ x: 12, y: -8 },
				{ left: 218, top: 54, right: 641, bottom: 124 },
				{ width: 860, height: 160 },
			),
		).toEqual({ x: 12, y: -8 });
	});

	it("clamps the right and bottom edges after a viewport shrink", () => {
		expect(
			clampHudOffsetToViewport(
				{ x: 500, y: 200 },
				{ left: 700, top: 140, right: 1120, bottom: 210 },
				{ width: 860, height: 160 },
			),
		).toEqual({ x: 240, y: 150 });
	});
});
