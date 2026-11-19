import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../types";
import { createCursorFollowCameraState } from "./cursorFollowCamera";
import { projectCursorPositionToViewport } from "./cursorViewport";
import { getZoomFocusSpace } from "./focusUtils";
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
	const sourceCrop = { x: 0.5, y: 0.2, width: 0.5, height: 0.6 };
	const sourceFocus = { cx: 0.6, cy: 0.4 };
	const croppedRegion: ZoomRegion = { ...region, mode: "auto", depth: 6, focus: sourceFocus };

	it.each([
		false,
		true,
	])("targets the visible click inside a crop with classic mode %s", (zoomClassicMode) => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [croppedRegion],
			timeMs: 2000,
			sourceCrop,
			zoomClassicMode,
			cursorTelemetry: [{ timeMs: 0, ...sourceFocus }],
			cursorFollowCamera: createCursorFollowCameraState(),
		});
		const click = projectCursorPositionToViewport(sourceFocus, sourceCrop);
		// The clicked point lands at the center of an unpadded zoomed viewport.
		expect(0.5 + (click.cx - target.focus.cx) * target.scale).toBeCloseTo(0.5);
		expect(0.5 + (click.cy - target.focus.cy) * target.scale).toBeCloseTo(0.5);
	});

	it("projects a source target before applying zoom bounds, even without telemetry", () => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [{ ...croppedRegion, focus: { cx: 0.95, cy: 0.5 } }],
			timeMs: 2000,
			sourceCrop: { x: 0.8, y: 0, width: 0.2, height: 1 },
			cursorFollowCamera: createCursorFollowCameraState(),
		});
		expect(target.focus.cx).toBeCloseTo(0.75);
	});

	it.each([
		"manual",
		"auto",
	] as const)("preserves a viewport-picked target in %s mode", (mode) => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [
				{ ...croppedRegion, mode, focusSpace: "viewport", focus: { cx: 0.3, cy: 0.7 } },
			],
			timeMs: 2000,
			sourceCrop,
			cursorFollowCamera: createCursorFollowCameraState(),
		});
		expect(target.focus).toEqual({ cx: 0.3, cy: 0.7 });
	});

	it("keeps the coordinate space when switching an existing auto target to manual", () => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [
				{ ...croppedRegion, mode: "manual", focusSpace: getZoomFocusSpace(croppedRegion) },
			],
			timeMs: 2000,
			sourceCrop,
			cursorFollowCamera: createCursorFollowCameraState(),
		});
		expect(target.focus.cx).toBeCloseTo(0.2);
		expect(target.focus.cy).toBeCloseTo(1 / 3);
	});

	it("keeps old manual targets in viewport coordinates", () => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [{ ...croppedRegion, mode: "manual" }],
			timeMs: 2000,
			sourceCrop,
			cursorFollowCamera: createCursorFollowCameraState(),
		});
		expect(target.focus).toEqual(sourceFocus);
	});

	it("projects targets for connected zooms", () => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [
				{ ...croppedRegion, endMs: 1000 },
				{ ...croppedRegion, id: "next", startMs: 2300, endMs: 6000 },
			],
			timeMs: 2700,
			sourceCrop,
			connectZooms: true,
			cursorFollowCamera: createCursorFollowCameraState(),
		});
		expect(target.focus.cx).toBeCloseTo(0.2);
	});

	it("preserves automatic framing with a full-source crop", () => {
		const args = { zoomRegions: [croppedRegion], timeMs: 2000 };
		expect(
			resolveSceneZoomTarget({
				...args,
				cursorFollowCamera: createCursorFollowCameraState(),
				sourceCrop: { x: 0, y: 0, width: 1, height: 1 },
			}),
		).toEqual(
			resolveSceneZoomTarget({
				...args,
				cursorFollowCamera: createCursorFollowCameraState(),
			}),
		);
	});

	it("returns the neutral camera when no zoom is active", () => {
		expect(
			resolveSceneZoomTarget({
				zoomRegions: [],
				timeMs: 1000,
				cursorFollowCamera: createCursorFollowCameraState(),
			}),
		).toEqual({ scale: 1, focus: { cx: 0.5, cy: 0.5 }, progress: 0 });
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
	it("finishes one pending neutral frame when a delayed renderer pauses beyond the zoom", () => {
		const frame = {
			motionMode: "preserve" as const,
			contentTimeChanged: true,
			shouldSnapPausedFrame: false,
			hasPendingNeutralFrame: true,
		};
		expect(shouldComposePreviewFrame(frame)).toBe(true);
		expect(shouldComposePreviewFrame({ ...frame, contentTimeChanged: false })).toBe(false);
		expect(shouldComposePreviewFrame({ ...frame, isSeeking: true })).toBe(false);
	});

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
