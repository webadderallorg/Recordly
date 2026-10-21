import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordCursorMouseDown, recordCursorMouseUp } = vi.hoisted(() => ({
	recordCursorMouseDown: vi.fn(),
	recordCursorMouseUp: vi.fn(),
}));

vi.mock("./interaction", () => ({
	recordCursorMouseDown,
	recordCursorMouseUp,
}));

vi.mock("electron", () => ({
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

vi.mock("../paths/binaries", () => ({
	ensureNativeCursorMonitorBinary: vi.fn(),
	getCursorMonitorExePath: vi.fn(() => "/tmp/cursor-monitor.exe"),
}));

import { setNativeCursorMonitorOutputBuffer } from "../state";
import { handleCursorMonitorStdout } from "./monitor";

/**
 * The native cursor-monitor helper is the click source on Windows: the global
 * uiohook hook gets silently unhooked by Windows while the recorder's main
 * process is busy, so these `INTERACTION:` lines are what keeps click telemetry
 * alive. They are the contract between main.cpp and the main process.
 */
describe("handleCursorMonitorStdout interaction protocol", () => {
	beforeEach(() => {
		recordCursorMouseDown.mockClear();
		recordCursorMouseUp.mockClear();
		setNativeCursorMonitorOutputBuffer("");
	});

	it("records a left click from INTERACTION:mousedown:1", () => {
		handleCursorMonitorStdout(Buffer.from("INTERACTION:mousedown:1\n"));

		expect(recordCursorMouseDown).toHaveBeenCalledTimes(1);
		expect(recordCursorMouseDown).toHaveBeenCalledWith(1);
	});

	it.each([
		["2", 2],
		["3", 3],
	])("maps button %s to recordCursorMouseDown(%i)", (reported, expected) => {
		handleCursorMonitorStdout(Buffer.from(`INTERACTION:mousedown:${reported}\n`));

		expect(recordCursorMouseDown).toHaveBeenCalledWith(expected);
	});

	it("defaults to the left button when no button is reported", () => {
		handleCursorMonitorStdout(Buffer.from("INTERACTION:mousedown\n"));

		expect(recordCursorMouseDown).toHaveBeenCalledWith(1);
	});

	it("records mouse releases from INTERACTION:mouseup", () => {
		handleCursorMonitorStdout(Buffer.from("INTERACTION:mouseup\n"));

		expect(recordCursorMouseUp).toHaveBeenCalledTimes(1);
	});

	it("reassembles an interaction line split across two stdout chunks", () => {
		handleCursorMonitorStdout(Buffer.from("INTERACTION:mouse"));
		expect(recordCursorMouseDown).not.toHaveBeenCalled();

		handleCursorMonitorStdout(Buffer.from("down:1\n"));
		expect(recordCursorMouseDown).toHaveBeenCalledWith(1);
	});

	it("keeps handling cursor STATE lines interleaved with interactions", () => {
		handleCursorMonitorStdout(
			Buffer.from("STATE:pointer\nINTERACTION:mousedown:1\nINTERACTION:mouseup\n"),
		);

		expect(recordCursorMouseDown).toHaveBeenCalledWith(1);
		expect(recordCursorMouseUp).toHaveBeenCalledTimes(1);
	});

	it("ignores malformed interaction lines", () => {
		handleCursorMonitorStdout(Buffer.from("INTERACTION:mousedown:9\nINTERACTION:wheel\n"));

		expect(recordCursorMouseDown).not.toHaveBeenCalled();
		expect(recordCursorMouseUp).not.toHaveBeenCalled();
	});
});
