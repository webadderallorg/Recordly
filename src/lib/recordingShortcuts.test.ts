import { describe, expect, it } from "vitest";
import { DEFAULT_RECORDING_SHORTCUTS, validateRecordingShortcuts } from "./recordingShortcuts";

describe("recording shortcut configuration", () => {
	it("accepts defaults, function keys, and disabled bindings", () => {
		expect(validateRecordingShortcuts(DEFAULT_RECORDING_SHORTCUTS)).toEqual(
			DEFAULT_RECORDING_SHORTCUTS,
		);
		expect(
			validateRecordingShortcuts({
				...DEFAULT_RECORDING_SHORTCUTS,
				toggleHud: "",
				togglePause: "F8",
			}).togglePause,
		).toBe("F8");
	});
	it.each([
		"R",
		"Alt+Alt+R",
		"Hyper+R",
		"Control+",
		"F25",
	])("rejects unsafe or invalid binding %s", (binding) => {
		expect(() =>
			validateRecordingShortcuts({ ...DEFAULT_RECORDING_SHORTCUTS, toggleHud: binding }),
		).toThrow();
	});
	it("rejects duplicates despite modifier order, aliases, or casing", () => {
		expect(() =>
			validateRecordingShortcuts({
				...DEFAULT_RECORDING_SHORTCUTS,
				togglePause: "alt+cmdorctrl+r",
			}),
		).toThrow("Duplicate");
	});
});
