import { describe, expect, it } from "vitest";
import { CURSOR_MOTION_PRESETS } from "../cursorMotionPresets";
import type { CursorTelemetryPoint } from "../types";
import { prepareCinematicCursorTelemetry } from "./cinematicCursorTelemetry";
import { interpolateCursorPosition } from "./cursorPosition";
import { getCursorVisualState } from "./cursorVisualState";

const cinematic = CURSOR_MOTION_PRESETS.smooth;
const tuning = {
	stiffnessMultiplier: cinematic.cursorSpringStiffnessMultiplier,
	dampingMultiplier: cinematic.cursorSpringDampingMultiplier,
	massMultiplier: cinematic.cursorSpringMassMultiplier,
};
const prepare = (samples: CursorTelemetryPoint[]) =>
	prepareCinematicCursorTelemetry(samples, cinematic.cursorSmoothing, tuning);
const point = (
	timeMs: number,
	cursorType: CursorTelemetryPoint["cursorType"] = "arrow",
	cx = 0.5,
	cy = 0.5,
): CursorTelemetryPoint => ({ timeMs, cx, cy, cursorType, interactionType: "move" });
const typeAt = (samples: CursorTelemetryPoint[], timeMs: number) =>
	getCursorVisualState(samples, timeMs, 350, 350).cursorType;

describe.each([
	CURSOR_MOTION_PRESETS.focused,
	cinematic,
])("$label cursor hover filtering", (preset) => {
	const prepare = (samples: CursorTelemetryPoint[]) =>
		prepareCinematicCursorTelemetry(samples, preset.cursorSmoothing, {
			stiffnessMultiplier: preset.cursorSpringStiffnessMultiplier,
			dampingMultiplier: preset.cursorSpringDampingMultiplier,
			massMultiplier: preset.cursorSpringMassMultiplier,
		});
	it.each([
		["arrow", "pointer"],
		["pointer", "arrow"],
	] as const)("removes a 300ms %s → %s → original excursion, including seeking", (baseline, transient) => {
		const samples = [
			point(0, baseline),
			point(1000, transient),
			point(1300, baseline),
			point(2400, baseline),
		];
		const result = prepare(samples);
		for (const time of [0, 1000, 1150, 1299, 1600, 1100])
			expect(typeAt(result, time)).toBe(baseline);
		expect(samples[1].cursorType).toBe(transient);
	});
	it("suppresses a hover just below the 500ms threshold", () => {
		const result = prepare([point(0), point(1000, "pointer"), point(1499), point(3000)]);
		expect(typeAt(result, 1000)).toBe("arrow");
		expect(typeAt(result, 1498)).toBe("arrow");
	});
	it.each([500, 800])("keeps a %ims hover at its original start, without delay", (duration) => {
		const result = prepare([
			point(0),
			point(1000, "pointer"),
			point(1000 + duration),
			point(3000),
		]);
		expect(typeAt(result, 999)).toBe("arrow");
		expect(typeAt(result, 1000)).toBe("pointer");
		expect(typeAt(result, 1000 + duration)).toBe("arrow");
	});
	it("removes chunks of alternating short states rather than revealing a delayed state", () => {
		const result = prepare([
			point(0),
			point(1000, "pointer"),
			point(1200, "text"),
			point(1400, "pointer"),
			point(1600, "text"),
			point(2300, "text"),
		]);
		for (const time of [1100, 1300, 1500]) expect(typeAt(result, time)).toBe("arrow");
		expect(typeAt(result, 1600)).toBe("text");
	});
	it("ignores transient cursor metadata on click samples and preserves press/release", () => {
		const down = {
			...point(1000, "pointer"),
			interactionType: "click" as const,
			mouseButton: 1 as const,
		};
		const up = { ...point(1100), interactionType: "mouseup" as const, mouseButton: 1 as const };
		const result = prepare([point(0), down, up, point(2000)]);
		expect(typeAt(result, 1050)).toBe("arrow");
		expect(getCursorVisualState(result, 1050, 350, 350).isPressed).toBe(true);
		expect(getCursorVisualState(result, 1150, 350, 350).isPressed).toBe(false);
		expect(result[1]).toMatchObject({ ...down, cursorType: "arrow" });
	});
});

describe("cinematic cursor telemetry", () => {
	it("straightens small wobble without retiming the recording or moving click targets", () => {
		const samples = [
			point(0, "arrow", 0.2),
			point(50, "arrow", 0.3, 0.505),
			point(100, "arrow", 0.4, 0.495),
			{ ...point(200, "arrow", 0.6), interactionType: "click" as const },
			point(250, "arrow", 0.7),
		];
		const result = prepare(samples);
		expect(result[1].cy).toBe(0.5);
		expect(result[2].cy).toBe(0.5);
		expect(result[1].cx).toBeCloseTo(0.3);
		expect(result[3]).toEqual(samples[3]);
		expect(result.map((p) => p.timeMs)).toEqual(samples.map((p) => p.timeMs));
		expect(interpolateCursorPosition(result, 75)?.cy).toBe(0.5);
		expect(samples[1].cy).toBe(0.505);
	});
	it("preserves substantial turns and limits deviation to ten reference pixels", () => {
		const samples = [
			point(0, "arrow", 0.2, 0.2),
			point(100, "arrow", 0.2, 0.5),
			point(200, "arrow", 0.5, 0.5),
		];
		expect(prepare(samples)).toEqual(samples);
		const dense = Array.from({ length: 500 }, (_, i) =>
			point(i * 10, "arrow", i / 1000, 0.5 + Math.sin(i) * 0.02),
		);
		const result = prepare(dense);
		for (let i = 0; i < dense.length; i++)
			expect(
				Math.hypot(
					(result[i].cx - dense[i].cx) * 1920,
					(result[i].cy - dense[i].cy) * 1080,
				),
			).toBeLessThanOrEqual(10.00001);
	});
	it("keeps pauses stationary", () => {
		const samples = [
			point(0, "arrow", 0.2),
			point(100, "arrow", 0.5),
			point(200, "arrow", 0.5),
			point(400, "arrow", 0.5),
			point(500, "arrow", 0.8),
		];
		const result = prepare(samples);
		expect(interpolateCursorPosition(result, 150)).toEqual({ cx: 0.5, cy: 0.5 });
		expect(interpolateCursorPosition(result, 350)).toEqual({ cx: 0.5, cy: 0.5 });
		const smallPause = prepare([
			point(0, "arrow", 0.2),
			point(50, "arrow", 0.204),
			point(100, "arrow", 0.204),
			point(150, "arrow", 0.21),
		]);
		expect(interpolateCursorPosition(smallPause, 75)).toEqual({ cx: 0.204, cy: 0.5 });
	});
	it("leaves custom settings unchanged, and caches per recording", () => {
		const samples = [point(0), point(1000, "pointer"), point(1300), point(2400)];
		expect(prepareCinematicCursorTelemetry(samples, cinematic.cursorSmoothing, {})).toBe(
			samples,
		);
		expect(prepareCinematicCursorTelemetry(samples, 0, tuning)).toBe(samples);
		expect(prepare(samples)).toBe(prepare(samples));
		samples.push(point(3000));
		expect(prepare(samples)).toHaveLength(5);
		expect(prepare([])).toEqual([]);
	});
});

it("keeps Focused paths intact and caches separately from Cinematic when switching presets", () => {
	const samples = [
		point(0, "arrow", 0.2),
		point(50, "pointer", 0.3, 0.505),
		point(100, "arrow", 0.4, 0.495),
		point(200, "arrow", 0.6),
	];
	const focused = CURSOR_MOTION_PRESETS.focused;
	const focus = () =>
		prepareCinematicCursorTelemetry(samples, focused.cursorSmoothing, {
			stiffnessMultiplier: focused.cursorSpringStiffnessMultiplier,
			dampingMultiplier: focused.cursorSpringDampingMultiplier,
			massMultiplier: focused.cursorSpringMassMultiplier,
		});
	const result = focus();
	expect(result[1]).toEqual({ ...samples[1], cursorType: "arrow" });
	expect(result.map(({ cx, cy, timeMs }) => ({ cx, cy, timeMs }))).toEqual(
		samples.map(({ cx, cy, timeMs }) => ({ cx, cy, timeMs })),
	);
	expect(prepare(samples)[1].cy).toBe(0.5);
	expect(focus()).toBe(result);
	samples.push(point(300));
	expect(focus()).toHaveLength(5);
});
