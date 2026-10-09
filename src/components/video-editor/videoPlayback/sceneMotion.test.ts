import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../types";
import { createCursorFollowCameraState } from "./cursorFollowCamera";
import {
	resolvePreviewMotionMode,
	resolveSceneZoomTarget,
	shouldComposePreviewFrame,
} from "./sceneMotion";

const region: ZoomRegion = {
	id: "zoom",
	startMs: 0,
	endMs: 4000,
	depth: 2,
	focus: { cx: 0.7, cy: 0.3 },
	mode: "manual",
};

describe("resolveSceneZoomTarget", () => {
	it("returns the neutral camera when no zoom is active", () => {
		expect(
			resolveSceneZoomTarget({
				zoomRegions: [],
				timeMs: 1000,
				cursorFollowCamera: createCursorFollowCameraState(),
			}),
		).toEqual({
			scale: 1,
			focus: { cx: 0.5, cy: 0.5 },
			progress: 0,
			// Every target carries a resolved 3D move so the renderers never have
			// to re-derive it; with no region active it is the zero state.
			move3d: { rotateX: 0, rotateY: 0, perspective: 0 },
		});
	});

	it("resolves the same manual target for every rendering backend", () => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [region],
			timeMs: 2000,
			cursorFollowCamera: createCursorFollowCameraState(),
		});

		expect(target.scale).toBeGreaterThan(1);
		// The scene evaluator clamps focus so the zoom never exposes the stage edge.
		expect(target.focus.cx).toBeCloseTo(2 / 3);
		expect(target.focus.cy).toBeCloseTo(1 / 3);
		expect(target.progress).toBe(1);
	});

	it("resolves no 3D move for a region that has none", () => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [region],
			timeMs: 2000,
			cursorFollowCamera: createCursorFollowCameraState(),
		});

		expect(target.move3d).toEqual({ rotateX: 0, rotateY: 0, perspective: 0 });
	});

	it("threads a region's 3D move through the shared resolver", () => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [{ ...region, move3d: { preset: "tilt-right", intensity: 1 } }],
			timeMs: 2000,
			cursorFollowCamera: createCursorFollowCameraState(),
		});

		// This is the field all three renderers read, so a non-zero value here is
		// what guarantees the exporters tilt exactly as the preview does.
		expect(target.move3d.rotateY).toBeGreaterThan(0);
	});

	it("returns no 3D move once the region has ended", () => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [{ ...region, move3d: { preset: "tilt-right" } }],
			timeMs: 9000,
			cursorFollowCamera: createCursorFollowCameraState(),
		});

		expect(target.move3d).toEqual({ rotateX: 0, rotateY: 0, perspective: 0 });
	});

	/**
	 * The 2D/3D switch must strip the move at this single shared resolver, not
	 * in each renderer. Preview and both exporters read this one field, so
	 * gating here is what guarantees they cannot disagree.
	 */
	describe("zoom3DEnabled switch", () => {
		const tilted = [{ ...region, move3d: { preset: "tilt-right" as const, intensity: 1 } }];

		it("keeps the 3D move by default", () => {
			const target = resolveSceneZoomTarget({
				zoomRegions: tilted,
				timeMs: 2000,
				cursorFollowCamera: createCursorFollowCameraState(),
			});
			expect(target.move3d.rotateY).toBeGreaterThan(0);
		});

		it("resolves the move out entirely when disabled", () => {
			const target = resolveSceneZoomTarget({
				zoomRegions: tilted,
				timeMs: 2000,
				cursorFollowCamera: createCursorFollowCameraState(),
				zoom3DEnabled: false,
			});
			expect(target.move3d.rotateY).toBe(0);
			expect(target.move3d.rotateX).toBe(0);
			expect(target.move3d.perspective).toBe(0);
		});

		it("leaves the 2D zoom completely untouched when disabled", () => {
			const with3D = resolveSceneZoomTarget({
				zoomRegions: tilted,
				timeMs: 2000,
				cursorFollowCamera: createCursorFollowCameraState(),
			});
			const without3D = resolveSceneZoomTarget({
				zoomRegions: tilted,
				timeMs: 2000,
				cursorFollowCamera: createCursorFollowCameraState(),
				zoom3DEnabled: false,
			});
			expect(without3D.scale).toBe(with3D.scale);
			expect(without3D.progress).toBe(with3D.progress);
			expect(without3D.focus).toEqual(with3D.focus);
		});
	});
});

describe("resolvePreviewMotionMode", () => {
	it.each([false, true])("preserves a plain pause with classic mode %s", (zoomClassicMode) => {
		expect(
			resolvePreviewMotionMode({
				isPlaying: false,
				isSeeking: false,
				shouldSnapPausedFrame: false,
				zoomClassicMode,
			}),
		).toBe("preserve");
	});

	it("snaps paused frames only for an intentional timeline seek", () => {
		expect(
			resolvePreviewMotionMode({
				isPlaying: false,
				isSeeking: false,
				shouldSnapPausedFrame: true,
				zoomClassicMode: false,
			}),
		).toBe("snap");
	});
});

describe("shouldComposePreviewFrame", () => {
	it("holds every visual sample, including blur and cursor state, while paused", () => {
		expect(
			shouldComposePreviewFrame({
				motionMode: "preserve",
				contentTimeChanged: true,
				shouldSnapPausedFrame: false,
			}),
		).toBe(false);
	});

	it("does not interpolate again at an unchanged playback timestamp", () => {
		expect(
			shouldComposePreviewFrame({
				motionMode: "spring",
				contentTimeChanged: false,
				shouldSnapPausedFrame: false,
			}),
		).toBe(false);
	});

	it("composes one exact frame when a seek requests it", () => {
		expect(
			shouldComposePreviewFrame({
				motionMode: "snap",
				contentTimeChanged: false,
				shouldSnapPausedFrame: true,
			}),
		).toBe(true);
	});
});


describe("preview seek completion", () => {
	it("holds the composed frame until seeking finishes, even with a pending refresh", () => {
		const pending = {
			motionMode: "snap" as const,
			contentTimeChanged: true,
			shouldSnapPausedFrame: true,
		};
		expect(shouldComposePreviewFrame({ ...pending, isSeeking: true })).toBe(false);
		expect(shouldComposePreviewFrame({ ...pending, isSeeking: false })).toBe(true);
	});
});
