import { describe, expect, it } from "vitest";
import {
	DEFAULT_SHORTCUTS,
	FIXED_SHORTCUTS,
	mergeWithDefaults,
	type ShortcutsConfig,
} from "./shortcuts";

describe("shortcuts configuration and mergeWithDefaults", () => {
	it("preserves valid saved shortcuts", () => {
		const saved: Partial<ShortcutsConfig> = {
			splitClip: { key: "x" },
		};
		const merged = mergeWithDefaults(saved);
		expect(merged.splitClip).toEqual({ key: "x" });
		expect(merged.addZoom).toEqual(DEFAULT_SHORTCUTS.addZoom);
	});

	it("rejects saved shortcuts that conflict with FIXED_SHORTCUTS", () => {
		const saved: Partial<ShortcutsConfig> = {
			// Comma is a fixed shortcut for Step Backward 1 Frame
			splitClip: { key: "," },
			// Period is a fixed shortcut for Step Forward 1 Frame
			addAnnotation: { key: "." },
		};
		const merged = mergeWithDefaults(saved);
		expect(merged.splitClip).toEqual(DEFAULT_SHORTCUTS.splitClip);
		expect(merged.addAnnotation).toEqual(DEFAULT_SHORTCUTS.addAnnotation);
	});

	it("contains frame stepping and timeline jump in FIXED_SHORTCUTS", () => {
		const labels = FIXED_SHORTCUTS.map((s) => s.label);
		expect(labels).toContain("Step Backward 1 Frame");
		expect(labels).toContain("Step Forward 1 Frame");
		expect(labels).toContain("Step Backward 1s");
		expect(labels).toContain("Step Forward 1s");
		expect(labels).toContain("Jump to Previous Keyframe");
		expect(labels).toContain("Jump to Next Keyframe");
	});
});
