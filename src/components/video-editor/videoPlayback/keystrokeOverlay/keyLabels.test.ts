import { describe, expect, it } from "vitest";
import { formatModifierLabels, isModifierToken, keyTokenToLabel } from "./keyLabels";

describe("keyTokenToLabel", () => {
	it("uppercases single letters", () => {
		expect(keyTokenToLabel("a")).toBe("A");
		expect(keyTokenToLabel("A")).toBe("A");
	});

	it("maps digit tokens across spellings", () => {
		expect(keyTokenToLabel("1")).toBe("1");
		expect(keyTokenToLabel("Num1")).toBe("1");
		expect(keyTokenToLabel("Digit1")).toBe("1");
		expect(keyTokenToLabel("Numpad9")).toBe("9");
	});

	it("maps named keys to glyphs", () => {
		expect(keyTokenToLabel("Enter")).toBe("↵");
		expect(keyTokenToLabel("Backspace")).toBe("⌫");
		expect(keyTokenToLabel("Tab")).toBe("⇥");
		expect(keyTokenToLabel("Escape")).toBe("Esc");
	});

	it("maps arrows to arrow glyphs regardless of spelling", () => {
		expect(keyTokenToLabel("Up")).toBe("↑");
		expect(keyTokenToLabel("ArrowUp")).toBe("↑");
		expect(keyTokenToLabel("Right")).toBe("→");
	});

	it("maps punctuation tokens", () => {
		expect(keyTokenToLabel("Comma")).toBe(",");
		expect(keyTokenToLabel("Slash")).toBe("/");
		expect(keyTokenToLabel("BracketLeft")).toBe("[");
	});

	it("passes function keys through", () => {
		expect(keyTokenToLabel("F5")).toBe("F5");
		expect(keyTokenToLabel("F12")).toBe("F12");
	});

	it("falls back to the token itself for unknown keys", () => {
		expect(keyTokenToLabel("187")).toBe("187");
		expect(keyTokenToLabel("")).toBe("");
	});
});

describe("formatModifierLabels", () => {
	it("uses mac glyphs in Ctrl/Alt/Shift/Meta order", () => {
		expect(
			formatModifierLabels({ ctrl: true, alt: true, shift: true, meta: true }, "mac"),
		).toEqual(["⌃", "⌥", "⇧", "⌘"]);
	});

	it("uses text labels on windows, with Win for meta", () => {
		expect(formatModifierLabels({ ctrl: true, meta: true }, "windows")).toEqual([
			"Ctrl",
			"Win",
		]);
	});

	it("uses Super for meta on linux", () => {
		expect(formatModifierLabels({ meta: true }, "linux")).toEqual(["Super"]);
	});

	it("returns nothing when no modifiers are held", () => {
		expect(formatModifierLabels({}, "mac")).toEqual([]);
	});
});

describe("isModifierToken", () => {
	it("flags modifier and lock keys", () => {
		expect(isModifierToken("Shift")).toBe(true);
		expect(isModifierToken("MetaRight")).toBe(true);
		expect(isModifierToken("CapsLock")).toBe(true);
	});

	it("does not flag ordinary keys", () => {
		expect(isModifierToken("A")).toBe(false);
		expect(isModifierToken("Enter")).toBe(false);
	});
});
