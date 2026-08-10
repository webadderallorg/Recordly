import { describe, expect, it } from "vitest";

import {
	mergeHudInteractiveBounds,
	shouldRestoreHudMousePassthrough,
	shouldRestoreHudMousePassthroughAfterDrag,
} from "./hudMousePassthrough";

const hudBounds = { left: 100, top: 200, right: 300, bottom: 260 };

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

describe("shouldRestoreHudMousePassthrough", () => {
	it("restores passthrough as soon as the pointer leaves idle HUD content", () => {
		expect(
			shouldRestoreHudMousePassthrough({
				isMouseOverHud: false,
				popoverOpen: false,
				isHudDragging: false,
				isWebcamPreviewDragging: false,
				webcamPreviewPointerDown: false,
			}),
		).toBe(true);
	});

	it("keeps the HUD interactive while the pointer or another HUD interaction is active", () => {
		const idleState = {
			isMouseOverHud: false,
			popoverOpen: false,
			isHudDragging: false,
			isWebcamPreviewDragging: false,
			webcamPreviewPointerDown: false,
		};

		for (const activeState of [
			{ isMouseOverHud: true },
			{ popoverOpen: true },
			{ isHudDragging: true },
			{ isWebcamPreviewDragging: true },
			{ webcamPreviewPointerDown: true },
		]) {
			expect(shouldRestoreHudMousePassthrough({ ...idleState, ...activeState })).toBe(false);
		}
	});
});
