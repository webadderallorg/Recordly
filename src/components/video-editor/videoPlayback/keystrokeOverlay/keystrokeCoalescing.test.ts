import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildKeycapGroups, computeOpacity } from "./keystrokeCoalescing";
import { DEFAULT_KEYSTROKE_OVERLAY_POLICY, type KeystrokeEvent } from "./keystrokeTypes";

const POLICY = DEFAULT_KEYSTROKE_OVERLAY_POLICY;

function ev(timeMs: number, key: string, mods: Partial<KeystrokeEvent> = {}): KeystrokeEvent {
	return { timeMs, key, ...mods };
}

describe("computeOpacity", () => {
	it("is fully opaque during the hold, then fades to zero", () => {
		expect(computeOpacity(0, POLICY)).toBe(1);
		expect(computeOpacity(POLICY.holdMs, POLICY)).toBe(1);
		expect(computeOpacity(POLICY.holdMs + POLICY.fadeMs / 2, POLICY)).toBeCloseTo(0.5, 5);
		expect(computeOpacity(POLICY.holdMs + POLICY.fadeMs, POLICY)).toBe(0);
		expect(computeOpacity(POLICY.holdMs + POLICY.fadeMs + 1000, POLICY)).toBe(0);
	});
});

describe("buildKeycapGroups", () => {
	it("shows a single plain key right after it is pressed", () => {
		const groups = buildKeycapGroups([ev(1000, "A")], 1000, "mac");
		expect(groups).toHaveLength(1);
		expect(groups[0].labels).toEqual(["A"]);
		expect(groups[0].isChord).toBe(false);
		expect(groups[0].opacity).toBe(1);
	});

	it("does not reveal a key before its timestamp", () => {
		const groups = buildKeycapGroups([ev(2000, "A")], 1999, "mac");
		expect(groups).toHaveLength(0);
	});

	it("groups a modifier chord into one keycap group", () => {
		const groups = buildKeycapGroups([ev(1000, "P", { meta: true, shift: true })], 1000, "mac");
		expect(groups).toHaveLength(1);
		expect(groups[0].isChord).toBe(true);
		expect(groups[0].labels).toEqual(["⇧", "⌘", "P"]);
	});

	it("merges rapid plain keystrokes into one running group", () => {
		const events = [ev(1000, "H"), ev(1100, "E"), ev(1200, "L"), ev(1300, "L"), ev(1400, "O")];
		const groups = buildKeycapGroups(events, 1400, "mac");
		expect(groups).toHaveLength(1);
		expect(groups[0].labels).toEqual(["H", "E", "L", "L", "O"]);
	});

	it("splits keystrokes separated by more than the group window", () => {
		const events = [ev(1000, "A"), ev(1000 + POLICY.groupWindowMs + 50, "B")];
		const groups = buildKeycapGroups(events, events[1].timeMs, "mac");
		expect(groups).toHaveLength(2);
		expect(groups.map((g) => g.labels)).toEqual([["A"], ["B"]]);
	});

	it("keeps a chord separate from adjacent typing", () => {
		const events = [ev(1000, "A"), ev(1050, "C", { meta: true }), ev(1100, "B")];
		const groups = buildKeycapGroups(events, 1100, "mac");
		expect(groups.map((g) => g.isChord)).toEqual([false, true, false]);
	});

	it("ignores lone modifier presses", () => {
		const groups = buildKeycapGroups([ev(1000, "Shift"), ev(1010, "Meta")], 1010, "mac");
		expect(groups).toHaveLength(0);
	});

	it("caps the number of simultaneously visible groups", () => {
		const events = Array.from({ length: 10 }, (_, i) =>
			ev(1000 + i * (POLICY.groupWindowMs + 100), "A", { meta: true }),
		);
		const last = events[events.length - 1].timeMs;
		const groups = buildKeycapGroups(events, last, "mac");
		expect(groups.length).toBeLessThanOrEqual(POLICY.maxGroups);
	});

	it("drops a group once it has fully faded", () => {
		const groups = buildKeycapGroups(
			[ev(1000, "A")],
			1000 + POLICY.holdMs + POLICY.fadeMs + 1,
			"mac",
		);
		expect(groups).toHaveLength(0);
	});

	it("property: never reveals future keys and opacity stays in (0,1]", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						timeMs: fc.integer({ min: 0, max: 200_000 }),
						key: fc.constantFrom("A", "B", "C", "Enter", "Space", "Shift", "1"),
						meta: fc.boolean(),
						shift: fc.boolean(),
					}),
					{ maxLength: 40 },
				),
				fc.integer({ min: 0, max: 200_000 }),
				(events, t) => {
					const groups = buildKeycapGroups(events as KeystrokeEvent[], t, "mac");
					for (const group of groups) {
						expect(group.opacity).toBeGreaterThan(0);
						expect(group.opacity).toBeLessThanOrEqual(1);
						expect(group.startMs).toBeLessThanOrEqual(t);
						expect(group.lastMs).toBeLessThanOrEqual(t);
						expect(group.labels.length).toBeGreaterThan(0);
					}
				},
			),
		);
	});
});
