import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	setNativeCaptureOutputBuffer,
	setNativeCaptureStopRequested,
	setNativeScreenRecordingActive,
} from "../state";

const send = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
}));
vi.mock("../cursor/telemetry", () => ({}));
vi.mock("../utils", () => ({}));
vi.mock("./diagnostics", () => ({}));
vi.mock("./macCompanionAudio", () => ({}));
vi.mock("./prune", () => ({}));

import { attachNativeCaptureLifecycle } from "./mac";

describe("macOS native capture lifecycle", () => {
	beforeEach(() => {
		send.mockClear();
		setNativeScreenRecordingActive(true);
		setNativeCaptureStopRequested(false);
		setNativeCaptureOutputBuffer("");
	});

	it("reports a stopped stream to the renderer with its actual error", () => {
		const process = new EventEmitter();
		attachNativeCaptureLifecycle(process as Parameters<typeof attachNativeCaptureLifecycle>[0]);
		setNativeCaptureOutputBuffer("STREAM_STOPPED: Screen capture permission was revoked\n");
		process.emit("close", 1);

		expect(send).toHaveBeenCalledWith("recording-interrupted", {
			reason: "stream-stopped",
			message: "Screen capture permission was revoked",
		});
	});
});
