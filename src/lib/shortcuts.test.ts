import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, findConflict, matchesShortcut, SHORTCUT_ACTIONS } from "./shortcuts";

describe("DEFAULT_SHORTCUTS", () => {
	it("splitClip default key is b", () => {
		expect(DEFAULT_SHORTCUTS.splitClip.key).toBe("b");
	});

	it("fill-frame defaults are Alt+. and Alt+,", () => {
		expect(DEFAULT_SHORTCUTS.fillFrameOn).toEqual({ key: ".", alt: true });
		expect(DEFAULT_SHORTCUTS.fillFrameOff).toEqual({ key: ",", alt: true });
	});

	it("no conflicts in the default set", () => {
		for (const action of SHORTCUT_ACTIONS) {
			const conflict = findConflict(DEFAULT_SHORTCUTS[action], action, DEFAULT_SHORTCUTS);
			expect(conflict).toBeNull();
		}
	});
});

describe("matchesShortcut", () => {
	it("matches mac Option+Period via the key code when e.key is transformed", () => {
		const event = {
			key: "≥",
			code: "Period",
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: true,
		} as KeyboardEvent;
		expect(matchesShortcut(event, DEFAULT_SHORTCUTS.fillFrameOn, true)).toBe(true);
		expect(matchesShortcut(event, DEFAULT_SHORTCUTS.fillFrameOff, true)).toBe(false);
	});

	it("matches plain Alt+, on platforms that keep e.key literal", () => {
		const event = {
			key: ",",
			code: "Comma",
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: true,
		} as KeyboardEvent;
		expect(matchesShortcut(event, DEFAULT_SHORTCUTS.fillFrameOff, false)).toBe(true);
	});
});
