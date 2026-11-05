import { describe, expect, it } from "vitest";
import { computeCursorFollowFocus, createCursorFollowCameraState } from "./cursorFollowCamera";

describe("computeCursorFollowFocus", () => {
	it("follows projected cursor movement inside the crop", () => {
		const state = createCursorFollowCameraState();
		const config = {
			snapToEdgesRatio: 0.25,
			sourceCrop: { x: 0.5, y: 0.2, width: 0.5, height: 0.6 },
		};
		const samples = [
			{ timeMs: 0, cx: 0.75, cy: 0.5 },
			{ timeMs: 100, cx: 0.85, cy: 0.62 },
		];
		computeCursorFollowFocus(state, samples, 0, 2, 1, { cx: 0.5, cy: 0.5 }, config);
		const focus = computeCursorFollowFocus(
			state,
			samples,
			100,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			config,
		);
		expect(focus.cx).toBeCloseTo(0.7);
		expect(focus.cy).toBeCloseTo(0.7);
	});

	it("holds the camera when the cursor moves outside the crop and follows on reentry", () => {
		const state = createCursorFollowCameraState();
		const config = {
			snapToEdgesRatio: 0.25,
			sourceCrop: { x: 0.5, y: 0, width: 0.5, height: 1 },
		};
		const samples = [
			{ timeMs: 0, cx: 0.75, cy: 0.5 },
			{ timeMs: 100, cx: 0.1, cy: 0.5 },
			{ timeMs: 200, cx: 0.85, cy: 0.5 },
		];
		computeCursorFollowFocus(state, samples, 0, 2, 1, { cx: 0.5, cy: 0.5 }, config);
		expect(
			computeCursorFollowFocus(state, samples, 100, 2, 1, { cx: 0.5, cy: 0.5 }, config),
		).toEqual({ cx: 0.5, cy: 0.5 });
		expect(
			computeCursorFollowFocus(state, samples, 200, 2, 1, { cx: 0.5, cy: 0.5 }, config).cx,
		).toBeCloseTo(0.7);
	});

	it("discards frozen viewport focus when the crop changes during zoom-out", () => {
		const state = createCursorFollowCameraState();
		const samples = [{ timeMs: 0, cx: 0.6, cy: 0.5 }];
		computeCursorFollowFocus(state, samples, 0, 5, 1, { cx: 0.6, cy: 0.5 });
		const focus = computeCursorFollowFocus(
			state,
			samples,
			100,
			5,
			0.5,
			{ cx: 0.2, cy: 0.5 },
			{ snapToEdgesRatio: 0.25, sourceCrop: { x: 0.5, y: 0, width: 0.5, height: 1 } },
		);
		expect(focus.cx).toBeCloseTo(0.2);
	});

	it("holds the camera while the cursor stays inside the safe zone", () => {
		const state = createCursorFollowCameraState();
		const cursorSamples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" as const },
			{ timeMs: 100, cx: 0.6, cy: 0.58, interactionType: "move" as const },
		];

		const initialFocus = computeCursorFollowFocus(
			state,
			cursorSamples,
			0,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);
		const heldFocus = computeCursorFollowFocus(
			state,
			cursorSamples,
			100,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		expect(initialFocus).toEqual({ cx: 0.5, cy: 0.5 });
		expect(heldFocus).toEqual(initialFocus);
	});

	it("recenters the cursor after it leaves the safe zone", () => {
		const state = createCursorFollowCameraState();
		const cursorSamples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" as const },
			{ timeMs: 100, cx: 0.7, cy: 0.5, interactionType: "move" as const },
			{ timeMs: 200, cx: 0.72, cy: 0.5, interactionType: "move" as const },
		];

		computeCursorFollowFocus(
			state,
			cursorSamples,
			0,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		const firstShift = computeCursorFollowFocus(
			state,
			cursorSamples,
			100,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);
		const secondShift = computeCursorFollowFocus(
			state,
			cursorSamples,
			200,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		expect(firstShift.cx).toBeCloseTo(0.7, 6);
		expect(firstShift.cy).toBeCloseTo(0.5, 6);
		expect(secondShift.cx).toBeCloseTo(0.7, 6);
		expect(secondShift.cy).toBeCloseTo(0.5, 6);
	});

	it("clamps the camera when the cursor pushes past the stage edge", () => {
		const state = createCursorFollowCameraState();
		const cursorSamples = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" as const },
			{ timeMs: 100, cx: 1, cy: 1, interactionType: "move" as const },
		];

		computeCursorFollowFocus(
			state,
			cursorSamples,
			0,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		const clampedFocus = computeCursorFollowFocus(
			state,
			cursorSamples,
			100,
			2,
			1,
			{ cx: 0.5, cy: 0.5 },
			{ snapToEdgesRatio: 0.25 },
		);

		expect(clampedFocus).toEqual({ cx: 0.75, cy: 0.75 });
	});

	it("centers an out-of-zone cursor on the first auto zoom frame", () => {
		const state = createCursorFollowCameraState();
		const cursorSamples = [
			{ timeMs: 0, cx: 0.8, cy: 0.2, interactionType: "move" as const },
			{ timeMs: 100, cx: 0.82, cy: 0.22, interactionType: "move" as const },
		];

		const initialFocus = computeCursorFollowFocus(
			state,
			cursorSamples,
			0,
			2,
			1,
			{ cx: 0.3, cy: 0.7 },
			{ snapToEdgesRatio: 0.25 },
		);

		expect(initialFocus).toEqual({ cx: 0.75, cy: 0.25 });
	});

	it("preserves the saved region focus when the initial cursor is already inside its safe zone", () => {
		const focus = computeCursorFollowFocus(
			createCursorFollowCameraState(),
			[{ timeMs: 0, cx: 0.55, cy: 0.45 }],
			0,
			2,
			0.2,
			{ cx: 0.5, cy: 0.5 },
		);
		expect(focus).toEqual({ cx: 0.5, cy: 0.5 });
	});
});
