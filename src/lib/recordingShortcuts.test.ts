import { describe, expect, it } from "vitest";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	formatRecordingAccelerator,
	mergeRecordingShortcuts,
} from "./recordingShortcuts";

describe("mergeRecordingShortcuts", () => {
	it("returns defaults for empty input", () => {
		expect(mergeRecordingShortcuts(null)).toEqual(DEFAULT_RECORDING_SHORTCUTS);
		expect(mergeRecordingShortcuts(undefined)).toEqual(DEFAULT_RECORDING_SHORTCUTS);
		expect(mergeRecordingShortcuts({})).toEqual(DEFAULT_RECORDING_SHORTCUTS);
	});

	it("overrides valid accelerators and ignores blanks", () => {
		expect(
			mergeRecordingShortcuts({
				toggle: "CommandOrControl+Shift+R",
				pauseResume: "  ",
				stop: "Escape",
			}),
		).toEqual({
			toggle: "CommandOrControl+Shift+R",
			pauseResume: DEFAULT_RECORDING_SHORTCUTS.pauseResume,
			stop: "Escape",
		});
	});
});

describe("formatRecordingAccelerator", () => {
	it("formats F-keys and modifiers for mac and windows", () => {
		expect(formatRecordingAccelerator("F8", true)).toBe("F8");
		expect(formatRecordingAccelerator("CommandOrControl+Shift+R", true)).toBe("⌘ + ⇧ + R");
		expect(formatRecordingAccelerator("CommandOrControl+Shift+R", false)).toBe(
			"Ctrl + Shift + R",
		);
	});
});
