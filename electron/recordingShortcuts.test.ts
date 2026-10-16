import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RECORDING_SHORTCUTS } from "../src/lib/recordingShortcuts";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	quit: vi.fn(),
	register: vi.fn(),
	unregister: vi.fn(),
	exists: vi.fn(),
	read: vi.fn(),
	write: vi.fn(),
	rename: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { on: mocks.quit },
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(name, handler),
	},
	globalShortcut: { register: mocks.register, unregister: mocks.unregister },
}));
vi.mock("node:fs", () => ({
	default: {
		existsSync: mocks.exists,
		readFileSync: mocks.read,
		writeFileSync: mocks.write,
		renameSync: mocks.rename,
	},
}));
vi.mock("./appPaths", () => ({ USER_DATA_PATH: "test-data" }));

import { registerRecordingShortcuts } from "./recordingShortcuts";

describe("recording shortcut lifecycle", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.handlers.clear();
		mocks.register.mockReturnValue(true);
		mocks.exists.mockReturnValue(false);
	});
	it("dispatches OS callbacks and releases owned bindings on quit", () => {
		const dispatch = vi.fn();
		registerRecordingShortcuts(dispatch);
		mocks.register.mock.calls[1][1]();
		expect(dispatch).toHaveBeenCalledWith("togglePause");
		mocks.quit.mock.calls[0][1]();
		expect(mocks.unregister).toHaveBeenCalledTimes(5);
	});
	it("reports OS conflicts without claiming success for unavailable keys", () => {
		mocks.register.mockReturnValueOnce(false);
		const status = registerRecordingShortcuts(vi.fn());
		expect(status().errors).toEqual([expect.stringContaining("already in use")]);
	});
	it("loads persisted overrides and disabled bindings", () => {
		mocks.exists.mockReturnValue(true);
		mocks.read.mockReturnValue(
			JSON.stringify({
				...DEFAULT_RECORDING_SHORTCUTS,
				toggleHud: "",
				toggleRecording: "F9",
			}),
		);
		registerRecordingShortcuts(vi.fn());
		expect(mocks.register).toHaveBeenCalledTimes(4);
		expect(mocks.register).toHaveBeenCalledWith("F9", expect.any(Function));
	});
	it("leaves active bindings intact on invalid input or failed persistence", () => {
		registerRecordingShortcuts(vi.fn());
		const save = mocks.handlers.get("set-recording-shortcuts")!;
		expect(save({}, { ...DEFAULT_RECORDING_SHORTCUTS, toggleHud: "R" })).toMatchObject({
			success: false,
		});
		mocks.write.mockImplementation(() => {
			throw new Error("disk full");
		});
		expect(save({}, DEFAULT_RECORDING_SHORTCUTS)).toMatchObject({
			error: expect.stringContaining("disk full"),
		});
		expect(mocks.unregister).not.toHaveBeenCalled();
	});
	it("rebinds and persists edits, including an explicitly disabled action", () => {
		registerRecordingShortcuts(vi.fn());
		const settings = {
			...DEFAULT_RECORDING_SHORTCUTS,
			toggleRecording: "F9",
			cancelRecording: "",
		};
		const result = mocks.handlers.get("set-recording-shortcuts")!({}, settings);
		expect(result).toMatchObject({ success: true, errors: [], settings });
		expect(mocks.rename).toHaveBeenCalled();
		expect(mocks.unregister).toHaveBeenCalledTimes(5);
	});
	it("does not silently enable defaults over a corrupt configuration", () => {
		mocks.exists.mockReturnValue(true);
		mocks.read.mockReturnValue("{");
		const status = registerRecordingShortcuts(vi.fn());
		expect(mocks.register).not.toHaveBeenCalled();
		expect(status().errors[0]).toContain("Could not load");
	});
});
