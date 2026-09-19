import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	dispatchRecordingShortcut,
	formatRecordingAccelerator,
	mergeRecordingShortcuts,
	type RecordingShortcutControls,
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

describe("dispatchRecordingShortcut", () => {
	function createControls(
		overrides: Partial<RecordingShortcutControls> = {},
	): RecordingShortcutControls {
		return {
			recording: false,
			paused: false,
			toggleRecording: vi.fn(),
			pauseRecording: vi.fn(),
			resumeRecording: vi.fn(),
			stopRecording: vi.fn(),
			...overrides,
		};
	}

	it("routes toggle to toggleRecording", () => {
		const controls = createControls();
		dispatchRecordingShortcut("toggle", controls);
		expect(controls.toggleRecording).toHaveBeenCalledOnce();
		expect(controls.stopRecording).not.toHaveBeenCalled();
	});

	it("stops only while recording", () => {
		const idle = createControls({ recording: false });
		dispatchRecordingShortcut("stop", idle);
		expect(idle.stopRecording).not.toHaveBeenCalled();

		const active = createControls({ recording: true });
		dispatchRecordingShortcut("stop", active);
		expect(active.stopRecording).toHaveBeenCalledOnce();
	});

	it("pauses and resumes based on paused state while recording", () => {
		const recording = createControls({ recording: true, paused: false });
		dispatchRecordingShortcut("pauseResume", recording);
		expect(recording.pauseRecording).toHaveBeenCalledOnce();
		expect(recording.resumeRecording).not.toHaveBeenCalled();

		const paused = createControls({ recording: true, paused: true });
		dispatchRecordingShortcut("pauseResume", paused);
		expect(paused.resumeRecording).toHaveBeenCalledOnce();
		expect(paused.pauseRecording).not.toHaveBeenCalled();
	});

	it("ignores pauseResume when not recording", () => {
		const controls = createControls({ recording: false, paused: false });
		dispatchRecordingShortcut("pauseResume", controls);
		expect(controls.pauseRecording).not.toHaveBeenCalled();
		expect(controls.resumeRecording).not.toHaveBeenCalled();
	});
});
