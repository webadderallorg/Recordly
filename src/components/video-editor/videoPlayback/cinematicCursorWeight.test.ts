import { describe, expect, it } from "vitest";
import { CURSOR_MOTION_PRESETS } from "../cursorMotionPresets";
import {
	createSpringState,
	getCursorSpringConfig,
	getZoomSpringConfig,
	stepSpringValue,
} from "./motionSmoothing";

const focused = CURSOR_MOTION_PRESETS.focused;
const cinematic = CURSOR_MOTION_PRESETS.smooth;
const tuning = {
	stiffnessMultiplier: cinematic.cursorSpringStiffnessMultiplier,
	dampingMultiplier: cinematic.cursorSpringDampingMultiplier,
	massMultiplier: cinematic.cursorSpringMassMultiplier,
};
const focusedConfig = getCursorSpringConfig(focused.cursorSmoothing, {
	stiffnessMultiplier: focused.cursorSpringStiffnessMultiplier,
	dampingMultiplier: focused.cursorSpringDampingMultiplier,
	massMultiplier: focused.cursorSpringMassMultiplier,
});
const previousCinematicConfig = {
	...focusedConfig,
	stiffness: focusedConfig.stiffness * 0.7 ** 2,
	damping: focusedConfig.damping * 0.7,
};

describe("Cinematic cursor weight", () => {
	it("increases inertia and damping while preserving stiffness and saved preset values", () => {
		const current = getCursorSpringConfig(cinematic.cursorSmoothing, tuning);
		expect(current.mass).toBeCloseTo(previousCinematicConfig.mass * 1.6);
		expect(current.stiffness).toBeCloseTo(previousCinematicConfig.stiffness);
		const ratio = (config: typeof current) =>
			config.damping / (2 * Math.sqrt(config.stiffness * config.mass));
		expect(ratio(current)).toBeGreaterThanOrEqual(1);
		expect(ratio(current)).toBeGreaterThan(ratio(previousCinematicConfig));
		expect(cinematic.cursorSpringMassMultiplier).toBe(1.29);
	});
	it("accelerates more gently and settles without overshoot", () => {
		const currentConfig = getCursorSpringConfig(cinematic.cursorSmoothing, tuning);
		const current = createSpringState(0);
		const previous = createSpringState(0);
		stepSpringValue(current, 0, 16, currentConfig);
		stepSpringValue(previous, 0, 16, previousCinematicConfig);
		for (let frame = 0; frame < 12; frame++) {
			stepSpringValue(current, 1, 1000 / 60, currentConfig);
			stepSpringValue(previous, 1, 1000 / 60, previousCinematicConfig);
		}
		expect(current.value).toBeLessThan(previous.value);
		for (let frame = 0; frame < 600; frame++) {
			const last = current.value;
			stepSpringValue(current, 1, 1000 / 60, currentConfig);
			expect(current.value).toBeGreaterThanOrEqual(last);
			expect(current.value).toBeLessThanOrEqual(1);
		}
		expect(current.value).toBe(1);
	});
	it("leaves custom cursor tuning and camera springs unaffected", () => {
		const base = getCursorSpringConfig(cinematic.cursorSmoothing);
		const custom = getCursorSpringConfig(cinematic.cursorSmoothing, { massMultiplier: 1.29 });
		expect(custom.mass).toBeCloseTo(base.mass * 1.29);
		expect(custom.damping).toBe(base.damping);
		const zoom = getZoomSpringConfig(0.5, tuning);
		expect(zoom.mass).toBeCloseTo(1.29);
		expect(zoom.damping).toBeCloseTo(21 * tuning.dampingMultiplier);
	});
});
