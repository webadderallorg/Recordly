import { describe, expect, it } from "vitest";
import { type CursorTelemetryPoint, ZOOM_DEPTH_SCALES, type ZoomRegion } from "../types";
import { computeCameraTransform } from "./cameraTransform";
import { createCursorFollowCameraState } from "./cursorFollowCamera";
import { easeOutZoom } from "./mathUtils";
import { createSpringState } from "./motionSmoothing";
import { resolveSceneZoomTarget } from "./sceneMotion";
import { computeZoomTransform } from "./zoomTransform";

const stageSize = { width: 1000, height: 600 };
const baseMask = { x: 0, y: 0, ...stageSize };
const outgoing: ZoomRegion = {
	id: "outgoing",
	startMs: 0,
	endMs: 3000,
	depth: 3,
	focus: { cx: 0.35, cy: 0.4 },
	mode: "manual",
};
const incoming: ZoomRegion = {
	...outgoing,
	id: "incoming",
	startMs: 4000,
	endMs: 8000,
	focus: { cx: 0.65, cy: 0.6 },
};

function createCamera(
	fps: number,
	options: {
		outgoing?: ZoomRegion;
		incoming?: ZoomRegion;
		cursorTelemetry?: CursorTelemetryPoint[];
	} = {},
) {
	const springScale = createSpringState(1);
	const springX = createSpringState(0.5);
	const springY = createSpringState(0.5);
	const cursorFollowCamera = createCursorFollowCameraState();
	let previousTimeMs: number | null = null;
	return {
		springScale,
		springX,
		springY,
		sample(timeMs: number, snap = false) {
			const target = resolveSceneZoomTarget({
				zoomRegions: [options.outgoing ?? outgoing, options.incoming ?? incoming],
				connectZooms: true,
				zoomInDurationMs: 200,
				zoomOutDurationMs: 300,
				connectedZoomDurationMs: 1000,
				cursorTelemetry: options.cursorTelemetry,
				cursorFollowCamera,
				timeMs,
			});
			const deltaMs = previousTimeMs === null ? 1000 / fps : timeMs - previousTimeMs;
			previousTimeMs = timeMs;
			const transform = computeCameraTransform({
				target,
				stageSize,
				baseMask,
				springScale,
				springX,
				springY,
				deltaMs,
				snap,
				zoomSmoothness: 0.5,
			});
			const goal = computeZoomTransform({
				stageSize,
				baseMask,
				zoomScale: target.scale,
				zoomProgress: target.progress,
				focusX: target.focus.cx,
				focusY: target.focus.cy,
			});
			return { transform, goal, target };
		},
	};
}

function warmToBeforeIncoming(camera: ReturnType<typeof createCamera>, fps: number) {
	let last = camera.sample(0);
	for (let frame = 1; frame < fps * 4; frame += 1) {
		last = camera.sample((frame * 1000) / fps);
	}
	return last;
}

/** Independent 1 ms RK4 integration of one default camera spring following raw easing. */
function referenceSingleSpring(durationMs: number) {
	const samples = [0];
	let value = 0;
	let velocity = 0;
	const dt = 0.001;
	const acceleration = (timeMs: number, position: number, speed: number) =>
		100 * (easeOutZoom(timeMs / durationMs) - position) - 21 * speed;
	for (let timeMs = 0; timeMs < durationMs; timeMs += 1) {
		const a1 = acceleration(timeMs, value, velocity);
		const v2 = velocity + (a1 * dt) / 2;
		const a2 = acceleration(timeMs + 0.5, value + (velocity * dt) / 2, v2);
		const v3 = velocity + (a2 * dt) / 2;
		const a3 = acceleration(timeMs + 0.5, value + (v2 * dt) / 2, v3);
		const v4 = velocity + a3 * dt;
		const a4 = acceleration(timeMs + 1, value + v3 * dt, v4);
		value += (dt / 6) * (velocity + 2 * v2 + 2 * v3 + v4);
		velocity += (dt / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
		samples.push(value);
	}
	return samples;
}

describe("connected pan physics", () => {
	it.each([
		125, 250, 500, 1000,
	])("uses all %i ms of media time after a delayed camera frame", (elapsedMs) => {
		const options = {
			outgoing: { ...outgoing, depth: 2 as const },
			incoming: { ...incoming, depth: 4 as const },
		};
		const delayed = createCamera(60, options);
		const regular = createCamera(60, options);
		warmToBeforeIncoming(delayed, 60);
		warmToBeforeIncoming(regular, 60);
		delayed.sample(incoming.startMs);
		regular.sample(incoming.startMs);
		const steps = Math.ceil(elapsedMs / (1000 / 60));
		let reference = regular.sample(incoming.startMs + elapsedMs / steps);
		for (let step = 2; step <= steps; step += 1)
			reference = regular.sample(incoming.startMs + (elapsedMs * step) / steps);
		const actual = delayed.sample(incoming.startMs + elapsedMs);
		// Compare the displayed pose, not just the latest spring goal. A sparse
		// decoder must reach the same framing as a regularly composed preview.
		expect(Math.abs(actual.transform.x - reference.transform.x)).toBeLessThan(0.1);
		expect(Math.abs(actual.transform.y - reference.transform.y)).toBeLessThan(0.1);
		expect(Math.abs(actual.transform.scale - reference.transform.scale)).toBeLessThan(0.0001);
		expect(Math.abs(delayed.springX.velocity - regular.springX.velocity)).toBeLessThan(0.0001);
	});

	it("follows one spring response instead of filtering a baked spring a second time", () => {
		const fps = 60;
		const camera = createCamera(fps);
		const reference = referenceSingleSpring(1000);
		for (let frame = 0; frame <= fps * 3; frame += 1) camera.sample((frame * 1000) / fps);
		for (let frame = 1; frame <= 36; frame += 1) {
			camera.sample(outgoing.endMs + (frame * 1000) / fps);
			if (frame === 18 || frame === 36) {
				const elapsedMs = (frame * 1000) / fps;
				const actualProgress =
					(camera.springX.value - outgoing.focus.cx) /
					(incoming.focus.cx - outgoing.focus.cx);
				// The decoded-frame solver leads continuous input by less than one frame.
				// Four percentage points cover that cadence difference, but not a second spring.
				expect(Math.abs(actualProgress - reference[elapsedMs])).toBeLessThan(0.04);
			}
		}
	});

	it.each([
		[2, 6],
		[6, 2],
	] as const)("keeps connected depth %i → %i moving and settling across the block", (from, to) => {
		const fps = 60;
		const camera = createCamera(fps, {
			outgoing: { ...outgoing, depth: from, focus: { cx: 0.5, cy: 0.5 } },
			incoming: { ...incoming, depth: to, focus: { cx: 0.5, cy: 0.5 } },
		});
		const before = warmToBeforeIncoming(camera, fps);
		const previousVelocity = camera.springScale.velocity;
		const boundary = camera.sample(incoming.startMs);
		const direction = Math.sign(to - from);
		const targetScale = ZOOM_DEPTH_SCALES[to];
		expect(boundary.target.connected).toBe(true);
		expect(previousVelocity * direction).toBeGreaterThan(0);
		expect(camera.springScale.velocity * direction).toBeGreaterThan(
			Math.abs(previousVelocity) * 0.5,
		);
		expect((boundary.transform.scale - before.transform.scale) * direction).toBeGreaterThan(0);
		expect((targetScale - boundary.transform.scale) * direction).toBeGreaterThan(0.001);
		const after = camera.sample(incoming.startMs + 1000 / fps);
		expect((after.transform.scale - boundary.transform.scale) * direction).toBeGreaterThan(0);
		for (let frame = 2; frame <= fps * 2; frame += 1) {
			camera.sample(incoming.startMs + (frame * 1000) / fps);
		}
		expect(camera.springScale.value).toBe(targetScale);
		expect(camera.springScale.velocity).toBe(0);
	});

	it.each([
		24, 30, 60,
	])("keeps position and spring velocity continuous into the next block at %i fps", (fps) => {
		const camera = createCamera(fps);
		const before = warmToBeforeIncoming(camera, fps);
		const previousVelocity = camera.springX.velocity;
		const boundary = camera.sample(incoming.startMs);

		expect(previousVelocity).toBeGreaterThan(0);
		expect(camera.springX.velocity).toBeGreaterThan(previousVelocity * 0.5);
		expect(boundary.transform.x).toBeLessThan(before.transform.x);
		expect(boundary.transform.x).toBeGreaterThan(boundary.goal.x + 0.1);
		expect(boundary.transform.y).toBeGreaterThan(boundary.goal.y + 0.1);
		const after = camera.sample(incoming.startMs + 1000 / fps);
		expect(after.transform.x).toBeLessThan(boundary.transform.x);
		expect(after.transform.x).toBeGreaterThan(after.goal.x);

		// Entering the block does not complete the pan; its physical tail settles gradually.
		let movingFrames = 1;
		let settled = after;
		for (let frame = 2; frame <= fps * 2; frame += 1) {
			const next = camera.sample(incoming.startMs + (frame * 1000) / fps);
			if (Math.abs(next.transform.x - settled.transform.x) > 0.01) movingFrames += 1;
			settled = next;
		}
		expect(movingFrames).toBeGreaterThan(3);
		expect(settled.transform.x).toBeCloseTo(settled.goal.x, 8);
		expect(settled.transform.y).toBeCloseTo(settled.goal.y, 8);
		expect(camera.springX.velocity).toBe(0);
		expect(camera.springY.velocity).toBe(0);
	});

	it("does not force the endpoint when automatic framing changes at the block boundary", () => {
		const fps = 60;
		const camera = createCamera(fps, {
			incoming: { ...incoming, mode: "auto" },
			cursorTelemetry: [
				{ timeMs: 0, cx: 0.65, cy: 0.6 },
				{ timeMs: 3999, cx: 0.65, cy: 0.6 },
				{ timeMs: 4000, cx: 0.2, cy: 0.3 },
			],
		});
		const before = warmToBeforeIncoming(camera, fps);
		const boundary = camera.sample(incoming.startMs);
		expect(boundary.target.focus.cx).toBeLessThan(0.3);
		expect(Math.abs(boundary.transform.x - before.transform.x)).toBeLessThan(25);
		expect(Math.abs(boundary.transform.x - boundary.goal.x)).toBeGreaterThan(250);
		expect(Math.abs(camera.springX.velocity)).toBeGreaterThan(0);
	});

	it("advances through the elapsed gap when no decoded frame sampled it", () => {
		const camera = createCamera(60);
		for (let frame = 0; frame <= 180; frame += 1) camera.sample((frame * 1000) / 60);
		const boundary = camera.sample(incoming.startMs);
		expect(camera.springX.value).toBeGreaterThan(outgoing.focus.cx);
		expect(Math.abs(boundary.transform.x - boundary.goal.x)).toBeLessThan(1);
		expect(Math.abs(camera.springX.velocity)).toBeLessThan(0.015);
	});

	it("uses an intentional seek to snap to the requested camera frame", () => {
		const camera = createCamera(60);
		warmToBeforeIncoming(camera, 60);
		const playing = camera.sample(incoming.startMs);
		expect(playing.transform.x).not.toBe(playing.goal.x);
		const seek = camera.sample(incoming.startMs + 100, true);
		expect(seek.transform).toEqual(seek.goal);
		expect(camera.springX.velocity).toBe(0);
		expect(camera.springY.velocity).toBe(0);
	});

	it("resumes spring motion from the sought frame when automatic framing changes", () => {
		const camera = createCamera(60, {
			incoming: { ...incoming, mode: "auto" },
			cursorTelemetry: [
				{ timeMs: 0, cx: 0.65, cy: 0.6 },
				{ timeMs: 4100, cx: 0.65, cy: 0.6 },
				{ timeMs: 4100 + 1000 / 60, cx: 0.2, cy: 0.3 },
			],
		});
		warmToBeforeIncoming(camera, 60);
		const seek = camera.sample(4100, true);
		expect(seek.transform).toEqual(seek.goal);
		expect(camera.springX.initialized).toBe(true);
		expect(camera.springY.initialized).toBe(true);

		const resumed = camera.sample(4100 + 1000 / 60);
		expect(resumed.target.focus.cx).toBeLessThan(0.3);
		expect(Math.abs(resumed.transform.x - seek.transform.x)).toBeLessThan(25);
		expect(Math.abs(resumed.transform.x - resumed.goal.x)).toBeGreaterThan(250);
		expect(Math.abs(camera.springX.velocity)).toBeGreaterThan(0);
		expect(Math.abs(camera.springY.velocity)).toBeGreaterThan(0);
	});

	it("holds the outgoing camera until the gap begins", () => {
		const camera = createCamera(60);
		for (let frame = 0; frame <= 120; frame += 1) camera.sample((frame * 1000) / 60);
		for (const timeMs of [2500, 2999, 3000]) {
			const held = camera.sample(timeMs);
			expect(held.target.focus).toEqual(outgoing.focus);
			expect(held.transform).toEqual(held.goal);
		}
		const inGap = camera.sample(3100);
		expect(inGap.target.focus.cx).toBeGreaterThan(outgoing.focus.cx);
		expect(inGap.transform.x).toBeLessThan(-130);
	});
});
