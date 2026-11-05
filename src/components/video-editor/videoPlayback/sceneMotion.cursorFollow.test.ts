import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint, ZoomRegion } from "../types";
import { createCursorFollowCameraState } from "./cursorFollowCamera";
import { resolveSceneZoomTarget } from "./sceneMotion";

const zoomRegions: ZoomRegion[] = [
	{
		id: "text",
		startMs: 245,
		endMs: 5528,
		depth: 2,
		focus: { cx: 0.75, cy: 0.538 },
		mode: "auto",
	},
	{
		id: "toolbar",
		startMs: 9966,
		endMs: 15898,
		depth: 3,
		focus: { cx: 0.029, cy: 0.585 },
		mode: "auto",
	},
];

const cursorTelemetry: CursorTelemetryPoint[] = [
	{ timeMs: 0, cx: 0.75, cy: 0.538 },
	{ timeMs: 8000, cx: 0.75, cy: 0.538 },
	{ timeMs: 12000, cx: 0.5, cy: 0.1 },
	{ timeMs: 16000, cx: 0.5, cy: 0.1 },
];

describe("automatic zoom camera lifecycle", () => {
	it("freezes shallow automatic framing on exit even when full zoom was never reached", () => {
		const camera = createCursorFollowCameraState();
		const zoom: ZoomRegion = {
			id: "shallow",
			startMs: 0,
			endMs: 1500,
			depth: 3,
			mode: "auto",
			focus: { cx: 0.3, cy: 0.5 },
		};
		let focus = zoom.focus;
		for (let timeMs = 0; timeMs <= 525; timeMs += 25) {
			focus = resolveSceneZoomTarget({
				zoomRegions: [zoom],
				timeMs,
				cursorFollowCamera: camera,
				cursorTelemetry: [
					{ timeMs: 0, cx: 0.3, cy: 0.5 },
					{ timeMs: 500, cx: 0.3, cy: 0.5 },
					{ timeMs: 501, cx: 0.8, cy: 0.5 },
				],
				zoomInDurationMs: 200,
				zoomOutDurationMs: 300,
			}).focus;
		}
		expect(camera.reachedFullZoom).toBe(false);
		expect(focus.cx).toBeCloseTo(0.3);
	});

	it("keeps following through a short connected entrance before its envelope turns around", () => {
		const camera = createCursorFollowCameraState();
		const first: ZoomRegion = {
			id: "first",
			startMs: 0,
			endMs: 100,
			depth: 3,
			mode: "auto",
			focus: { cx: 0.3, cy: 0.5 },
		};
		const next = { ...first, id: "next", startMs: 200, endMs: 1500 };
		let focus = first.focus;
		for (let timeMs = 0; timeMs <= 325; timeMs += 25) {
			focus = resolveSceneZoomTarget({
				zoomRegions: [first, next],
				timeMs,
				connectZooms: true,
				cursorFollowCamera: camera,
				cursorTelemetry: [
					{ timeMs: 0, cx: 0.3, cy: 0.5 },
					{ timeMs: 300, cx: 0.3, cy: 0.5 },
					{ timeMs: 301, cx: 0.8, cy: 0.5 },
				],
				zoomInDurationMs: 200,
				zoomOutDurationMs: 300,
			}).focus;
		}
		expect(camera.reachedFullZoom).toBe(false);
		expect(focus.cx).toBeCloseTo(1 - 1 / 3.6);
	});

	it("aims at the mapped source cursor from the first positive entrance through the faint exit", () => {
		const camera = createCursorFollowCameraState();
		const zoom: ZoomRegion = {
			id: "early",
			startMs: 999,
			endMs: 5000,
			depth: 3,
			mode: "auto",
			focus: { cx: 0.5, cy: 0.5 },
		};
		const sample = (timeMs: number) =>
			resolveSceneZoomTarget({
				zoomRegions: [zoom],
				timeMs,
				cursorTimeMs: timeMs + 5000,
				cursorTelemetry: [
					{ timeMs: 0, cx: 0.1, cy: 0.9 },
					{ timeMs: 5000, cx: 0.9, cy: 0.1 },
					{ timeMs: 10000, cx: 0.9, cy: 0.1 },
				],
				cursorFollowCamera: camera,
				zoomInDurationMs: 200,
				zoomOutDurationMs: 300,
			});
		const early = sample(1000);
		expect(early.progress).toBeGreaterThan(0);
		expect(early.progress).toBeLessThan(0.01);
		expect(early.focus).toEqual({ cx: 1 - 1 / 3.6, cy: 1 / 3.6 });
		sample(3000);
		const faint = sample(4900);
		expect(faint.progress).toBeGreaterThan(0);
		expect(faint.progress).toBeLessThan(0.01);
		expect(faint.focus).toEqual(early.focus);
		expect(camera.initialized).toBe(true);
		expect(sample(5000).progress).toBe(0);
		expect(camera.initialized).toBe(false);
	});

	it("discards an earlier connection's framing when a time jump skips a later pan", () => {
		const first: ZoomRegion = {
			id: "first",
			startMs: 0,
			endMs: 2000,
			depth: 2,
			focus: { cx: 0.35, cy: 0.5 },
			mode: "auto",
		};
		const second: ZoomRegion = { ...first, id: "second", startMs: 3500, endMs: 6000, depth: 3 };
		const last: ZoomRegion = {
			...first,
			id: "last",
			startMs: 7500,
			endMs: 10000,
			depth: 4,
			focus: { cx: 0.4, cy: 0.5 },
		};
		const panDuration = 1000;
		const args = {
			zoomRegions: [first, second, last],
			connectZooms: true,
			zoomInDurationMs: 200,
			zoomOutDurationMs: 300,
			cursorTelemetry: [{ timeMs: 0, cx: 0.8, cy: 0.5 }],
			cursorFollowCamera: createCursorFollowCameraState(),
		};
		for (const timeMs of [1999, 2000, 2000 + panDuration - 1, 2000 + panDuration + 10])
			resolveSceneZoomTarget({ ...args, timeMs });
		expect(resolveSceneZoomTarget({ ...args, timeMs: 6000 + panDuration + 10 }).focus).toEqual(
			last.focus,
		);
	});

	it("holds an early-finished automatic pan until the incoming block starts", () => {
		const first: ZoomRegion = {
			id: "first",
			startMs: 0,
			endMs: 4000,
			depth: 2,
			focus: { cx: 0.35, cy: 0.5 },
			mode: "auto",
		};
		const second: ZoomRegion = { ...first, id: "next", startMs: 5500, endMs: 8000, depth: 3 };
		const end = 4000 + 1000;
		const args = {
			zoomRegions: [first, second],
			connectZooms: true,
			zoomInDurationMs: 200,
			zoomOutDurationMs: 300,
			cursorFollowCamera: createCursorFollowCameraState(),
			cursorTelemetry: [
				{ timeMs: 0, cx: 0.8, cy: 0.5 },
				{ timeMs: 5300, cx: 0.8, cy: 0.5 },
				{ timeMs: 5400, cx: 0.2, cy: 0.5 },
			],
		};
		for (const timeMs of [3999, 4000, end - 1]) resolveSceneZoomTarget({ ...args, timeMs });
		const held = resolveSceneZoomTarget({ ...args, timeMs: end }).focus;
		expect(resolveSceneZoomTarget({ ...args, timeMs: 5400 }).focus).toEqual(held);
		expect(resolveSceneZoomTarget({ ...args, timeMs: 5499 }).focus).toEqual(held);
		expect(resolveSceneZoomTarget({ ...args, timeMs: 5500 }).focus).not.toEqual(held);
	});

	it("preserves live automatic framing at both connected handoff boundaries", () => {
		const first: ZoomRegion = {
			id: "first",
			startMs: 0,
			endMs: 3000,
			depth: 2,
			focus: { cx: 0.35, cy: 0.5 },
			mode: "auto",
		};
		const second: ZoomRegion = {
			...first,
			id: "second",
			startMs: 3500,
			endMs: 6000,
			depth: 3,
		};
		const settings = { zoomInDurationMs: 200, zoomOutDurationMs: 200 / 0.7 };
		const start = first.endMs;
		const end = Math.min(second.startMs, start + 1000);
		const args = {
			...settings,
			zoomRegions: [first, second],
			connectZooms: true,
			cursorTelemetry: [{ timeMs: 0, cx: 0.8, cy: 0.5 }],
			cursorFollowCamera: createCursorFollowCameraState(),
		};
		const before = resolveSceneZoomTarget({ ...args, timeMs: start - 0.001 });
		const entering = resolveSceneZoomTarget({ ...args, timeMs: start + 0.001 });
		expect(before.focus.cx).toBeCloseTo(2 / 3);
		expect(entering.focus.cx).toBeCloseTo(before.focus.cx, 5);
		const exiting = resolveSceneZoomTarget({ ...args, timeMs: end - 0.001 });
		const after = resolveSceneZoomTarget({ ...args, timeMs: end + 0.001 });
		expect(after.focus.cx).toBeCloseTo(exiting.focus.cx, 5);
		expect(after.focus.cx).toBeCloseTo(1 - 1 / 3.6);
	});

	it("targets the current cursor throughout a later zoom-in instead of correcting after full zoom", () => {
		const cursorFollowCamera = createCursorFollowCameraState();
		const targets = [];
		for (let frame = 0; frame <= 625; frame += 1) {
			const timeMs = (frame * 1000) / 60;
			const target = resolveSceneZoomTarget({
				zoomRegions,
				timeMs,
				cursorTimeMs: timeMs + 2571,
				cursorTelemetry,
				cursorFollowCamera,
				zoomInDurationMs: 200,
				zoomOutDurationMs: 200,
			});
			if (timeMs >= 9950 && target.progress >= 0.01) targets.push(target);
		}

		expect(targets.length).toBeGreaterThan(10);
		for (const target of targets) {
			expect(target.focus.cx).toBeCloseTo(0.5);
			expect(target.focus.cy).toBeCloseTo(1 / 3.6);
		}
	});

	it("discards frozen auto framing when the camera returns to its neutral view", () => {
		const cursorFollowCamera = createCursorFollowCameraState();
		const args = { zoomRegions, cursorTelemetry, cursorFollowCamera };
		resolveSceneZoomTarget({ ...args, timeMs: 3000 });
		expect(cursorFollowCamera.reachedFullZoom).toBe(true);
		resolveSceneZoomTarget({ ...args, timeMs: 8000 });
		expect(cursorFollowCamera.initialized).toBe(false);
		expect(cursorFollowCamera.reachedFullZoom).toBe(false);
	});

	it("discards auto framing while a manual zoom owns the camera", () => {
		const cursorFollowCamera = createCursorFollowCameraState();
		const args = { zoomRegions, cursorTelemetry, cursorFollowCamera };
		resolveSceneZoomTarget({ ...args, timeMs: 3000 });
		const manualZoom: ZoomRegion = {
			...zoomRegions[0],
			id: "manual",
			mode: "manual",
			focus: { cx: 0.4, cy: 0.6 },
		};
		const target = resolveSceneZoomTarget({ ...args, zoomRegions: [manualZoom], timeMs: 3000 });
		expect(target.focus).toEqual(manualZoom.focus);
		expect(cursorFollowCamera.initialized).toBe(false);
	});

	it("still holds the current camera focus during the same region's zoom-out", () => {
		const cursorFollowCamera = createCursorFollowCameraState();
		const args = {
			zoomRegions,
			cursorFollowCamera,
			cursorTelemetry: [
				{ timeMs: 3000, cx: 0.7, cy: 0.5 },
				{ timeMs: 5600, cx: 0.2, cy: 0.2 },
			],
			zoomOutDurationMs: 200,
		};
		const held = resolveSceneZoomTarget({ ...args, timeMs: 3000 });
		const zoomOut = resolveSceneZoomTarget({ ...args, timeMs: 5450 });
		expect(zoomOut.progress).toBeGreaterThan(0);
		expect(zoomOut.progress).toBeLessThan(0.99);
		expect(zoomOut.focus).toEqual(held.focus);
	});
});
