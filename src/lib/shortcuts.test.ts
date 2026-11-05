import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, mergeWithDefaults } from "./shortcuts";

describe("split shortcut migration", () => {
	it("updates an existing saved C default to the primary-modifier B binding", () => {
		expect(
			mergeWithDefaults({ ...DEFAULT_SHORTCUTS, splitClip: { key: "c" } }).splitClip,
		).toEqual({ key: "b", ctrl: true });
	});
	it("preserves a customized split shortcut", () => {
		expect(mergeWithDefaults({ splitClip: { key: "x", shift: true } }).splitClip).toEqual({
			key: "x",
			shift: true,
		});
	});
	it("does not overwrite another action's custom Cmd/Ctrl+B binding", () => {
		expect(
			mergeWithDefaults({ splitClip: { key: "c" }, addZoom: { key: "b", ctrl: true } })
				.splitClip,
		).toEqual({ key: "c" });
	});
});
