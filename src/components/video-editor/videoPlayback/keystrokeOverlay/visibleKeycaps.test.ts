import { describe, expect, it } from "vitest";
import type { KeystrokeTelemetryPoint } from "./keystrokeTypes";
import { KEYCAP_FADE_MS, KEYCAP_HOLD_MS, visibleKeycaps } from "./visibleKeycaps";

function point(
	timeMs: number,
	key: string,
	modifiers: KeystrokeTelemetryPoint["modifiers"] = [],
): KeystrokeTelemetryPoint {
	return { timeMs, key, modifiers };
}

describe("visibleKeycaps", () => {
	it("hides a bare letter in shortcuts mode and shows meta+c", () => {
		const samples = [point(100, "c"), point(120, "c", ["meta"])];
		expect(visibleKeycaps(samples, 120, "shortcuts").map((group) => group.labels)).toEqual([
			["⌘", "C"],
		]);
	});

	it("holds at full opacity then fades linearly", () => {
		const samples = [point(0, "enter")];
		expect(visibleKeycaps(samples, 0, "shortcuts")[0]?.opacity).toBe(1);
		expect(visibleKeycaps(samples, KEYCAP_HOLD_MS, "shortcuts")[0]?.opacity).toBe(1);
		expect(
			visibleKeycaps(samples, KEYCAP_HOLD_MS + KEYCAP_FADE_MS / 2, "shortcuts")[0]?.opacity,
		).toBeCloseTo(0.5);
		expect(visibleKeycaps(samples, KEYCAP_HOLD_MS + KEYCAP_FADE_MS, "shortcuts")).toEqual([]);
	});

	it("keeps the four newest groups", () => {
		const samples = [
			point(10, "enter"),
			point(20, "tab"),
			point(30, "esc"),
			point(40, "backspace"),
			point(50, "delete"),
		];
		expect(visibleKeycaps(samples, 50, "shortcuts").map((group) => group.id)).toEqual([
			"20:tab:",
			"30:esc:",
			"40:backspace:",
			"50:delete:",
		]);
	});

	it("keeps stable ids when a later extra event arrives", () => {
		const first = [point(10, "enter"), point(20, "tab"), point(30, "esc")];
		const before = visibleKeycaps(first, 30, "shortcuts").map((group) => group.id);
		const after = visibleKeycaps([...first, point(40, "delete")], 40, "shortcuts").map(
			(group) => group.id,
		);
		expect(before).toEqual(["10:enter:", "20:tab:", "30:esc:"]);
		expect(after).toEqual(["10:enter:", "20:tab:", "30:esc:", "40:delete:"]);
	});

	it("does not merge typing into a word", () => {
		const samples = [
			point(10, "h"),
			point(80, "e"),
			point(150, "l"),
			point(220, "l"),
			point(290, "o"),
		];
		expect(visibleKeycaps(samples, 290, "all").map((group) => group.labels)).toEqual([
			["E"],
			["L"],
			["L"],
			["O"],
		]);
	});

	it("shows named punctuation in all typing and hides it in shortcuts", () => {
		const samples = [point(100, "period")];
		expect(visibleKeycaps(samples, 100, "all").map((group) => group.labels)).toEqual([["."]]);
		expect(visibleKeycaps(samples, 100, "shortcuts")).toEqual([]);
	});
});
