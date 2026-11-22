import { describe, expect, it } from "vitest";

import {
	getHudInteractiveBounds,
	isPointerOverHudSurface,
	mergeHudInteractiveBounds,
	shouldRestoreHudMousePassthroughAfterDrag,
} from "./hudMousePassthrough";

const hudBounds = { left: 100, top: 200, right: 300, bottom: 260 };

describe("HUD DOM surface collection", () => {
	it("reads live camera and popup rectangles separately and preserves the circular hit shape", () => {
		let cameraLeft = 500;
		const camera = {
			dataset: { floatingWebcamPreview: "" },
			getBoundingClientRect: () => ({
				left: cameraLeft,
				top: 100,
				right: cameraLeft + 230,
				bottom: 330,
			}),
		};
		const popup = { dataset: {}, getBoundingClientRect: () => hudBounds };
		const root = { querySelectorAll: () => [camera, popup] } as unknown as Document;
		const first = getHudInteractiveBounds(root);
		expect(first).toHaveLength(2);
		expect(first[0]).toEqual({
			left: 500,
			top: 100,
			right: 730,
			bottom: 330,
			shape: "ellipse",
		});
		expect(isPointerOverHudSurface(first, 400, 230)).toBe(false);
		expect(isPointerOverHudSurface(first, 295, 255)).toBe(true);
		cameraLeft = 550;
		expect(getHudInteractiveBounds(root)[0].left).toBe(550);
	});
	it("drops exiting and hidden toast cards while retaining the visible card's full bounds", () => {
		const cards = [{}, { hidden: "true" }, { exiting: "true" }].map((dataset) => ({
			dataset,
			getBoundingClientRect: () => hudBounds,
		}));
		const root = { querySelectorAll: () => cards } as unknown as Document;
		const bounds = getHudInteractiveBounds(root);
		expect(bounds).toHaveLength(1);
		expect(isPointerOverHudSurface(bounds, 101, 201)).toBe(true);
		expect(isPointerOverHudSurface(bounds, 301, 201)).toBe(false);
	});
});

describe("visible HUD hit areas", () => {
	it("passes through transparent side areas at the same height as the idle bar", () => {
		expect(isPointerOverHudSurface([hudBounds], 99, 230)).toBe(false);
		expect(isPointerOverHudSurface([hudBounds], 301, 230)).toBe(false);
		expect(isPointerOverHudSurface([hudBounds], 180, 230)).toBe(true);
	});
	it("keeps complete popover and webcam surfaces interactive without filling their gaps", () => {
		const popup = { left: 90, top: 20, right: 400, bottom: 180 };
		const camera = { left: 500, top: 150, right: 730, bottom: 380 };
		expect(isPointerOverHudSurface([hudBounds, popup, camera], 390, 170)).toBe(true);
		expect(isPointerOverHudSurface([hudBounds, popup, camera], 615, 260)).toBe(true);
		expect(isPointerOverHudSurface([hudBounds, popup, camera], 420, 230)).toBe(false);
	});
	it("ignores missing, hidden-sized and invalid layout bounds", () => {
		expect(
			isPointerOverHudSurface(
				[null, undefined, { left: 0, top: 0, right: 0, bottom: 0 }],
				0,
				0,
			),
		).toBe(false);
		expect(isPointerOverHudSurface([{ ...hudBounds, right: Number.NaN }], 180, 230)).toBe(
			false,
		);
	});
	it("passes clicks through the transparent corners around the circular camera", () => {
		const camera = { left: 500, top: 150, right: 730, bottom: 380, shape: "ellipse" as const };
		expect(isPointerOverHudSurface([camera], 501, 151)).toBe(false);
		expect(isPointerOverHudSurface([camera], 615, 265)).toBe(true);
		expect(isPointerOverHudSurface([camera, hudBounds], 180, 230)).toBe(true);
	});
});

describe("mergeHudInteractiveBounds", () => {
	it("returns null when there are no interactive bounds", () => {
		expect(mergeHudInteractiveBounds([null, undefined])).toBeNull();
	});

	it("merges the dropdown, bar, and webcam preview bounds", () => {
		expect(
			mergeHudInteractiveBounds([
				{ left: 120, top: 220, right: 260, bottom: 320 },
				{ left: 100, top: 200, right: 300, bottom: 260 },
				{ left: 140, top: 280, right: 340, bottom: 430 },
			]),
		).toEqual({ left: 100, top: 200, right: 340, bottom: 430 });
	});
});

describe("shouldRestoreHudMousePassthroughAfterDrag", () => {
	it("keeps the HUD interactive when the pointer is still inside the HUD", () => {
		expect(shouldRestoreHudMousePassthroughAfterDrag(hudBounds, 180, 230)).toBe(false);
	});

	it("keeps the HUD interactive when the pointer ends on the HUD edge", () => {
		expect(shouldRestoreHudMousePassthroughAfterDrag(hudBounds, 100, 200)).toBe(false);
		expect(shouldRestoreHudMousePassthroughAfterDrag(hudBounds, 300, 260)).toBe(false);
	});

	it("restores passthrough when the pointer ends outside the HUD", () => {
		expect(shouldRestoreHudMousePassthroughAfterDrag(hudBounds, 99, 230)).toBe(true);
		expect(shouldRestoreHudMousePassthroughAfterDrag(hudBounds, 180, 199)).toBe(true);
		expect(shouldRestoreHudMousePassthroughAfterDrag(hudBounds, 301, 230)).toBe(true);
		expect(shouldRestoreHudMousePassthroughAfterDrag(hudBounds, 180, 261)).toBe(true);
	});

	it("restores passthrough when no HUD bounds are available", () => {
		expect(shouldRestoreHudMousePassthroughAfterDrag(null, 180, 230)).toBe(true);
	});
});
