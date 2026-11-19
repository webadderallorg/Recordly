import { beforeEach, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("../paths/binaries", () => ({
	ensureNativeCursorMonitorBinary: vi.fn(),
	getCursorMonitorExePath: vi.fn(),
}));
vi.mock("./interaction", () => ({ recordCursorMouseDown: vi.fn(), recordCursorMouseUp: vi.fn() }));
import { recordCursorMouseDown, recordCursorMouseUp } from "./interaction";
import { setNativeCursorMonitorOutputBuffer } from "../state";
import { handleCursorMonitorStdout } from "./monitor";

beforeEach(() => {
	vi.clearAllMocks();
	setNativeCursorMonitorOutputBuffer("");
});

it("preserves left/right/middle button transitions across fragmented native output", () => {
	handleCursorMonitorStdout(Buffer.from("INTERACTION:mousedown:1\nINTERACTION:mouse"));
	handleCursorMonitorStdout(
		Buffer.from(
			"up:1\nINTERACTION:mousedown:2\nINTERACTION:mouseup:2\nINTERACTION:mousedown:3\nINTERACTION:mouseup:3\n",
		),
	);
	expect(vi.mocked(recordCursorMouseDown).mock.calls).toEqual([[1], [2], [3]]);
	expect(vi.mocked(recordCursorMouseUp).mock.calls).toEqual([[1], [2], [3]]);
});

it("retains compatibility with native helpers that omit button identity", () => {
	handleCursorMonitorStdout(Buffer.from("INTERACTION:mousedown\nINTERACTION:mouseup\n"));
	expect(recordCursorMouseDown).toHaveBeenCalledWith(1);
	expect(recordCursorMouseUp).toHaveBeenCalledWith(undefined);
});
